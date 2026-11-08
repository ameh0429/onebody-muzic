# OnebodyMusic backend

NestJS 11 REST API with strict TypeScript, PostgreSQL, Sequelize 6, `sequelize-typescript`, Swagger, and Jest. Requires Node.js 24 (recommended; see `package.json` for supported versions), npm, and PostgreSQL. Authentication and business CRUD endpoints are not implemented yet.

## Install and start

From the repository root:

```sh
cd onebodymusic-backend
npm ci
cp .env.example .env
```

Preserve an existing `.env`. On Windows PowerShell use `Copy-Item .env.example .env`. Set `POSTGRES_PASSWORD` to your own local password, and set matching URL-encoded credentials in `DATABASE_URL`. Then start the provided local database (Docker Compose required), migrate, and start the API:

```sh
docker compose up -d --wait
npm run db:migrate
npm run start:dev
```

An existing PostgreSQL 17+ database also works; set its `DATABASE_URL` and omit the Compose command. The Compose service binds to loopback and persists data in a named volume. Changing `POSTGRES_PASSWORD` does not change credentials already stored in that volume. Never delete a database volume to resolve a production migration problem.

Production commands:

```sh
npm ci
npm run build
npm run db:migrate:prod
npm run start:prod
```

Sequelize has no client-generation step or separate engine download. Schema changes run through explicit Umzug migrations, tracked in `SequelizeMeta`; automatic synchronization is disabled in every environment. Run migrations as a deployment step, before starting application instances. The migration runner serializes concurrent CLI invocations using a PostgreSQL advisory lock. Use a migration account with DDL permissions and a restricted application account where practical.

## Configuration

Environment variables override `.env`; `.env` is untracked.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection URL; URL-encode special characters in credentials. |
| `CORS_ALLOWED_ORIGINS` | Required comma-separated exact HTTP(S) origins. No wildcards, paths, or trailing slashes. |
| `PORT` | Integer 1–65535, default `3000`. |
| `NODE_ENV` | `development`, `test`, or `production`; default `development`. |
| `POSTGRES_PASSWORD` | Password for the optional Compose database; match it in `DATABASE_URL`. |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Required only for the explicit initial administrator seed. |
| `TEST_DATABASE_URL` | Dedicated, migrated PostgreSQL database for integration tests. |

For a remote database, use its required TLS configuration (for example, the provider's verified `sslmode=verify-full` connection URL and trusted CA). Never disable certificate validation. No production secrets or administrator credentials are included in this repository.

CORS controls browser access, not authentication. Unapproved browser origins receive no allow-origin header. API clients without an Origin header remain usable.

## Swagger and health

Open `http://localhost:3000/api/docs`. Expand **Health → GET /api/v1/health**, choose **Try it out**, then **Execute**. The OpenAPI JSON is at `/api/docs-json`. **Authorize** supports bearer JWT tokens for future protected endpoints; health remains public, and this task implements no authentication.

```sh
curl http://localhost:3000/api/v1/health
```

Example `200 OK`:

```json
{
  "status": "ok",
  "service": "onebodymusic-backend",
  "timestamp": "2026-11-07T12:00:00.000Z"
}
```

Health is a process liveness check, not an ongoing database readiness probe. Nest's Sequelize integration authenticates before HTTP startup and closes its connection pool during application shutdown. The API fails startup if the database cannot be reached. Shutdown hooks handle termination signals.

Global validation transforms request DTOs, permits declared fields only, and rejects extra fields. Health accepts no request body, so no unused request DTO is introduced. Test-only routes verify shared validation behavior.

Errors use a consistent schema:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Cannot GET /api/v1/missing",
  "path": "/api/v1/missing",
  "timestamp": "2026-11-07T12:00:00.000Z"
}
```

Validation errors return `400` and a string array in `message`. Unexpected errors return a generic `500` message without internal details.

## Models and migrations

The seven models are `User`, `Artist`, `Album`, `Song`, `Playlist`, `PlaylistSong`, and `Rehearsal`. Models use UUID primary and foreign keys, timestamp columns, explicit association aliases, and indexes for foreign keys and common filters. PostgreSQL generates UUID defaults; Sequelize manages `updatedAt` for ORM writes. Direct SQL writers must supply/update timestamps themselves.

- User email is unique. New users default to `MEMBER`/`PENDING`; playlists default to `PERSONAL`.
- Referenced users, artists, songs, and rehearsal playlists have restrictive deletion policies.
- Deleting an album sets optional song album links to null.
- Deleting an unreferenced playlist cascades its join entries.
- Unique `(playlistId, songId)` prevents duplicate songs; unique `(playlistId, position)` prevents order collisions.
- Playlist positions are zero-based and nonnegative; optional duration cannot be negative. SQL migrations maintain these check constraints.
- Rehearsals may share a playlist. Album/artist consistency and rehearsal playlist type need future service-level business validation; ordinary foreign keys do not enforce them.

Use a transaction and unused temporary positions when reordering playlists to avoid intermediate unique-position collisions. Email writers should normalize email consistently with the seed (trim and lowercase).

```sh
npm run db:migrate    # Apply pending migrations
npm run db:status     # Show applied/pending migration names
npm run db:rollback   # Revert the latest migration: destructive, development only
```

The initial rollback drops all seven application tables and enum types. Use it only on disposable development/test databases. Future migrations belong in `src/database/migrations/` and must be registered, in order, in `src/database/migrator.ts`. Keep applied migration files immutable; deploy a new migration for later changes. Never use `sequelize.sync({ alter: true })` or `force: true`.

Import `DatabaseModule` into a feature module to use the exported model providers. Use `@InjectModel(User)` for model injection or `@InjectConnection()` for Sequelize transactions. Keep business logic in services and return explicit response DTOs.

## Safe administrator seed

Set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` securely in your untracked `.env` or process environment, then run:

```sh
npm run db:seed
# Or, after compiling:
npm run db:seed:prod
```

No administrator credentials are supplied. Passwords must be 16–128 characters and are hashed with Argon2id (19 MiB memory, two iterations, one lane). The seed normalizes email and creates an `ACTIVE` `ADMIN` once. Repeated or concurrent runs preserve existing credentials. An existing member, pending, or suspended account causes failure without promotion, reactivation, or password reset. Seed output contains no credentials or hashes. Remove seed credentials from the runtime environment afterward; rotation is a separate explicit operation.

`User` excludes `passwordHash` from default queries, and its JSON serialization redacts the hash even on freshly created or unscoped instances. Explicit unscoped/raw queries can still retrieve it for future authentication logic; never return such data directly in HTTP responses. Use explicit response DTOs for future user endpoints.

## Validation

```sh
npm run typecheck
npm test
npm run build
```

HTTP tests replace `DatabaseModule`, so they do not require a database. They cover health, versioning, validation, CORS, Helmet, error sanitization, Swagger UI assets, and OpenAPI metadata. Configuration tests verify required settings and that schema synchronization stays disabled.

For PostgreSQL integration checks, create a dedicated test database and apply migrations with `DATABASE_URL` pointing to that database. Set `TEST_DATABASE_URL` to the same database securely, then run:

```sh
npm run test:db
```

Integration tests create uniquely named fixtures and remove only those fixtures. They cover migrations, hashing, seed idempotence and concurrency, associations, serialization, constraints, deletion policies, and pool cleanup. Never point tests at production.

## Project structure

```text
src/
  main.ts
  app.module.ts
  configure-app.ts
  config/environment.ts
  common/
    dto/api-error.dto.ts
    filters/http-exception.filter.ts
  database/
    database.module.ts
    database-options.ts
    connection.ts
    models/index.ts
    migrations/001-initial-schema.ts
    migrator.ts
    migrate.ts
    seed-admin.ts
    seed.ts
  health/
    health.module.ts
    health.controller.ts
    health.service.ts
    dto/health-response.dto.ts
test/
  app.e2e-spec.ts
  database.integration.ts
compose.yaml
.env.example
```

Runtime dependencies include NestJS core/config/platform/Swagger, `@nestjs/sequelize`, `sequelize`, `sequelize-typescript`, `pg`, `pg-hstore`, `umzug`, `argon2`, `dotenv`, Helmet, class-validator/transformer, reflect-metadata, and RxJS. Development tooling includes Nest CLI/testing, TypeScript, Jest/ts-jest, Supertest, and tsx. Exact versions are recorded in `package-lock.json`.
