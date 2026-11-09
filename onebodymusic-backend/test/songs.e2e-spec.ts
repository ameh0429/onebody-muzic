import { RehearsalsService } from '../src/rehearsals/rehearsals.service';
import { PlaylistsService } from '../src/playlists/playlists.service';
import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Response as AgentResponse } from 'superagent';
import { Readable } from 'node:stream';
import request from 'supertest';
import { DatabaseModule } from '../src/database/database.module';
import { MediaModule } from '../src/media/media.module';
import { AuthRepository } from '../src/auth/auth.repository';
import { Role, User, UserStatus } from '../src/database/models';
import { UsersService } from '../src/users/users.service';
import { ArtistsService } from '../src/artists/artists.service';
import { AlbumsService } from '../src/albums/albums.service';
import { SongsService } from '../src/songs/songs.service';
import { PlaybackTicketsService } from '../src/songs/playback-tickets.service';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.constants';
import { configureApp } from '../src/configure-app';

@Module({})
class TestDatabaseModule {}
const binary = (response: AgentResponse, done: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []; response.on('data', (chunk: Buffer) => chunks.push(chunk)); response.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Song routes and secure playback authorization', () => {
  let app: INestApplication; let jwt: JwtService; let tickets: PlaybackTicketsService;
  const secret = randomBytes(48).toString('hex'); const adminId = randomUUID(); const memberId = randomUUID(); const songId = randomUUID(); const artistId = randomUUID(); const assetId = randomUUID();
  const records = new Map<string, User>();
  const songs = { create: jest.fn(), list: jest.fn(), findOne: jest.fn(), update: jest.fn(), remove: jest.fn(), playback: jest.fn(), openStream: jest.fn() };
  const bearer = (id: string) => `Bearer ${jwt.sign({ sub: id })}`;
  const body = { title: ' Amazing  Grace ', artistId, audioAssetId: assetId };
  beforeAll(async () => {
    Object.assign(process.env, { JWT_SECRET: secret, CORS_ALLOWED_ORIGINS: 'http://localhost:5173', DATABASE_URL: 'postgresql://localhost/test', MEDIA_PLAYBACK_TTL_SECONDS: '60', JWT_ACCESS_TOKEN_TTL_SECONDS: '900' });
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideModule(DatabaseModule).useModule(TestDatabaseModule).overrideModule(MediaModule).useModule(TestDatabaseModule)
      .overrideProvider(AuthRepository).useValue({ findById: async (id: string) => records.get(id) ?? null })
      .overrideProvider(RehearsalsService).useValue({}).overrideProvider(PlaylistsService).useValue({}).overrideProvider(UsersService).useValue({}).overrideProvider(ArtistsService).useValue({}).overrideProvider(AlbumsService).useValue({}).overrideProvider(SongsService).useValue(songs).compile();
    app = module.createNestApplication(); configureApp(app); await app.init(); tickets = app.get(PlaybackTicketsService);
    jwt = new JwtService({ secret, signOptions: { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256', expiresIn: 900 } });
  });
  beforeEach(() => {
    jest.clearAllMocks(); records.clear();
    for (const [id, role] of [[adminId, Role.ADMIN], [memberId, Role.MEMBER]] as const) records.set(id, { id, role, status: UserStatus.ACTIVE, name: 'Grace', email: 'grace@example.org', createdAt: new Date(), updatedAt: new Date() } as User);
    for (const method of [songs.create, songs.findOne, songs.update]) method.mockResolvedValue({ id: songId }); songs.list.mockResolvedValue({ data: [] }); songs.remove.mockResolvedValue(undefined);
    songs.playback.mockImplementation((id: string, userId: string) => tickets.issue(userId, id));
    songs.openStream.mockImplementation(async (_id: string, range: string | undefined) => ({ stream: Readable.from([Buffer.from(range ? 'bcd' : 'abcdef')]), status: range ? 206 : 200, contentType: 'audio/mpeg', contentLength: range ? '3' : '6', contentRange: range ? 'bytes 1-3/6' : undefined, acceptRanges: 'bytes' }));
  });
  afterAll(async () => { await app?.close(); });
  it('requires authentication for CRUD and playback', async () => {
    for (const path of ['/api/v1/songs', `/api/v1/songs/${songId}`, `/api/v1/songs/${songId}/stream`]) await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).post('/api/v1/songs').send(body).expect(401);
    await request(app.getHttpServer()).patch(`/api/v1/songs/${songId}`).send({ title: 'Grace' }).expect(401);
    await request(app.getHttpServer()).delete(`/api/v1/songs/${songId}`).expect(401);
  });
  it('permits member reads, denies member modifications, and allows administrator CRUD', async () => {
    await request(app.getHttpServer()).get('/api/v1/songs').set('Authorization', bearer(memberId)).expect(200);
    await request(app.getHttpServer()).post('/api/v1/songs').set('Authorization', bearer(memberId)).send(body).expect(403);
    await request(app.getHttpServer()).patch(`/api/v1/songs/${songId}`).set('Authorization', bearer(memberId)).send({ title: 'Grace' }).expect(403);
    await request(app.getHttpServer()).delete(`/api/v1/songs/${songId}`).set('Authorization', bearer(memberId)).expect(403);
    await request(app.getHttpServer()).post('/api/v1/songs').set('Authorization', bearer(adminId)).send(body).expect(201); expect(songs.create).toHaveBeenCalledWith({ ...body, title: 'Amazing Grace' }, adminId);
    await request(app.getHttpServer()).patch(`/api/v1/songs/${songId}`).set('Authorization', bearer(adminId)).send({ albumId: null, category: null }).expect(200);
    await request(app.getHttpServer()).delete(`/api/v1/songs/${songId}`).set('Authorization', bearer(adminId)).expect(204);
  });
  it('allows only admins to create/update lyrics and preserves multiline text', async () => {
    const lyrics = '  Verse\n\nÌyìn Olúwa <chorus>  ';
    await request(app.getHttpServer()).post('/api/v1/songs').set('Authorization', bearer(adminId)).send({ ...body, lyrics }).expect(201);
    expect(songs.create).toHaveBeenCalledWith(expect.objectContaining({ lyrics }), adminId);
    await request(app.getHttpServer()).patch(`/api/v1/songs/${songId}`).set('Authorization', bearer(adminId)).send({ lyrics: null }).expect(200);
    expect(songs.update).toHaveBeenCalledWith(songId, { lyrics: null }, adminId);
    await request(app.getHttpServer()).patch(`/api/v1/songs/${songId}`).set('Authorization', bearer(memberId)).send({ lyrics }).expect(403);
    await request(app.getHttpServer()).patch(`/api/v1/songs/${songId}`).send({ lyrics }).expect(401);
  });
  it.each([123, true, {}, [], 'x'.repeat(50001), 'bad\u0000text'])('rejects invalid lyrics (case %#)', async (lyrics) => {
    await request(app.getHttpServer()).post('/api/v1/songs').set('Authorization', bearer(adminId)).send({ ...body, lyrics }).expect(400);
    await request(app.getHttpServer()).patch(`/api/v1/songs/${songId}`).set('Authorization', bearer(adminId)).send({ lyrics }).expect(400);
  });
  it('accepts the 50000-character boundary, empty text, and null', async () => {
    for (const lyrics of ['x'.repeat(50000), '', null]) await request(app.getHttpServer()).patch(`/api/v1/songs/${songId}`).set('Authorization', bearer(adminId)).send({ lyrics }).expect(200);
  });
  it.each([{ title: ' ' }, { artistId: 'invalid' }, { audioAssetId: null }, { albumId: 'invalid' }, { category: ' ' }, { durationSeconds: 99 }, { audioPublicId: 'injected' }, { uploadedById: adminId }])('rejects invalid or privileged create fields %j', async (change) => {
    await request(app.getHttpServer()).post('/api/v1/songs').set('Authorization', bearer(adminId)).send({ ...body, ...change }).expect(400);
  });
  it.each(['artistId=x', 'albumId=x', 'page=0', 'limit=101', 'search=', 'category=', 'sortBy=sql', 'sortOrder=drop', 'extra=true'])('validates list filters/sorting: %s', async (query) => {
    await request(app.getHttpServer()).get(`/api/v1/songs?${query}`).set('Authorization', bearer(memberId)).expect(400);
  });
  it('validates UUIDs and null required update fields', async () => {
    await request(app.getHttpServer()).get('/api/v1/songs/invalid').set('Authorization', bearer(memberId)).expect(400);
    for (const key of ['title', 'artistId', 'audioAssetId']) await request(app.getHttpServer()).patch(`/api/v1/songs/${songId}`).set('Authorization', bearer(adminId)).send({ [key]: null }).expect(400);
  });
  it('returns a short-lived relative redirect and offers JSON for browser audio.src', async () => {
    const redirect = await request(app.getHttpServer()).get(`/api/v1/songs/${songId}/stream`).set('Authorization', bearer(memberId)).expect(302);
    expect(redirect.headers.location as string).toMatch(new RegExp(`^/api/v1/songs/${songId}/stream\\?ticket=`)); expect(redirect.headers['cache-control']).toContain('no-store');
    const response = await request(app.getHttpServer()).get(`/api/v1/songs/${songId}/stream?redirect=false`).set('Authorization', bearer(memberId)).expect(200);
    expect(response.body as object).toMatchObject({ expiresIn: 60, url: expect.stringContaining('?ticket=') }); expect(JSON.stringify(response.body)).not.toContain('cloudinary');
  });
  it('streams full/range responses with a ticket, without buffering in the controller or minting another ticket', async () => {
    const issued = await tickets.issue(memberId, songId);
    const full = await request(app.getHttpServer()).get(issued.url).buffer(true).parse(binary).expect(200); expect((full.body as Buffer).toString()).toBe('abcdef');
    const ranged = await request(app.getHttpServer()).get(`${issued.url}&redirect=false`).set('Range', 'bytes=1-3').buffer(true).parse(binary).expect(206);
    expect((ranged.body as Buffer).toString()).toBe('bcd'); expect(ranged.headers['content-range']).toBe('bytes 1-3/6'); expect(ranged.headers['accept-ranges']).toBe('bytes'); expect(ranged.headers['cache-control']).toContain('no-store'); expect(songs.playback).not.toHaveBeenCalled();
    await request(app.getHttpServer()).head(issued.url).expect(200).expect('Content-Length', '6');
  });
  it('rejects expired tickets, another song ticket, and access-token substitution', async () => {
    const derived = createHmac('sha256', secret).update('onebodymusic:playback:v1').digest();
    const expired = new JwtService({ secret: derived }).sign({ sub: memberId, songId, kind: 'song-playback' }, { issuer: 'onebodymusic-playback', audience: 'onebodymusic-stream', algorithm: 'HS256', expiresIn: -1 });
    await request(app.getHttpServer()).get(`/api/v1/songs/${songId}/stream?ticket=${expired}`).expect(401);
    const other = await tickets.issue(memberId, randomUUID()); const token = new URL(other.url, 'https://api.example.org').searchParams.get('ticket');
    await request(app.getHttpServer()).get(`/api/v1/songs/${songId}/stream?ticket=${token}`).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/songs/${songId}/stream?ticket=${jwt.sign({ sub: memberId })}`).expect(401);
  });
  it('revalidates account status on every ticket/Range request', async () => {
    const issued = await tickets.issue(memberId, songId); records.get(memberId)!.status = UserStatus.SUSPENDED;
    await request(app.getHttpServer()).get(issued.url).set('Range', 'bytes=1-3').expect(401); expect(songs.openStream).not.toHaveBeenCalled();
  });
  it('does not accept playback tickets as ordinary API bearer credentials', async () => {
    const issued = await tickets.issue(memberId, songId); const token = new URL(issued.url, 'https://api.example.org').searchParams.get('ticket');
    await request(app.getHttpServer()).get('/api/v1/songs').set('Authorization', `Bearer ${token}`).expect(401);
  });
  it('documents JWT auth, redirect behavior, range responses and song schemas', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const doc = response.body as { paths: Record<string, { get: { security: unknown; responses: object } }>; components: { schemas: Record<string, unknown> } };
    expect(doc.paths['/api/v1/songs/{id}/stream']?.get.responses).toHaveProperty('302'); expect(doc.paths['/api/v1/songs/{id}/stream']?.get.responses).toHaveProperty('206'); expect(doc.paths['/api/v1/songs/{id}/stream']?.get.security).toEqual([{ bearer: [] }]); expect(doc.components.schemas).toHaveProperty('CreateSongDto');
    expect(doc.components.schemas).toHaveProperty('SongDetailResponseDto');
    const schemas = doc.components.schemas as Record<string, { properties?: Record<string, unknown> }>;
    expect(schemas.SongDetailResponseDto?.properties).toHaveProperty('lyrics');
    expect(schemas.SongResponseDto?.properties).not.toHaveProperty('lyrics');
  });
});
