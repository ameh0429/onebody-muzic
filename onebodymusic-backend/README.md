# OnebodyMusic backend

NestJS 11 REST API with strict TypeScript, PostgreSQL, Sequelize 6, `sequelize-typescript`, Swagger, and Jest. Requires Node.js 24 (recommended; see `package.json` for supported versions), npm, and PostgreSQL. Member registration, JWT authentication, user administration, and artist management are implemented. Other library modules remain deferred.

## Install and start

From the repository root:

```sh
cd onebodymusic-backend
npm ci
cp .env.example .env
```

Preserve an existing `.env`. On Windows PowerShell use `Copy-Item .env.example .env`. Set `POSTGRES_PASSWORD` to your own local password, set matching URL-encoded credentials in `DATABASE_URL`, and configure a strong random `JWT_SECRET` (at least 32 characters). Then start the provided local database (Docker Compose required), migrate, and start the API:

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
| `JWT_SECRET` | Required random signing secret, at least 32 characters; no default. |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | Integer 60–3600; default 900 (15 minutes). |
| `PORT` | Integer 1–65535, default `3000`. |
| `NODE_ENV` | `development`, `test`, or `production`; default `development`. |
| `POSTGRES_PASSWORD` | Password for the optional Compose database; match it in `DATABASE_URL`. |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Required only for the explicit initial administrator seed. |
| `TEST_DATABASE_URL` | Dedicated, migrated PostgreSQL database for integration tests. |

For a remote database, use its required TLS configuration (for example, the provider's verified `sslmode=verify-full` connection URL and trusted CA). Never disable certificate validation. No production secrets or administrator credentials are included in this repository.

CORS controls browser access, not authentication. Unapproved browser origins receive no allow-origin header. API clients without an Origin header remain usable.

## Swagger and health

Open `http://localhost:3000/api/docs`. Expand **Health → GET /api/v1/health**, choose **Try it out**, then **Execute**. The OpenAPI JSON is at `/api/docs-json`. **Authorize** accepts the `accessToken` returned by login. Paste the token without the `Bearer` prefix; Swagger adds it automatically. Health remains public.

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

Health is a process liveness check, not an ongoing database readiness probe. Nest's Sequelize integration authenticates before HTTP startup and closes its connection pool during application shutdown. The API fails startup if the database cannot be reached or required JWT settings are invalid. Shutdown hooks handle termination signals.

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

`User` excludes `passwordHash` from default queries, and its JSON serialization redacts the hash even on freshly created or unscoped instances. Explicit unscoped/raw queries can still retrieve it for credential verification; never return such data directly in HTTP responses. Use explicit response DTOs for user endpoints.

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
  auth/
    auth.module.ts
    auth.controller.ts
    auth.service.ts
    auth.repository.ts
    dto/
    strategies/jwt.strategy.ts
    guards/
    decorators/
    validators/passwords-match.validator.ts
test/
  app.e2e-spec.ts
  database.integration.ts
  auth.e2e-spec.ts
  auth.database.integration.ts
compose.yaml
.env.example
```

Runtime dependencies include NestJS core/config/platform/Swagger, `@nestjs/sequelize`, `@nestjs/passport`, `@nestjs/jwt`, `passport`, `passport-jwt`, `sequelize`, `sequelize-typescript`, `pg`, `pg-hstore`, `umzug`, `argon2`, `dotenv`, Helmet, class-validator/transformer, reflect-metadata, and RxJS. Development tooling includes Nest CLI/testing, TypeScript, Jest/ts-jest, Supertest, and tsx. Exact versions are recorded in `package-lock.json`.


## Authentication and role authorization

Configure `JWT_SECRET` securely in the untracked `.env` or process environment before API startup. Generate a cryptographically random value locally, for example with Node's `crypto.randomBytes(48).toString('hex')`. Do not reuse example values or commit signing keys. `JWT_ACCESS_TOKEN_TTL_SECONDS` defaults to 900 seconds and must be 60–3600. Changing the secret invalidates existing tokens; changing the lifetime applies to newly issued tokens.

| Endpoint | Access | Result |
| --- | --- | --- |
| `POST /api/v1/auth/register` | Public | `201` sanitized MEMBER/PENDING profile; no token. |
| `POST /api/v1/auth/login` | Public, valid ACTIVE account | `200` access token, token type, lifetime, sanitized profile. |
| `GET /api/v1/auth/me` | Bearer JWT, current ACTIVE account | `200` current sanitized profile. |

Registration body:

```json
{
  "name": "Grace James",
  "email": "grace@example.org",
  "password": "A-long-example-passphrase!",
  "confirmPassword": "A-long-example-passphrase!"
}
```

Names are trimmed and must be 2–200 characters; email addresses are trimmed, lowercased, and validated (maximum 254 characters). Passwords must be 12–128 characters and contain a non-whitespace character; confirmation must match exactly. Passwords are never trimmed. Role, status, and other unknown request fields are rejected with `400`; duplicate email returns `409`, including concurrent requests. Passwords use Argon2id (19 MiB memory, two iterations, one lane). Registration does not allow immediate login: an ACTIVE administrator must approve the account through `PATCH /api/v1/users/:id/status`. Use the existing seeded ACTIVE administrator to approve the first members.

Login body:

```json
{
  "email": "grace@example.org",
  "password": "A-long-example-passphrase!"
}
```

Example successful response (requires an ACTIVE account):

```json
{
  "accessToken": "<signed-access-token>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": {
    "id": "6838918a-2b67-49ed-a90d-14b86ca955c7",
    "name": "Grace James",
    "email": "grace@example.org",
    "role": "MEMBER",
    "status": "ACTIVE",
    "createdAt": "2026-11-08T12:00:00.000Z",
    "updatedAt": "2026-11-08T12:00:00.000Z"
  }
}
```

Unknown email, wrong password, PENDING, and SUSPENDED accounts return the same `401` message: `Invalid email or password`. Invalid request formats return `400`. Tokens use HS256 with fixed issuer/audience validation and contain only `sub` (user UUID) plus standard `iat`, `exp`, `iss`, and `aud` claims. Roles, email addresses, passwords, and hashes are not token claims. Missing, malformed, forged, or expired tokens receive `401`. Tokens are accepted only from the Authorization bearer header, never URL parameters.

Every protected request reads the current user from PostgreSQL. Deleted or non-ACTIVE accounts receive `401` even with an unexpired token; role changes take effect on the next request. All auth responses use explicit safe DTOs and `Cache-Control: no-store`. Unexpected exception details are not logged, preventing database error messages from leaking credential material.

For role-restricted endpoints in future feature modules, import `AuthModule`, then apply both guards in this order:

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
```

`@Roles(Role.ADMIN, Role.MEMBER)` allows either role. Method roles override controller roles. `RolesGuard` denies authenticated users with a nonmatching current role with `403`. Use `@CurrentUser() user: UserResponseDto` to receive the sanitized, database-validated user. `@Roles()` is metadata; it requires the guards. No administrative or business test routes are shipped in the application.

Swagger provides request/response schemas, examples, and failure codes under **Authentication**. Log in with an ACTIVE account, copy `accessToken`, click **Authorize**, paste it without a prefix, and execute **GET /api/v1/auth/me**. Swagger does not persist authorization across page reloads. There are no refresh-token, logout, activation, or password-reset endpoints in this task; access tokens expire after their configured short lifetime.

Authentication HTTP/guard tests run with `npm test`. They exercise real Argon2 and JWT/Passport behavior with a repository test double. For real persistence checks, migrate a dedicated database, set `TEST_DATABASE_URL` securely, and run:

```sh
npm run test:auth:db
```

This command builds and starts a temporary compiled API against the test database, verifies persisted hashing, normalized email races, login, current profile, suspension and deletion revocation, then removes only uniquely named fixtures and stops its server. Never use a production database. Existing `npm run test:db` checks remain available. No schema migration is needed for authentication because the User fields already exist.

## User management

All user management endpoints require a bearer JWT and a currently ACTIVE account. They appear under **Users** in Swagger. No schema migration is required for this module.

| Method and path | Allowed roles | Behavior |
| --- | --- | --- |
| `GET /api/v1/users` | ADMIN | Paginated safe user profiles, optionally filtered by role/status. |
| `GET /api/v1/users/:id` | ADMIN | Safe profile for a UUID. |
| `PATCH /api/v1/users/:id/status` | ADMIN | Set `PENDING`, `ACTIVE` (approval), or `SUSPENDED`. |
| `PATCH /api/v1/users/:id/role` | ADMIN | Set `ADMIN` or `MEMBER`. |
| `PATCH /api/v1/users/me` | ADMIN, MEMBER | Update only your own name. |

List example: `/api/v1/users?page=1&limit=20&role=MEMBER&status=PENDING`. `page` defaults to 1 (range 1–1000000), and `limit` defaults to 20 (range 1–100). Results use descending creation time with UUID as a deterministic tie-breaker. Response shape:

```json
{
  "data": [],
  "page": 1,
  "limit": 20,
  "total": 0,
  "totalPages": 0
}
```

Pagination is based on the filtered total. A page beyond the last returns an empty `data` array. Filters are case-sensitive enums. Invalid or unknown query/body fields are rejected.

Example update bodies:

```json
{ "status": "ACTIVE" }
```

```json
{ "role": "ADMIN" }
```

```json
{ "name": "Grace James" }
```

Name updates require 2–200 characters after trimming. Profile updates reject email, password, role, status, identifiers, and other extra fields; the target is always the current authenticated user. Neither administrators nor members can change their own role or status, even to the existing value. This also applies to differently cased UUID spellings.

Role/status changes run in READ COMMITTED transactions, use a shared PostgreSQL transaction-level advisory lock, lock affected rows, and re-check the actor's current ACTIVE/ADMIN permissions inside the transaction. Removing the last active administrator through demotion or setting a non-ACTIVE status is rejected with `409`. Self-mutations return `403` first, including when the caller is the last administrator. Concurrent mutual demotion/suspension cannot eliminate all administrators. Direct SQL changes outside this API do not participate in its advisory-lock protocol.

Errors: `400` for invalid UUIDs/DTOs/query values; `401` for missing, expired, or revoked authentication; `403` for insufficient role, self-mutation, or actor permissions lost during a concurrent request; `404` for a missing target; `409` for last-active-admin protection. All responses use explicit safe DTOs without password hashes. Suspending a member prevents further authenticated requests using existing JWTs; role changes likewise take effect on the next request.

Service and HTTP authorization tests run in `npm test`. Real PostgreSQL/API tests include approval, profile updates, pagination, role/status changes, immediate JWT revocation, and concurrent administrator protection:

```sh
# Set TEST_DATABASE_URL securely to a dedicated migrated test database.
npm run test:users:db
```

Tests remove only their uniquely named fixtures. User management code is under `src/users/` with `UsersModule`, `UsersController`, `UsersService`, pagination/update DTOs, and service tests. There is no user deletion endpoint in this task.

## Artists

Artist routes appear under **Artists** in Swagger and require a JWT for a currently ACTIVE user. ADMIN accounts can create/update/delete; both roles can read.

| Method and path | Access | Response |
| --- | --- | --- |
| `POST /api/v1/artists` | ADMIN | `201` artist profile with counts. |
| `GET /api/v1/artists` | Authenticated | `200` paginated profiles with counts. |
| `GET /api/v1/artists/:id` | Authenticated | `200` artist details with counts. |
| `PATCH /api/v1/artists/:id` | ADMIN | `200` updated profile. |
| `DELETE /api/v1/artists/:id` | ADMIN | `204` with no body, only if no albums or songs reference it. |

Apply the new uniqueness migration before using these endpoints:

```sh
npm run db:migrate
npm run db:status
npm run start:dev
```

Migration `002-artist-name-uniqueness` adds a PostgreSQL unique expression index using lowercasing and surrounding/repeated whitespace normalization. Existing duplicate normalized names make the migration fail safely; it does not rename, merge, or delete existing profiles. Resolve duplicates deliberately, preserving references, then retry. To identify existing conflicts in pgAdmin:

```sql
SELECT lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))) AS normalized_name,
       array_agg(id) AS artist_ids, count(*) AS occurrences
FROM "Artist"
GROUP BY lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))
HAVING count(*) > 1;
```

Rolling back this migration removes only the unique index. Keep it applied to preserve name uniqueness across concurrent requests and multiple API instances.

Example create body:

```json
{
  "name": "Hillsong Worship",
  "biography": "Church worship music collective.",
  "imageUrl": "https://images.example.org/artists/hillsong.jpg",
  "imagePublicId": "onebodymusic/artists/hillsong"
}
```

Only `name` is required. Names are trimmed and repeated whitespace is collapsed, preserving display case, and must be 1–200 characters. Case-insensitive duplicate names return `409` on both create and update. Biography is optional (up to 5000 characters); image URLs must be valid HTTPS URLs without embedded credentials (up to 2048 characters), and image public IDs are optional strings of 1–255 characters. Image fields are references only: this module uploads, downloads, and deletes no files. File upload endpoints are deferred.

PATCH accepts the same fields, all optional, with at least one field required. Omitted fields stay unchanged; biography and either image reference may be explicitly cleared with `null`. A name cannot be `null` or blank. Unknown fields are rejected.

List example: `/api/v1/artists?page=1&limit=20&search=hillsong`. Page defaults to 1 (1–1000000), limit to 20 (1–100). Search is a case-insensitive literal substring; `%`, `_`, and backslash do not act as wildcards. Results are ordered by name then UUID and use `{ data, page, limit, total, totalPages }`. Each profile includes `id`, `name`, `biography`, `imageUrl`, `imagePublicId`, `createdAt`, `updatedAt`, `albumCount`, and `songCount`. Counts use independent indexed database subqueries, avoiding inflated counts from joining albums to songs.

Updates and deletes lock the artist row inside a transaction. Deletion returns `409` if any album or song references the artist; existing restrictive foreign keys remain the final protection against concurrent inserts. Remove/reassign references explicitly before retrying; the API never cascades deletion of music records or media. Invalid DTOs/UUIDs/query fields return `400`, missing or invalid authentication `401`, member writes `403`, and missing profiles `404`, using the shared JSON error format.

Sources are in `src/artists/` (`ArtistsModule`, thin `ArtistsController`, `ArtistsService`, DTOs, and service tests). Validation/authorization tests run in `npm test`. For a dedicated migrated PostgreSQL database with `TEST_DATABASE_URL` configured:

```sh
npm run test:artists:db
```

The integration test starts the compiled API and checks role access, create/update/concurrent uniqueness, literal search, pagination, optional-field clearing, album/song counts, and safe deletion. It cleans up only uniquely named test fixtures.
