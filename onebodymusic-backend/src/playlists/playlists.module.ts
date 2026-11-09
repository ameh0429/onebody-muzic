import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PlaylistsController } from './playlists.controller';
import { PlaylistsService } from './playlists.service';

@Module({ imports: [AuthModule, DatabaseModule], controllers: [PlaylistsController], providers: [PlaylistsService], exports: [PlaylistsService] })
export class PlaylistsModule {}
