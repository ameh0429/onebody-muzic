import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }), DatabaseModule, AuthModule, UsersModule, HealthModule],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
