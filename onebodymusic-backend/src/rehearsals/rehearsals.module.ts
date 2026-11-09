import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PlaylistsModule } from '../playlists/playlists.module';
import { RehearsalsController } from './rehearsals.controller';
import { RehearsalsService } from './rehearsals.service';
@Module({ imports: [AuthModule, DatabaseModule, PlaylistsModule], controllers: [RehearsalsController], providers: [RehearsalsService], exports: [RehearsalsService] })
export class RehearsalsModule {}
