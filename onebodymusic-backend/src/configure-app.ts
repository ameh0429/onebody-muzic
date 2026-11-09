import { BadRequestException, INestApplication, PayloadTooLargeException, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ErrorRequestHandler, json, RequestHandler, urlencoded } from 'express';
import { EnvironmentVariables } from './config/environment';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  app.use(helmet());
  const privateResponses: RequestHandler = (request, response, next) => {
    if (request.path.startsWith('/api/v1/')) response.setHeader('Cache-Control', 'private, no-store');
    next();
  };
  app.use(privateResponses);
  // Explicit bounded parsers let us redact malformed-body diagnostics before Nest echoes input.
  app.use(json({ limit: '100kb' }), urlencoded({ extended: false, limit: '100kb' }));
  const redactParserErrors: ErrorRequestHandler = (error: unknown, _request, _response, next) => {
    if (typeof error === 'object' && error !== null && 'type' in error) {
      if (error.type === 'entity.parse.failed') { next(new BadRequestException('Malformed request body')); return; }
      if (error.type === 'entity.too.large') { next(new PayloadTooLargeException('Request body exceeds the size limit')); return; }
    }
    next(error);
  };
  app.use(redactParserErrors);
  app.enableCors({ origin: config.get('CORS_ALLOWED_ORIGINS', { infer: true }) });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const options = new DocumentBuilder()
    .setTitle('OnebodyMusic API')
    .setDescription('Private church music library and rehearsal management API. Includes pending member registration and administrator approval, active-account JWT authentication, role-based library and media management, authorized range audio playback, personal/rehearsal playlists, and rehearsal scheduling. All protected requests recheck current account status. Dates are UTC ISO 8601. List endpoints use page/limit pagination. Authentication attempts are rate limited with Retry-After on 429 responses.')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Paste accessToken from POST /api/v1/auth/login. Do not include the Bearer prefix.' })
    .build();
  const document = SwaggerModule.createDocument(app, options);
  for (const item of Object.values(document.paths)) {
    for (const method of ['post', 'patch'] as const) {
      const operation = item?.[method]; const body = operation?.requestBody;
      if (operation && body && 'content' in body && body.content['application/json']) {
        operation.responses['413'] = { description: 'JSON request body exceeds the 100 KiB limit.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorDto' } } } };
      }
    }
  }
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: false, tryItOutEnabled: true },
  });
}
