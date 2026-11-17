import 'reflect-metadata';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { EnvironmentVariables } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production', colors: process.env.NODE_ENV !== 'production' }),
  });
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

void bootstrap().catch(() => {
  // Do not log configuration values, connection strings or provider error details.
  Logger.error('Application startup failed; check configuration, database connectivity and deployment logs.', undefined, 'Bootstrap');
  process.exitCode = 1;
});
