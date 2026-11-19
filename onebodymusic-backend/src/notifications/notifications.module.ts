import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsWorker } from './notifications.worker';
@Module({ imports: [DatabaseModule, AuthModule], controllers: [NotificationsController], providers: [NotificationsService, NotificationsWorker] })
export class NotificationsModule {}
