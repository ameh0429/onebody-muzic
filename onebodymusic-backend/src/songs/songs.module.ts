import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { MediaModule } from '../media/media.module';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';
import { PlaybackAuthGuard } from './guards/playback-auth.guard';
import { PlaybackTicketsService } from './playback-tickets.service';

@Module({ imports: [AuthModule, DatabaseModule, MediaModule], controllers: [SongsController], providers: [SongsService, PlaybackAuthGuard, PlaybackTicketsService] })
export class SongsModule {}
