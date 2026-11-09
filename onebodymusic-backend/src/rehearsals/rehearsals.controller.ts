import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { Role } from '../database/models';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { RehearsalsService } from './rehearsals.service';
import { CreateRehearsalDto } from './dto/create-rehearsal.dto';
import { UpdateRehearsalDto } from './dto/update-rehearsal.dto';
import { ListRehearsalsDto } from './dto/list-rehearsals.dto';
import { RehearsalDetailResponseDto, RehearsalsPageDto } from './dto/rehearsal-response.dto';

@ApiTags('Rehearsals') @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard)
@ApiResponse({ status: 400, description: 'Invalid input, timezone missing, empty update, or playlist is not REHEARSAL.', type: ApiErrorDto })
@ApiResponse({ status: 401, description: 'Authentication required or account inactive.', type: ApiErrorDto })
@ApiResponse({ status: 403, description: 'Administrator required for writes.', type: ApiErrorDto })
@ApiResponse({ status: 404, description: 'Rehearsal unavailable or referenced playlist missing. Drafts are hidden from members.', type: ApiErrorDto })
@ApiResponse({ status: 409, description: 'Concurrent reference conflict.', type: ApiErrorDto })
@Controller({ path: 'rehearsals', version: '1' })
export class RehearsalsController {
  constructor(private readonly rehearsals: RehearsalsService) {}
  @Post() @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Schedule a rehearsal (ADMIN)', description: 'Provide combined date/time as scheduledAt with Z or an explicit UTC offset. Publication follows the associated REHEARSAL playlist.' })
  @ApiBody({ type: CreateRehearsalDto }) @ApiResponse({ status: 201, type: RehearsalDetailResponseDto })
  create(@Body() dto: CreateRehearsalDto, @CurrentUser() user: UserResponseDto): Promise<RehearsalDetailResponseDto> { return this.rehearsals.create(dto, user); }
  @Get()
  @ApiOperation({ summary: 'List rehearsals', description: 'Members see only rehearsals with published REHEARSAL playlists. Filter period=upcoming or past, using server UTC time. Omit period to list all visible rehearsals. Pagination totals obey visibility.' })
  @ApiResponse({ status: 200, type: RehearsalsPageDto })
  list(@Query() query: ListRehearsalsDto, @CurrentUser() user: UserResponseDto): Promise<RehearsalsPageDto> { return this.rehearsals.list(query, user); }
  @Get(':id') @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get rehearsal and playlist songs in playback order', description: 'Song metadata contains no permanent audio URLs; use the authenticated song playback endpoint.' })
  @ApiResponse({ status: 200, type: RehearsalDetailResponseDto })
  findOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: UserResponseDto): Promise<RehearsalDetailResponseDto> { return this.rehearsals.findOne(id, user); }
  @Patch(':id') @Roles(Role.ADMIN) @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update rehearsal metadata, time or playlist (ADMIN)', description: 'At least one field required. Null clears description. Linked playlist must remain a REHEARSAL playlist; changing it changes publication visibility.' })
  @ApiBody({ type: UpdateRehearsalDto }) @ApiResponse({ status: 200, type: RehearsalDetailResponseDto })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateRehearsalDto, @CurrentUser() user: UserResponseDto): Promise<RehearsalDetailResponseDto> { return this.rehearsals.update(id, dto, user); }
  @Delete(':id') @Roles(Role.ADMIN) @HttpCode(204) @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Delete rehearsal (ADMIN)', description: 'Preserves the associated playlist, songs, and media.' })
  @ApiResponse({ status: 204, description: 'Rehearsal deleted.' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: UserResponseDto): Promise<void> { return this.rehearsals.remove(id, user); }
}
