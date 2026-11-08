import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { EnvironmentVariables } from './config/environment';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  app.use(helmet());
  app.enableCors({ origin: config.get('CORS_ALLOWED_ORIGINS', { infer: true }) });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const options = new DocumentBuilder()
    .setTitle('OnebodyMusic API')
    .setDescription('REST API for the private OnebodyMusic church music library and rehearsal management platform. Provides PostgreSQL-backed member registration, active-account JWT authentication, and API liveness.')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Paste accessToken from POST /api/v1/auth/login. Do not include the Bearer prefix.' })
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: false, tryItOutEnabled: true },
  });
}
