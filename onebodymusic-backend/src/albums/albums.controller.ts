import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../database/models';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AlbumsService } from './albums.service';
import { CreateAlbumDto } from './dto/create-album.dto';
import { UpdateAlbumDto } from './dto/update-album.dto';
import { ListAlbumsDto } from './dto/list-albums.dto';
import { AlbumDetailResponseDto, AlbumsPageDto } from './dto/album-response.dto';

@ApiTags('Albums')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiResponse({ status: 400, description: 'Invalid UUID, query, DTO, or unknown fields.', type: ApiErrorDto })
@ApiResponse({ status: 401, description: 'Missing, invalid, expired token or inactive account.', type: ApiErrorDto })
@ApiResponse({ status: 403, description: 'Administrator required for writes.', type: ApiErrorDto })
@ApiResponse({ status: 500, description: 'Unexpected server error.', type: ApiErrorDto })
@Controller({ path: 'albums', version: '1' })
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create an album (ADMIN)', description: 'Requires an existing artist and release year. Normalized titles are unique per artist. Artwork fields reference existing files only.' })
  @ApiBody({ type: CreateAlbumDto })
  @ApiResponse({ status: 201, type: AlbumDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Artist not found.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Duplicate title for this artist or concurrent reference conflict.', type: ApiErrorDto })
  create(@Body() dto: CreateAlbumDto): Promise<AlbumDetailResponseDto> { return this.albums.create(dto); }

  @Get()
  @ApiOperation({ summary: 'List/search albums', description: 'Authenticated users. Filter by artistId and releaseYear; search is a literal case-insensitive title substring. Summaries include artist and song count; GET by ID includes songs.' })
  @ApiResponse({ status: 200, type: AlbumsPageDto })
  list(@Query() query: ListAlbumsDto): Promise<AlbumsPageDto> { return this.albums.list(query); }

  @Get(':id')
  @ApiOperation({ summary: 'Get album details and associated songs' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AlbumDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Album not found.', type: ApiErrorDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<AlbumDetailResponseDto> { return this.albums.findOne(id); }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update an album (ADMIN)', description: 'At least one field is required. Clear artwork with null. Artist changes are blocked while the album contains songs.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateAlbumDto })
  @ApiResponse({ status: 200, type: AlbumDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Album or artist not found.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Duplicate title, populated album artist change, or reference conflict.', type: ApiErrorDto })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateAlbumDto): Promise<AlbumDetailResponseDto> { return this.albums.update(id, dto); }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an empty album (ADMIN)', description: 'Returns 409 if any song references the album. Never deletes songs or media files.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Album deleted.' })
  @ApiResponse({ status: 404, description: 'Album not found.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Album contains songs.', type: ApiErrorDto })
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> { return this.albums.remove(id); }
}
