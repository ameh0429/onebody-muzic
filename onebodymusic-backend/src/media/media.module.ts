import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaRepository } from './media.repository';
import { CloudinaryAudioGateway } from './cloudinary-audio.gateway';
import { CloudinaryClient } from './cloudinary.client';
import { FileInspector } from './file-inspector';
import { MediaCleanupWorker } from './media-cleanup.worker';
import { UploadCapacityInterceptor } from './interceptors/upload-capacity.interceptor';

@Module({ imports: [AuthModule, DatabaseModule], controllers: [MediaController], providers: [MediaService, MediaRepository, CloudinaryClient, CloudinaryAudioGateway, FileInspector, MediaCleanupWorker, UploadCapacityInterceptor], exports: [MediaService, CloudinaryClient, CloudinaryAudioGateway] })
export class MediaModule {}
