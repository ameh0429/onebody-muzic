import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { AlbumsController } from './albums.controller';
import { AlbumsService } from './albums.service';

@Module({ imports: [AuthModule, DatabaseModule], controllers: [AlbumsController], providers: [AlbumsService], exports: [AlbumsService] })
export class AlbumsModule {}
