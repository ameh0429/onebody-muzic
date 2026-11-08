import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { MediaKind, Role } from '../database/models';
import { MediaService } from './media.service';
import { MediaFileInterceptor } from './interceptors/media-file.interceptor';
import { UploadCapacityInterceptor } from './interceptors/upload-capacity.interceptor';
import { ImageFolder, UploadAudioDto, UploadImageDto } from './dto/upload-image.dto';
import { MediaResponseDto } from './dto/media-response.dto';

@ApiTags('Media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiResponse({ status: 400, description: 'Missing/empty file, unsafe filename, invalid fields, or UUID.', type: ApiErrorDto })
@ApiResponse({ status: 401, description: 'Missing or invalid authentication.', type: ApiErrorDto })
@ApiResponse({ status: 403, description: 'Active ADMIN required.', type: ApiErrorDto })
@ApiResponse({ status: 502, description: 'Cloudinary upload/deletion failed; cleanup is tracked and retried.', type: ApiErrorDto })
@ApiResponse({ status: 503, description: 'Media disabled or not configured, or database unavailable.', type: ApiErrorDto })
@Controller({ path: 'media', version: '1' })
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('audio')
  @UseInterceptors(UploadCapacityInterceptor, MediaFileInterceptor(MediaKind.AUDIO))
  @ApiOperation({ summary: 'Upload MP3 or audio-only M4A (ADMIN)', description: 'Stored as a Cloudinary video resource with authenticated delivery. Returns metadata only, never a public or signed audio URL.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 201, type: MediaResponseDto })
  @ApiResponse({ status: 413, description: 'Configured audio size limit exceeded.', type: ApiErrorDto })
  @ApiResponse({ status: 415, description: 'Unsupported/mismatched MIME, extension, or signature.', type: ApiErrorDto })
  @ApiResponse({ status: 429, description: 'Upload capacity reached; retry later.', type: ApiErrorDto })
  uploadAudio(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: UserResponseDto, @Body() _body: UploadAudioDto): Promise<MediaResponseDto> { return this.media.upload(file, MediaKind.AUDIO, user.id); }

  @Post('images')
  @UseInterceptors(UploadCapacityInterceptor, MediaFileInterceptor(MediaKind.IMAGE))
  @ApiOperation({ summary: 'Upload JPEG, PNG, or WebP artwork (ADMIN)', description: 'Select artists, albums, or songs as the destination. Only these fixed namespaces are allowed. Images use public delivery.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'folder'], properties: { file: { type: 'string', format: 'binary' }, folder: { type: 'string', enum: Object.values(ImageFolder) } } } })
  @ApiResponse({ status: 201, type: MediaResponseDto })
  @ApiResponse({ status: 413, description: 'Configured image size limit exceeded.', type: ApiErrorDto })
  @ApiResponse({ status: 415, description: 'Unsupported/mismatched MIME, extension, or signature.', type: ApiErrorDto })
  @ApiResponse({ status: 429, description: 'Upload capacity reached; retry later.', type: ApiErrorDto })
  uploadImage(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: UserResponseDto, @Body() dto: UploadImageDto): Promise<MediaResponseDto> { return this.media.upload(file, MediaKind.IMAGE, user.id, dto.folder); }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a tracked media asset (ADMIN)', description: 'Uses the internal asset UUID, never a client-supplied Cloudinary ID. Referenced assets cannot be deleted. Repeat deletion of a deleted asset is harmless.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Provider deletion confirmed or asset already deleted.' })
  @ApiResponse({ status: 404, description: 'Unknown media UUID.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Media is referenced by library records.', type: ApiErrorDto })
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> { return this.media.remove(id); }
}
