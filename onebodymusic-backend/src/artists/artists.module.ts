import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ArtistsController } from './artists.controller';
import { ArtistsService } from './artists.service';

@Module({ imports: [AuthModule, DatabaseModule], controllers: [ArtistsController], providers: [ArtistsService], exports: [ArtistsService] })
export class ArtistsModule {}
