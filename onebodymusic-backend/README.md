# OnebodyMusic backend

NestJS 11 REST API using strict TypeScript, feature modules, dependency injection, and Jest. Requires Node.js 22+ and npm. PostgreSQL, Prisma integration, authentication, and business features are intentionally deferred to subsequent tasks; no database or credentials are needed for this step.

## Install and run

From the repository root:

```sh
cd onebodymusic-backend
npm ci
cp .env.example .env
npm run start:dev
```

Preserve an existing `.env` instead of overwriting it. For a production build:

```sh
npm run build
npm run start:prod
```

The process validates configuration before listening and stops on invalid settings. `CORS_ALLOWED_ORIGINS` is required: a comma-separated list of exact HTTP(S) origins, without trailing slashes, paths, or wildcards. `PORT` defaults to `3000` and must be an integer from 1 to 65535. `NODE_ENV` defaults to `development` and accepts `development`, `test`, or `production`. Environment variables override `.env`; keep `.env` untracked. No secrets are required or hardcoded.

CORS controls browser access; it is not authentication. Requests without an Origin header remain usable by API clients. Unapproved browser origins receive no allow-origin header.

## API and interactive documentation

Open `http://localhost:3000/api/docs` for Swagger UI. Expand **Health → GET /api/v1/health**, choose **Try it out**, then **Execute**. The OpenAPI document is available at `/api/docs-json`. The **Authorize** dialog supports bearer JWT tokens for future protected routes; this step adds no authentication and health is public.

```sh
curl http://localhost:3000/api/v1/health
```

Example `200 OK` response:

```json
{
  "status": "ok",
  "service": "onebodymusic-backend",
  "timestamp": "2026-11-07T12:00:00.000Z"
}
```

Health checks API liveness only. Errors use a consistent schema:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Cannot GET /api/v1/missing",
  "path": "/api/v1/missing",
  "timestamp": "2026-11-07T12:00:00.000Z"
}
```

Validation errors return `400` with a string array in `message`; unexpected server errors return a generic `500` message without internal details. Global validation transforms DTOs, permits declared fields only, and rejects extra fields. The current GET health endpoint has no request body or query DTO; adding an unused request DTO would misrepresent the API. Test-only DTO routes verify the shared validation behavior.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

Jest covers startup validation, health, URI versioning, security headers, allowed and denied CORS origins, preflight, DTO transformation/rejection, error sanitization, Swagger assets, and OpenAPI metadata. Test-only routes are never included in the application module.

## Structure and dependencies

```text
src/
  main.ts                       # Bootstrap and shutdown hooks
  app.module.ts                 # Root module and global exception filter provider
  configure-app.ts              # Prefix, versioning, middleware, validation, Swagger
  config/
    environment.ts              # Startup environment schema and validation
    environment.spec.ts
  common/
    dto/api-error.dto.ts        # Shared documented error schema
    filters/http-exception.filter.ts
  health/
    health.module.ts
    health.controller.ts        # Routing and OpenAPI annotations
    health.service.ts           # Liveness logic
    dto/health-response.dto.ts
 test/app.e2e-spec.ts            # HTTP integration tests
```

Runtime dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/config`, `@nestjs/swagger`, `swagger-ui-express`, `class-validator`, `class-transformer`, `helmet`, `reflect-metadata`, and `rxjs`. Development dependencies include Nest CLI/testing, TypeScript, Jest, ts-jest, Supertest, and their type definitions. Exact dependency versions are recorded in `package-lock.json`.
