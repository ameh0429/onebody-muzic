import { Body, Controller, Delete, HttpCode, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { MediaKind, Role } from '../database/models';
import { MediaFileInterceptor } from './interceptors/media-file.interceptor';
import { UploadCapacityInterceptor } from './interceptors/upload-capacity.interceptor';
import { ApiErrorDto } from '../common/dto/api-error.dto';

import { ProfilePictureService } from './profile-picture.service';

class UploadProfilePictureDto {}

@ApiTags('Users')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Missing authentication or inactive account.', type: ApiErrorDto })
@ApiResponse({ status: 403, description: 'Active member or administrator required.', type: ApiErrorDto })
@ApiResponse({ status: 404, description: 'Account no longer exists.', type: ApiErrorDto })
@ApiResponse({ status: 500, description: 'Unexpected server error.', type: ApiErrorDto })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MEMBER)
@Controller({ path: 'users/me/picture', version: '1' })
export class ProfilePictureController {
  constructor(private readonly pictures: ProfilePictureService) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(UploadCapacityInterceptor, MediaFileInterceptor(MediaKind.IMAGE))
  @ApiResponse({ status: 400, description: 'Missing/empty file or unexpected fields.', type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Upload no longer available.', type: ApiErrorDto })
  @ApiResponse({ status: 413, description: 'Image size limit exceeded.', type: ApiErrorDto })
  @ApiResponse({ status: 415, description: 'Unsupported/mismatched image format.', type: ApiErrorDto })
  @ApiResponse({ status: 429, description: 'Upload capacity reached.', type: ApiErrorDto })
  @ApiResponse({ status: 502, description: 'Provider rejected the upload; cleanup is tracked.', type: ApiErrorDto })
  @ApiResponse({ status: 503, description: 'Media disabled or unavailable.', type: ApiErrorDto })
  @ApiResponse({ status: 504, description: 'Upload deadline exceeded; cleanup is tracked.', type: ApiErrorDto })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload or replace your profile picture', description: 'Active members and administrators may upload JPEG, PNG or WebP within the configured image size limit. Images use public delivery. Only the current account is changed.' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  upload(@CurrentUser() user: UserResponseDto, @UploadedFile() file: Express.Multer.File | undefined, @Body() _body: UploadProfilePictureDto): Promise<UserResponseDto> {
    return this.pictures.upload(user.id, file);
  }

  @Delete()
  @ApiOperation({ summary: 'Remove your profile picture', description: 'Clears your picture immediately and schedules the provider asset for cleanup. Repeat removal is harmless.' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  remove(@CurrentUser() user: UserResponseDto): Promise<UserResponseDto> { return this.pictures.remove(user.id); }
}
