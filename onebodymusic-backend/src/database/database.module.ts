import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { EnvironmentVariables } from '../config/environment';
import { databaseOptions } from './database-options';
import { DATABASE_MODELS } from './models';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        ({
          ...databaseOptions(config.get('DATABASE_URL', { infer: true })),
          // Nest authenticates in the auto-load path; forFeature registers all models below.
          models: [],
          autoLoadModels: true,
        }),
    }),
    SequelizeModule.forFeature(DATABASE_MODELS),
  ],
  exports: [SequelizeModule],
})
export class DatabaseModule {}
