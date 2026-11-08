import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../database/models';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ArtistsService } from './artists.service';
import { CreateArtistDto } from './dto/create-artist.dto';
import { UpdateArtistDto } from './dto/update-artist.dto';
import { ListArtistsDto } from './dto/list-artists.dto';
import { ArtistResponseDto, ArtistsPageDto } from './dto/artist-response.dto';

@ApiTags('Artists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiResponse({ status: 400, description: 'Invalid UUID, DTO, query, or unknown fields.', type: ApiErrorDto })
@ApiResponse({ status: 401, description: 'Missing, invalid, expired JWT or non-active user.', type: ApiErrorDto })
@ApiResponse({ status: 403, description: 'Administrator required for writes.', type: ApiErrorDto })
@ApiResponse({ status: 500, description: 'Unexpected server error.', type: ApiErrorDto })
@Controller({ path: 'artists', version: '1' })
export class ArtistsController {
  constructor(private readonly artists: ArtistsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create an artist (ADMIN)', description: 'Trims and collapses name whitespace. Names are case-insensitively unique. Image fields reference already uploaded files.' })
  @ApiBody({ type: CreateArtistDto })
  @ApiResponse({ status: 201, type: ArtistResponseDto })
  @ApiResponse({ status: 409, description: 'Normalized artist name already exists.', type: ApiErrorDto })
  create(@Body() dto: CreateArtistDto): Promise<ArtistResponseDto> { return this.artists.create(dto); }

  @Get()
  @ApiOperation({ summary: 'List/search artists', description: 'Authenticated users. Literal, case-insensitive substring search by name; paginated results include album and song counts.' })
  @ApiResponse({ status: 200, type: ArtistsPageDto })
  list(@Query() query: ListArtistsDto): Promise<ArtistsPageDto> { return this.artists.list(query); }

  @Get(':id')
  @ApiOperation({ summary: 'Get artist details and album/song counts' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: ArtistResponseDto })
  @ApiResponse({ status: 404, description: 'Artist not found.', type: ApiErrorDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<ArtistResponseDto> { return this.artists.findOne(id); }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update an artist (ADMIN)', description: 'Provide at least one field. Optional biography/image references can be cleared with null; name cannot be null.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateArtistDto })
  @ApiResponse({ status: 200, type: ArtistResponseDto })
  @ApiResponse({ status: 404, description: 'Artist not found.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Normalized artist name already exists.', type: ApiErrorDto })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateArtistDto): Promise<ArtistResponseDto> { return this.artists.update(id, dto); }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an unreferenced artist (ADMIN)', description: 'Rejects artists referenced by any album or song. No media files are deleted.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Artist deleted.' })
  @ApiResponse({ status: 404, description: 'Artist not found.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Artist has albums or songs.', type: ApiErrorDto })
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> { return this.artists.remove(id); }
}
