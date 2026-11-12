import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { DatabaseModule } from '../../database/database.module';
import { SessionsController } from './sessions.controller';
import { RefreshSessionsService } from './refresh-sessions.service';
@Module({ imports: [AuthModule, DatabaseModule], controllers: [SessionsController], providers: [RefreshSessionsService] })
export class SessionsModule {}
