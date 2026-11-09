import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { Role } from '../database/models';
import { SongsService } from './songs.service';
import { CreateSongDto } from './dto/create-song.dto';
import { UpdateSongDto } from './dto/update-song.dto';
import { ListSongsDto } from './dto/list-songs.dto';
import { SongDetailResponseDto, SongsPageDto } from './dto/song-response.dto';
import { PlaybackQueryDto, PlaybackResponseDto } from './dto/playback.dto';
import { PlaybackAuthGuard, PlaybackRequest } from './guards/playback-auth.guard';

const songExample = {
  id: '6838918a-2b67-49ed-a90d-14b86ca955c7', title: 'Amazing Grace',
  artistId: 'a468f50d-33af-4fcf-93c8-e341bec66fd2', artist: { id: 'a468f50d-33af-4fcf-93c8-e341bec66fd2', name: 'Church Choir' },
  albumId: null, album: null, category: 'Worship', durationSeconds: 241, coverImageUrl: null, hasAudioAsset: true,
  createdAt: '2026-11-08T12:00:00.000Z', updatedAt: '2026-11-08T12:00:00.000Z',
};

@ApiTags('Songs')
@ApiBearerAuth()
@ApiResponse({ status: 400, description: 'Invalid UUID, query/DTO, or artist/album mismatch.', type: ApiErrorDto })
@ApiResponse({ status: 401, description: 'Missing/invalid/expired authentication or inactive/deleted user.', type: ApiErrorDto })
@ApiResponse({ status: 403, description: 'Administrator required, unauthorized media reuse, or wrong song ticket.', type: ApiErrorDto })
@ApiResponse({ status: 404, description: 'Song, artist, album, or media asset not found.', type: ApiErrorDto })
@ApiResponse({ status: 409, description: 'Unavailable/reused media or referenced song.', type: ApiErrorDto })
@Controller({ path: 'songs', version: '1' })
export class SongsController {
  constructor(private readonly songs: SongsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a song (ADMIN)', description: 'Provide the audio MediaAsset UUID returned by the media upload endpoint. The audio must be READY, authenticated, uploaded by you, and unused. Duration and storage identifiers are resolved server-side.' })
  @ApiBody({ type: CreateSongDto })
  @ApiResponse({ status: 201, type: SongDetailResponseDto, example: { ...songExample, lyrics: 'Amazing grace\nHow sweet the sound' } })
  create(@Body() dto: CreateSongDto, @CurrentUser() user: UserResponseDto): Promise<SongDetailResponseDto> { return this.songs.create(dto, user.id); }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List/search songs', description: 'Combine artistId, albumId, category and title search filters. Sort by title or createdAt; results contain safe artist/album metadata, never provider audio URLs or public IDs.' })
  @ApiResponse({ status: 200, type: SongsPageDto, example: { data: [songExample], page: 1, limit: 20, total: 1, totalPages: 1 } })
  list(@Query() query: ListSongsDto): Promise<SongsPageDto> { return this.songs.list(query); }

  @Get(':id/stream')
  @UseGuards(PlaybackAuthGuard)
  @ApiOperation({ summary: 'Authorize playback or stream a scoped ticket', description: 'With an access JWT, defaults to a 302 relative redirect to a short-lived application-signed ticket URL. Use redirect=false for JSON, then set audio.src to that URL. Ticket requests stream authenticated Cloudinary bytes with range forwarding, re-checking current account status on every request. Tickets cannot mint new tickets. No permanent Cloudinary URL is exposed.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({ name: 'Range', required: false, description: 'Single byte range for ticket requests, e.g. bytes=0-1023. Provider-supported seeking; multipart ranges are rejected.' })
  @ApiResponse({ status: 302, description: 'Redirect to a short-lived scoped ticket URL.', headers: { Location: { schema: { type: 'string' } }, 'Cache-Control': { schema: { type: 'string', example: 'private, no-store, max-age=0' } } } })
  @ApiResponse({ status: 200, description: 'JSON ticket metadata with redirect=false, or an audio stream with a valid ticket.', type: PlaybackResponseDto })
  @ApiResponse({ status: 206, description: 'Partial audio content; Content-Range/Content-Length reflect the provider range response.', content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } }, 'audio/mp4': { schema: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 416, description: 'Unsatisfiable byte range, with Content-Range: bytes */total.' })
  @ApiResponse({ status: 502, description: 'Audio provider failed or did not honor the requested range.', type: ApiErrorDto })
  @ApiResponse({ status: 503, description: 'Audio delivery is disabled/not configured.', type: ApiErrorDto })
  async stream(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PlaybackQueryDto, @Req() request: PlaybackRequest, @Res() response: Response, @CurrentUser() user: UserResponseDto): Promise<void> {
    response.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' });
    if (!request.playbackTicket) {
      const playback = await this.songs.playback(id, user.id);
      response.set('X-Playback-Expires-At', playback.expiresAt);
      if (query.redirect === 'false') response.status(200).json(playback);
      else response.redirect(302, playback.url);
      return;
    }
    const abort = new AbortController(); const cancel = () => abort.abort();
    request.once('aborted', cancel); response.once('close', cancel);
    try {
      const audio = await this.songs.openStream(id, request.headers.range, request.method === 'HEAD', abort.signal);
      response.status(audio.status).set('Content-Type', audio.contentType);
      response.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length, X-Playback-Expires-At');
      if (audio.acceptRanges) response.set('Accept-Ranges', audio.acceptRanges);
      if (audio.contentRange) response.set('Content-Range', audio.contentRange);
      if (audio.status === 416) { audio.stream.destroy(); response.set('Content-Length', '0').end(); return; }
      if (audio.contentLength) response.set('Content-Length', audio.contentLength);
      if (request.method === 'HEAD') { audio.stream.destroy(); response.end(); return; }
      await pipeline(audio.stream, response, { signal: abort.signal });
    } catch (error: unknown) {
      if (response.headersSent || abort.signal.aborted) response.destroy();
      else throw error;
    } finally { request.removeListener('aborted', cancel); response.removeListener('close', cancel); }
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get safe song details including plain-text lyrics' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: SongDetailResponseDto, example: { ...songExample, lyrics: 'Amazing grace\nHow sweet the sound' } })
  findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<SongDetailResponseDto> { return this.songs.findOne(id); }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a song (ADMIN)', description: 'At least one field. Replacement media must be READY and owned by you; unchanged current media may be retained. Replaced unreferenced assets are scheduled for cleanup in the same transaction.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateSongDto })
  @ApiResponse({ status: 200, type: SongDetailResponseDto, example: { ...songExample, lyrics: 'Amazing grace\nHow sweet the sound' } })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateSongDto, @CurrentUser() user: UserResponseDto): Promise<SongDetailResponseDto> { return this.songs.update(id, dto, user.id); }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an unreferenced song (ADMIN)', description: 'Rejects songs present in playlists. Schedules detached tracked media for durable cleanup; does not delete remote files inside a database transaction.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Song deleted and eligible media cleanup scheduled.' })
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> { return this.songs.remove(id); }
}
