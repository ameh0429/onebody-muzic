import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { PlaylistsService } from './playlists.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { ListPlaylistsDto } from './dto/list-playlists.dto';
import { AddPlaylistSongsDto, ReorderPlaylistSongsDto } from './dto/playlist-songs.dto';
import { PlaylistDetailResponseDto, PlaylistsPageDto } from './dto/playlist-response.dto';

@ApiTags('Playlists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiResponse({ status: 400, description: 'Invalid UUID, DTO, query, duplicate IDs in a request, or forbidden fields.', type: ApiErrorDto })
@ApiResponse({ status: 401, description: 'Missing/invalid JWT or inactive account.', type: ApiErrorDto })
@ApiResponse({ status: 403, description: 'Ownership or rehearsal administrator permission required; draft rehearsal not visible.', type: ApiErrorDto })
@ApiResponse({ status: 404, description: 'Playlist or referenced song not found.', type: ApiErrorDto })
@ApiResponse({ status: 409, description: 'Duplicate song, stale reorder set, capacity limit, or rehearsal reference prevents deletion.', type: ApiErrorDto })
@Controller({ path: 'playlists', version: '1' })
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}
  @Post()
  @ApiOperation({ summary: 'Create a personal or rehearsal playlist', description: 'Members create their own PERSONAL playlists. Only ADMINs create REHEARSAL playlists; these default to DRAFT. Owner is assigned from authentication.' })
  @ApiBody({ type: CreatePlaylistDto })
  @ApiResponse({ status: 201, type: PlaylistDetailResponseDto })
  create(@Body() dto: CreatePlaylistDto, @CurrentUser() user: UserResponseDto): Promise<PlaylistDetailResponseDto> { return this.playlists.create(dto, user); }

  @Get()
  @ApiOperation({ summary: 'List visible playlists', description: 'Own PERSONAL playlists plus published REHEARSAL playlists. ADMINs also see draft rehearsal playlists, but other users personal playlists stay private. Pagination totals obey visibility.' })
  @ApiResponse({ status: 200, type: PlaylistsPageDto })
  list(@Query() query: ListPlaylistsDto, @CurrentUser() user: UserResponseDto): Promise<PlaylistsPageDto> { return this.playlists.list(query, user); }

  @Get(':id')
  @ApiOperation({ summary: 'Get a visible playlist with ordered safe song metadata' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: PlaylistDetailResponseDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: UserResponseDto): Promise<PlaylistDetailResponseDto> { return this.playlists.findOne(id, user); }

  @Patch(':id')
  @ApiOperation({ summary: 'Update metadata or publish/unpublish a rehearsal playlist', description: 'Personal owner only; any ADMIN may manage rehearsal playlists. Type and owner cannot change. publicationStatus is allowed only on rehearsals.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdatePlaylistDto })
  @ApiResponse({ status: 200, type: PlaylistDetailResponseDto })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdatePlaylistDto, @CurrentUser() user: UserResponseDto): Promise<PlaylistDetailResponseDto> { return this.playlists.update(id, dto, user); }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an authorized playlist', description: 'Owner only for personal playlists; ADMIN only for rehearsals. A rehearsal-event reference prevents deletion. Deletes join entries, never songs or media.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Playlist and its join entries deleted.' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: UserResponseDto): Promise<void> { return this.playlists.remove(id, user); }

  @Post(':id/songs')
  @ApiOperation({ summary: 'Append existing songs in request order', description: '1–100 UUIDs per request, up to 1000 songs per playlist. Duplicate or missing IDs reject the entire batch. Ownership/rehearsal permissions are enforced in the service.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: AddPlaylistSongsDto })
  @ApiResponse({ status: 201, type: PlaylistDetailResponseDto })
  addSongs(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AddPlaylistSongsDto, @CurrentUser() user: UserResponseDto): Promise<PlaylistDetailResponseDto> { return this.playlists.addSongs(id, dto.songIds, user); }

  @Patch(':id/songs/reorder')
  @ApiOperation({ summary: 'Atomically reorder the complete song list', description: 'Supply each current song UUID exactly once. Parent locking and two-phase nonnegative positions preserve unique constraints and entry IDs. A changed/missing set returns 409.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ReorderPlaylistSongsDto })
  @ApiResponse({ status: 200, type: PlaylistDetailResponseDto })
  reorder(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ReorderPlaylistSongsDto, @CurrentUser() user: UserResponseDto): Promise<PlaylistDetailResponseDto> { return this.playlists.reorder(id, dto.songIds, user); }

  @Delete(':id/songs/:songId')
  @ApiOperation({ summary: 'Remove a song and compact the remaining positions', description: 'Removes only the playlist entry, never the song or audio asset.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'songId', format: 'uuid' })
  @ApiResponse({ status: 200, type: PlaylistDetailResponseDto })
  removeSong(@Param('id', new ParseUUIDPipe()) id: string, @Param('songId', new ParseUUIDPipe()) songId: string, @CurrentUser() user: UserResponseDto): Promise<PlaylistDetailResponseDto> { return this.playlists.removeSong(id, songId, user); }
}
