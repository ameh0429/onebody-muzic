# OnebodyMusic backend

NestJS 11 REST API with strict TypeScript, PostgreSQL, Sequelize 6, `sequelize-typescript`, Swagger, and Jest. Requires Node.js 24 (recommended; see `package.json` for supported versions), npm, and PostgreSQL. Member registration, JWT authentication, user administration, artist management, and album management, secure media uploads, and song management/playback are implemented. Other library modules remain deferred.

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
| `MEDIA_ENABLED` | `false` by default; enable after configuring server-side Cloudinary credentials. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Required only when media is enabled; never commit real values. |
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

The application models are `User`, `Artist`, `Album`, `Song`, `Playlist`, `PlaylistSong`, `Rehearsal`, and `MediaAsset`. Models use UUID primary and foreign keys, timestamp columns, explicit association aliases, and indexes for foreign keys and common filters. PostgreSQL generates UUID defaults; Sequelize manages `updatedAt` for ORM writes. Direct SQL writers must supply/update timestamps themselves.

- User email is unique. New users default to `MEMBER`/`PENDING`; playlists default to `PERSONAL`.
- Referenced users, artists, songs, and rehearsal playlists have restrictive deletion policies.
- Albums containing songs cannot be deleted; explicitly unlink/reassign their songs first.
- Deleting an unreferenced playlist cascades its join entries.
- Unique `(playlistId, songId)` prevents duplicate songs; unique `(playlistId, position)` prevents order collisions.
- Playlist positions are zero-based and nonnegative; optional duration cannot be negative. SQL migrations maintain these check constraints.
- Rehearsals may share a playlist. Album artist changes are blocked while songs exist. Future song-writing services must also validate album/artist consistency, and rehearsal services must validate playlist type; ordinary foreign keys do not enforce these business rules.

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

## Profile pictures

After updating the backend, run `npm run db:migrate` (or `npm run db:migrate:prod`
for compiled deployments) before restarting it. Migration `009-user-profile-picture`
adds nullable user picture fields, a tracked media reference, and the fixed
`onebodymusic/profiles` image namespace. Existing accounts keep their initial avatar.

Active members and administrators can `POST /api/v1/users/me/picture` with a
multipart `file` field to upload/replace their own picture, and
`DELETE /api/v1/users/me/picture` to remove it. Both return the sanitized user,
including nullable `profileImageUrl`; login and `/auth/me` return the same field.
No target user ID, provider URL, storage key, or destination is accepted from the client.
JPEG, PNG and WebP use the existing image MIME/signature/extension validation,
`MEDIA_IMAGE_MAX_BYTES` limit (5 MiB by default), upload capacity and deadline.
Cloudinary configuration and `MEDIA_ENABLED=true` are required for uploads.
Removing an existing picture works even while uploads are disabled.

Pictures use public Cloudinary image delivery: they are not private authenticated
media. Old pictures are queued for the existing cleanup worker after replacement
or removal; active pictures are excluded from staged-upload expiry. Failed uploads
preserve the previous picture. Database guards protect ownership/readiness and
prevent cleanup of a referenced profile image. Keep the media worker running.

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

## Albums

Album routes appear under **Albums** in Swagger. All reads require an ACTIVE authenticated account; writes require ADMIN. Controllers delegate business logic to `AlbumsService`.

| Method and path | Access | Result |
| --- | --- | --- |
| `POST /api/v1/albums` | ADMIN | `201` album details with artist and an initially empty song array. |
| `GET /api/v1/albums` | Authenticated | `200` paginated summaries with artist and song count. |
| `GET /api/v1/albums/:id` | Authenticated | `200` album details with associated song metadata. |
| `PATCH /api/v1/albums/:id` | ADMIN | `200` updated details. |
| `DELETE /api/v1/albums/:id` | ADMIN | `204` without a body, only for an empty album. |

Apply migration `003-album-constraints` before running the updated API:

```sh
npm run db:migrate
npm run db:status
npm run start:dev
```

This migration adds a case-insensitive normalized-title unique index scoped to `artistId`, an index for release-year filtering, and changes `Song.albumId` deletion behavior from `SET NULL` to `RESTRICT`. Populated albums can no longer be deleted by SQL or by the API without first explicitly unlinking/reassigning their songs. No songs or references are automatically changed by the migration. The initial migration remains immutable.

Existing duplicate titles for the same artist cause migration failure without data modification. Identify them in pgAdmin with:

```sql
SELECT "artistId",
       lower(btrim(regexp_replace(title, '[[:space:]]+', ' ', 'g'))) AS normalized_title,
       array_agg(id) AS album_ids, count(*) AS occurrences
FROM "Album"
GROUP BY "artistId", lower(btrim(regexp_replace(title, '[[:space:]]+', ' ', 'g')))
HAVING count(*) > 1;
```

Resolve conflicts explicitly while preserving songs, then retry. Reversing migration 003 removes its indexes and restores the legacy `SET NULL` foreign-key policy; use rollback only on disposable development databases.

Example create body (replace the artist UUID with an existing artist):

```json
{
  "title": "Songs of Praise",
  "artistId": "6838918a-2b67-49ed-a90d-14b86ca955c7",
  "releaseYear": 2024,
  "coverImageUrl": "https://images.example.org/albums/praise.jpg",
  "coverImagePublicId": "onebodymusic/albums/praise"
}
```

Title and artist UUID are required; release year is required on create as a JSON integer from 1–9999. Existing legacy rows with an unknown year remain readable as `null`. Titles are trimmed, repeated whitespace is collapsed, and the maximum length is 200. Case-insensitive title duplicates within the same artist return `409`, independent of release year; the same title for a different artist is allowed. Distinct editions by one artist should use distinct titles.

Artwork references are optional. Cover URLs must be HTTPS without embedded credentials (maximum 2048 characters); public IDs must be strings of 1–255 characters. No file fetching, uploads, audio uploads, or media deletion is implemented. PATCH requires at least one recognized field. Omitted fields remain unchanged; artwork may be cleared with `null`, while title, artist ID, and release year may not be null.

The service validates and locks the referenced artist before inserting/updating. Artist reassignment is allowed only on empty albums; populated albums return `409` to avoid leaving existing songs associated with a different artist. Same-artist edits remain allowed, including differently cased UUID spellings. Album changes and deletion use transactions and row locks; the restrictive foreign key protects against concurrent song creation during deletion.

List example:

```text
/api/v1/albums?page=1&limit=20&artistId=<artist-uuid>&releaseYear=2024&search=praise
```

Filters combine with AND. Search is a case-insensitive literal title substring; SQL wildcard characters are escaped. Page defaults to 1 (1–1000000), and limit to 20 (1–100). Summaries are ordered by title then UUID and return `{ data, page, limit, total, totalPages }`. Listing by an existing-format but unknown artist UUID returns an empty page, not `404`.

Single-album details and create/update responses include `songs`, ordered by title then UUID. Each song exposes only `id`, `title`, `artistId`, `category`, and `durationSeconds`; internal audio resource references and uploader information are not exposed. Summaries include `songCount`, and artist references contain `id` and `name`. Song arrays are loaded separately from the album query to avoid pagination/count inflation.

Errors use the shared JSON format: `400` for invalid input, `401` for invalid/inactive authentication, `403` for unauthorized writes, `404` for a missing album or artist on writes, and `409` for duplicate titles, populated deletion/reassignment, or concurrent reference conflicts.

Implementation and unit tests are in `src/albums/`. Run `npm test`, `npm run typecheck`, and `npm run build`. For real PostgreSQL checks, migrate a dedicated test database, set `TEST_DATABASE_URL` securely, and run:

```sh
npm run test:albums:db
```

The integration suite verifies authorization, existing artist validation, per-artist and concurrent uniqueness, combined filters/search/pagination, artwork updates, associated song details, populated deletion at API and database levels, and empty-album deletion. It removes only its uniquely named fixtures. Existing artist/database tests now verify restrictive album deletion rather than the superseded automatic unlinking policy.

## Secure media uploads (Cloudinary)

The **Media** Swagger tag contains the multipart endpoints. All three require an ACTIVE ADMIN; members cannot upload or delete assets. This project uses Sequelize, so media tracking is installed through Sequelize migration `004-media-assets`, not Prisma.

### Configure and run

In the untracked `.env` or a secure server-side runtime environment, supply your own Cloudinary product-environment credentials and explicitly enable media:

```env
MEDIA_ENABLED=true
CLOUDINARY_CLOUD_NAME=<your-cloud-name>
CLOUDINARY_API_KEY=<your-api-key>
CLOUDINARY_API_SECRET=<your-api-secret>
MEDIA_AUDIO_MAX_BYTES=26214400
MEDIA_IMAGE_MAX_BYTES=5242880
MEDIA_MAX_CONCURRENT_UPLOADS=2
MEDIA_CLEANUP_INTERVAL_SECONDS=60
MEDIA_STALE_UPLOAD_SECONDS=900
```

The angle-bracket values are placeholders. Never commit credentials or put them in frontend code. The SDK needs the real server-side secret for cryptographic signing; an outbound HTTP proxy's credential placeholder cannot substitute for that signing value. No Cloudinary credentials, upload signatures, or raw SDK responses are returned by the API or logged.

Media is disabled by default so the existing application can start without Cloudinary. When enabled, all three credential settings are required at startup. Disabled uploads return `503` before buffering files. The cleanup scheduler is also disabled while media is disabled; restore configuration and enable it to resume pending cleanup.

```sh
npm ci
npm run db:migrate
npm run start:dev
```

Defaults are 25 MiB for audio, 5 MiB for images, and two concurrent buffered uploads per API process. Audio limits can be configured from 1 KiB to 100 MiB, images from 1 KiB to 20 MiB, and concurrency from 1–8. Cloudinary's account limits may be lower. Multer enforces limits during parsing; the service checks buffer size again. Upload concurrency is bounded before multipart buffering. Size/concurrency changes must fit the deployment's memory budget, especially across multiple processes.

The Cloudinary SDK uses the inherited HTTPS proxy through a verified proxy agent when configured; TLS verification stays enabled. In managed cloud environments allow outbound HTTPS to `api.cloudinary.com` for uploads/deletion and `res.cloudinary.com` for the audio gateway. The current environment draft also requests `cloudinary.com` for official documentation. Draft changes require review/save and publication to activate in a reusable environment. Local development uses your local network policy.

### Endpoints and Swagger

| Method and path | Multipart/body | Result |
| --- | --- | --- |
| `POST /api/v1/media/audio` | Exactly one `file`: MP3 or audio-only M4A. No other fields. | `201` authenticated audio metadata. |
| `POST /api/v1/media/images` | One `file`: JPEG/PNG/WebP; `folder`: `artists`, `albums`, or `songs`. | `201` public-image metadata. |
| `DELETE /api/v1/media/:id` | Internal MediaAsset UUID, not a Cloudinary ID or path. | `204` on confirmed deletion or an existing deleted tombstone. |

Log in through Swagger, click **Authorize**, paste `accessToken` without a prefix, open the upload operation, and click **Try it out**. The `file` property is a real file picker. Choose an image destination from the enum dropdown. Let Swagger/browser set the multipart boundary; do not manually set `Content-Type` when using FormData.

Accepted declared audio MIME types: `audio/mpeg`/`audio/mp3` for `.mp3`, and `audio/mp4`/`audio/x-m4a`/`audio/m4a` for `.m4a`. Accepted image MIME types are `image/jpeg`, `image/png`, and `image/webp`, matching `.jpg`/`.jpeg`, `.png`, and `.webp` respectively. Generic octet-stream, SVG, GIF, MP4 video, unsupported extensions, and mismatched declarations are rejected.

Validation checks magic bytes as well as declared MIME and extension. MP3 requires two complete Layer III frames after an optional bounded ID3 header; audio-only M4A validates MP4 boxes and audio handler tracks while rejecting video tracks. Image signatures are checked locally and Cloudinary must successfully ingest the allowed format before READY status is saved. These practical signature/container checks do not replace antivirus or full local codec decoding. Filenames must start with a letter or digit, contain only letters/digits/spaces/dots/underscores/parentheses/hyphens, be at most 180 characters, and contain no `..`, path separators, or control characters. The original filename is never used as a storage key or persisted.

Storage uses server-generated UUIDs in exactly these namespaces:

```text
onebodymusic/audio/<uuid>
onebodymusic/artists/<uuid>
onebodymusic/albums/<uuid>
onebodymusic/songs/<uuid>
```

The SDK supplies the fixed folder and UUID, with client filenames ignored and overwriting disabled. Callers cannot choose folders beyond the image enum, public IDs, delivery types, resource types, or upload presets.

Successful metadata contains `id`, `kind`, `status`, `folder`, `publicId`, `resourceType`, `deliveryType`, `format`, `mimeType`, `bytes`, `duration`, `width`, `height`, `url`, and `createdAt`. Unavailable dimensions/duration are null. For example, audio returns:

```json
{
  "id": "6838918a-2b67-49ed-a90d-14b86ca955c7",
  "kind": "AUDIO",
  "status": "READY",
  "folder": "onebodymusic/audio",
  "publicId": "onebodymusic/audio/6838918a-2b67-49ed-a90d-14b86ca955c7",
  "resourceType": "video",
  "deliveryType": "authenticated",
  "format": "mp3",
  "mimeType": "audio/mpeg",
  "bytes": 1048576,
  "duration": 240,
  "width": null,
  "height": null,
  "url": null,
  "createdAt": "2026-11-08T12:00:00.000Z"
}
```

### Audio privacy and delivery restrictions

Audio uses Cloudinary's `resource_type: video` (also used for audio files) and **`type: authenticated`**. Authenticated delivery protects originals and derived assets; ordinary upload URLs or the mere use of HTTPS are not private. The service verifies the returned delivery/resource type before accepting the upload and never returns the SDK's raw `secure_url`, signature, or a signed audio URL. Images intentionally use public `upload` delivery and may be viewed by anyone with their URL.

Media upload endpoints do not issue audio delivery URLs; song playback is described below. A OnebodyMusic JWT is not a Cloudinary CDN credential. Playback authorizes the current ACTIVE member through the expiring application gateway described in the Songs section. A basic signed transformation URL is shareable and does not automatically expire; token-based CDN authentication can require account/CDN features. Do not convert the audio asset or derived copies to public delivery, and do not treat a hidden public URL as access control. Membership suspension cannot revoke bytes already downloaded or an independently valid CDN URL; playback design needs short lifetimes or gateway enforcement.

Before production use, verify that your Cloudinary product environment/plan supports authenticated video/audio delivery and the selected audio formats. Confirm that an unsigned request to a test authenticated original and derived asset is denied, and that the intended authorized delivery flow succeeds. Live account/CDN behavior cannot be established by local SDK mocks. Official guidance: [Cloudinary access control](https://cloudinary.com/documentation/control_access_to_media).

### Tracking, attachment, deletion, and recovery

`MediaAsset` stores owner/uploader ID, kind, status, deterministic Cloudinary public ID, resource/delivery types, format, MIME, byte size, dimensions/duration, and timestamps. API credentials are never stored in it. All ADMINs manage church-owned assets; uploader identity is retained for audit, rather than restricting deletion to the original uploader.

A committed UPLOADING reservation is created **before** any provider call. A row lock protects the upload and final metadata update. If the initial database write fails, no provider upload starts. If uploading or finalization fails, the transaction rolls back, cleanup uses the reserved ID, and the durable reservation survives. Failed compensation remains `CLEANUP_PENDING`; the scheduler retries. Provider errors are sanitized; a failed initial/final database operation returns `503`, a failed provider operation `502`, invalid input `400`, unsupported media `415`, excessive bytes `413`, and exhausted upload slots `429`.

For image attachment, save **both** the returned `publicId` and `url` using the appropriate existing library fields:

- Artist: `imagePublicId` and `imageUrl`, using folder `artists`.
- Album: `coverImagePublicId` and `coverImageUrl`, using folder `albums`.
- Song artwork: `coverImagePublicId` and `coverImageUrl`, using folder `songs` when song writing is implemented.
- Song audio: `audioPublicId` and `audioResourceType`, using the authenticated audio metadata when song writing is implemented.

The public ID is the authoritative tracked reference. A URL alone does not associate a staged asset with a database record and does not protect it from expiry. Legacy external references remain supported, but they are not imported into MediaAsset or automatically cleaned up.

Database triggers validate READY status, folder/kind compatibility, and audio resource type when a managed public ID is attached. They take row locks to serialize attachment against deletion, preventing a new record from linking an asset that is being removed. Attempts to attach non-ready, deleted, or wrong-folder tracked media return `409`. Storage identity is immutable; live tracking rows cannot be hard-deleted before confirmed remote deletion.

Deletion resolves only the internal asset UUID and stored identity, rejects referenced assets with `409`, durably commits cleanup intent before contacting the provider, calls Cloudinary destroy with the stored resource/delivery types and cache invalidation, and retains a DELETED tombstone. Unknown UUIDs return `404`; repeated confirmed deletion is harmless. Public-image CDN invalidation is asynchronous, so deletion confirmation is not a promise that every cached copy vanishes immediately.

The worker starts when media is enabled and runs every 60 seconds by default. It processes bounded batches with SKIP LOCKED and no overlapping pass per process. In-flight uploads remain protected by their row locks. Stale UPLOADING reservations and uncertain failures are reconciled after the configured grace period (default 15 minutes, minimum 10 minutes), allowing late provider completion after timeouts. Unreferenced READY uploads are staging assets and expire after **24 hours**; attach them to library records promptly. Linked assets are not expired. Cleanup stops before database shutdown.

Cloudinary and PostgreSQL cannot share an atomic transaction: during outages, remote files may temporarily remain, but their committed storage keys remain available for reconciliation. Monitor unresolved UPLOADING/CLEANUP_PENDING records and restore database/provider access so retry can complete. Do not discard tracking data or reset the database while media remains. Migration rollback refuses to drop media tracking while any non-DELETED assets exist.

### Automated verification

```sh
npm run typecheck
npm test
npm run build
# Apply migrations to a dedicated database, then set TEST_DATABASE_URL securely:
npm run test:media:db
```

Jest covers real signatures/container checks, all supported formats, invalid/oversized files, unauthorized/member requests, fixed destinations, concurrency limits, safe provider options, upload failures, database finalization failures, compensation, deletion, and scheduler shutdown. PostgreSQL integration uses real authentication, multipart handling, transactions, and triggers with **only Cloudinary replaced by a test double**. It verifies persisted ownership/status, failure recovery, stale/unattached cleanup, referenced-file protection, incompatible attachments, and attachment/deletion races. It does not contact or validate a live Cloudinary account.

Implementation is under `src/media/`: module/controller/service, Cloudinary adapter, file inspector, multipart/capacity interceptors, repository, cleanup worker, DTOs, and tests. Media uploads remain isolated in this module; the Songs module below provides authorized playback and attachment.

## Songs and secure audio playback

The **Songs** Swagger tag provides ADMIN song creation/update/deletion and authenticated listing/details/playback. Apply Sequelize migration `005-song-media-assets` before starting:

```sh
npm run db:migrate
npm run start:dev
```

Migration 005 adds nullable `audioAssetId` and `coverAssetId` foreign keys, a unique non-null audio asset index, and consistency triggers linking those IDs to the stored Cloudinary identifiers. Existing song rows remain intact; legacy rows without a tracked audio asset remain readable, but playback returns `409` until an administrator assigns an appropriate uploaded audio asset through PATCH. There is no automatic adoption of untracked provider IDs.

| Method and path | Access | Result |
| --- | --- | --- |
| `POST /api/v1/songs` | ADMIN | `201` safe song metadata. |
| `GET /api/v1/songs` | Authenticated | `200` paginated safe metadata. |
| `GET /api/v1/songs/:id` | Authenticated | `200` song with artist/album metadata. |
| `PATCH /api/v1/songs/:id` | ADMIN | `200` updated safe metadata. |
| `DELETE /api/v1/songs/:id` | ADMIN | `204`; playlist-referenced songs return `409`. |
| `GET /api/v1/songs/:id/stream` | Access JWT or scoped playback ticket | JWT requests issue a short-lived playback URL; ticket requests stream authenticated provider bytes. |

### Create and update

First upload audio through `POST /api/v1/media/audio` using the same administrator account. Supply the returned **internal asset `id`**, not its Cloudinary public ID:

```json
{
  "title": "Amazing Grace",
  "artistId": "a468f50d-33af-4fcf-93c8-e341bec66fd2",
  "albumId": null,
  "category": "Worship",
  "audioAssetId": "6838918a-2b67-49ed-a90d-14b86ca955c7",
  "coverAssetId": null
}
```

Title (1–200 characters), artist UUID, and audio asset UUID are required. Title whitespace is normalized. Category is optional, trimmed/collapsed text of 1–100 characters, and can be cleared with null. Album and cover IDs are optional and nullable. Covers, if supplied, must be READY image assets uploaded into `onebodymusic/songs`.

The artist must exist; a selected album must exist and belong to that artist. Audio must be READY, in the audio namespace, use authenticated `video` delivery, and be uploaded by the acting administrator. An audio asset can belong to only one song, including under concurrent requests. A different administrator cannot attach your unused upload. Metadata edits to an existing church-managed song are allowed to any ADMIN; retaining its unchanged current media is allowed without claiming another unused upload.

Duration is taken from provider metadata and rounded up to integer seconds (or null if unavailable). The server copies provider public ID/resource type itself; requests cannot supply those fields, a duration, or an uploader ID. Song responses omit provider audio identifiers, private provider URLs, and upload owner information. They include title, IDs, category, duration, artist name, optional album title/year, public cover URL, `hasAudioAsset`, and timestamps.

PATCH accepts a subset of the creation fields, with at least one field required. Required fields cannot be set to null. Changing an artist while retaining an incompatible album is rejected; change/clear the album in the same request. Replacement audio and new covers must meet the same ownership/readiness rules. Old, unreferenced tracked assets are marked CLEANUP_PENDING in the same database transaction, rather than making irreversible remote calls during a song write. Shared covers stay READY while referenced elsewhere.

All song writes serialize using a transaction-level advisory lock and lock the relevant album, artist, and media records. Database uniqueness and reference triggers remain the final protection. If creation fails, the uploaded asset remains a tracked READY staging upload, available for retry and subject to the existing 24-hour unattached cleanup policy. Deletion refuses songs used by playlists. After a successful delete, now-unused tracked media is queued for the existing durable cleanup worker. Legacy untracked provider files are never deleted by guessing their storage identity.

### Listing

Example:

```text
/api/v1/songs?page=1&limit=20&artistId=<uuid>&albumId=<uuid>&category=Worship&search=grace&sortBy=title&sortOrder=ASC
```

Filters combine with AND. Category is exact/case-sensitive; title search is a literal case-insensitive substring with wildcard characters escaped. Page defaults to 1 (1–1000000), limit to 20 (1–100). Sorting is whitelisted to `title` or `createdAt`, with `ASC`/`DESC` and a UUID tie-breaker; defaults are `createdAt`/`DESC`. The response is `{ data, page, limit, total, totalPages }` with artist and optional album metadata. Unknown filter UUIDs return empty pages; malformed values and unknown fields return `400`.

### Why playback uses expiring gateway tickets

Ordinary Cloudinary URL signatures do **not** enforce a short expiry. The application therefore keeps its signed `video/authenticated` provider URLs entirely inside the backend. It never redirects the browser to those URLs. Instead it issues a short-lived, song-specific signed **application playback URL**, and streams the provider response through an authorization gateway.

Playback tickets use a cryptographically separate derived signing key, fixed issuer/audience/purpose, user ID, song UUID, and expiry. They cannot authenticate to ordinary API endpoints, play another song, or mint new tickets. New ticket issuance always requires the normal access JWT. Every ticket request, including every new Range/HEAD request, verifies the ticket and re-reads the user from PostgreSQL; inactive, suspended, and deleted users receive `401`. All ACTIVE roles have library playback access. Already-started responses may finish, and downloaded bytes cannot be revoked.

Configuration:

```env
MEDIA_PLAYBACK_TTL_SECONDS=60
MEDIA_PLAYBACK_IDLE_TIMEOUT_SECONDS=30
```

Ticket lifetime is 15–300 seconds, default 60. Idle upstream timeout is 5–120 seconds, default 30. Cloudinary credentials and `MEDIA_ENABLED=true` are required for actual provider delivery; the signing secret is derived from the existing JWT secret and does not introduce a hardcoded key. Rotating JWT_SECRET also invalidates playback tickets. No additional Cloudinary token-auth/CDN account feature is assumed.

### Browser flow and redirects

With an access JWT, `GET /api/v1/songs/:id/stream` returns `302` with a relative `Location` pointing to the short-lived ticket URL and `X-Playback-Expires-At`. The destination remains this API; it is not a public/provider audio address.

A browser `<audio>` element cannot attach a custom Authorization header. Fetch ticket metadata with the access JWT, then assign the resulting short-lived URL as its source:

```js
const response = await fetch(`${API_ORIGIN}/api/v1/songs/${songId}/stream?redirect=false`, {
  headers: { Authorization: `Bearer ${accessToken}` }
});
if (!response.ok) throw new Error('Playback authorization failed');
const playback = await response.json();
audio.src = new URL(playback.url, API_ORIGIN).href;
await audio.play();
```

The JSON contains `{ url, expiresAt, expiresIn }`. Do not fetch the whole audio as a Blob or put the access JWT in a query string. The `ticket` query parameter accepts only short-lived playback credentials. A ticket request always streams, even with `redirect=false`; it cannot extend its own lifetime. Obtain a fresh URL using the access JWT before a later seek/reconnect after expiry, preserving `audio.currentTime` when resetting the source. An expired ticket receives `401` on a new request; an already-authorized response is not cut off merely because its ticket expires mid-transfer.

Ticket URLs are temporary bearer credentials: avoid storing them, redact the `ticket` parameter in reverse-proxy/access/analytics logs, and use HTTPS in production. Responses use `Cache-Control: private, no-store, max-age=0` and `Referrer-Policy: no-referrer`. Provider request headers contain no member JWT or cookies. Only safe audio type, length, range, and status headers are forwarded; provider redirects and provider URLs are not forwarded to clients.

### Seeking and bounded streaming

Native audio elements can request a single range such as `Range: bytes=0-1023`. The backend validates the range, sends it to Cloudinary's authenticated original, and returns the provider's `206`, `Content-Range`, `Content-Length`, and `Accept-Ranges: bytes`. Suffix/open ranges and HEAD are supported. Unsatisfiable ranges return `416` with `Content-Range: bytes */total`; malformed/multiple ranges return `400`. A provider that ignores a requested range or sends invalid range metadata is rejected with `502`, rather than silently downloading the whole file.

Node streams use backpressure and cancellation to pipe bytes to the response. The backend never collects the full file into memory. Client disconnects abort the provider request; idle upstream connections time out. Full responses return `200`. Cloudinary must support authenticated original audio delivery and byte ranges for the configured product environment. Live delivery/range behavior still needs verification with your account; provider-contract test doubles do not establish live CDN readiness.

Errors include `400` for input/artist-album mismatch, `401` for authentication/expiry/inactive accounts, `403` for unauthorized asset ownership or wrong song tickets, `404` for missing records, `409` for unavailable/reused media or playlist references, `416` for an unsatisfiable range, `502` for provider failures, and `503` for disabled/unconfigured delivery. Failures before response headers use the shared JSON error format; mid-stream failures terminate the response so clients can reauthorize/retry.

### Tests and implementation

Sources are under `src/songs/` (module, thin controller, service, DTOs, playback ticket service/guard) and `src/media/cloudinary-audio.gateway.ts`. The new Sequelize migration is `005-song-media-assets`.

```sh
npm run typecheck
npm test
npm run build
# Apply migrations to a dedicated test database, then set TEST_DATABASE_URL securely:
npm run test:songs:db
```

Tests cover song creation, missing/mismatched artists/albums, ownership and concurrent reuse, search/filter/pagination/sorting, unauthorized writes, safe DTOs, cleanup on replacement/deletion, real ticket expiry/signature separation, wrong-song tokens, suspension, redirect/JSON browser flow, Range/HEAD forwarding, and provider failures. PostgreSQL integration uses real JWT auth, transactions, tracking, and streaming controller code while replacing Cloudinary upload/delivery with test doubles. Live Cloudinary delivery is not claimed without credentials.

## Song lyrics

ADMIN users may include optional `lyrics` in `POST /api/v1/songs` or update it through the existing `PATCH /api/v1/songs/:id` endpoint:

```json
{
  "lyrics": "Amazing grace, how sweet the sound\nThat saved a wretch like me\n\nI once was lost, but now am found"
}
```

Lyrics are plain text, limited to 50,000 characters. Line breaks, Unicode, and surrounding whitespace are preserved exactly; the backend does not interpret HTML or apply title-style normalization. Null characters and non-string values are rejected with `400`. The existing overall JSON request-body size limit also applies. An omitted field leaves current lyrics unchanged on PATCH; `null` clears lyrics; an empty string is accepted as explicit empty text. Creation without lyrics stores null.

Authenticated ACTIVE members can read lyrics through `GET /api/v1/songs/:id`. Creation/update responses also include lyrics via `SongDetailResponseDto`. Paginated lists use `SongResponseDto` without lyrics and exclude the text column from their database query. Playback queries also exclude lyrics. No new endpoints or permissions are introduced, and audio playback behavior is unchanged.

Apply Sequelize migration `006-song-lyrics` before restarting the API:

```sh
npm run db:migrate
npm run start:dev
```

The migration adds nullable PostgreSQL TEXT with a 50,000-character check; existing songs receive null. Its rollback drops the column and therefore removes stored lyrics. Swagger documents the nullable field and detail response. Frontend consumers should render it as text and preserve line breaks (for example, `white-space: pre-wrap`), without rendering raw HTML.

Service/HTTP tests in `npm test` cover storing, reading, preserving, clearing, invalid types/length, permission checks, and list omission. `npm run test:songs:db` verifies the same persistence behavior against a dedicated migrated PostgreSQL database, including exact multiline/Unicode preservation.

## Playlists

Run `npm run db:migrate` before starting the updated application. Migration
`007-playlist-publication` adds `publicationStatus` (`DRAFT` / `PUBLISHED`),
visibility indexing, and a constraint keeping personal playlists private. Existing
playlists default to `DRAFT`; rehearsal playlists must be explicitly published.
This application uses Sequelize, including transactions for playlist writes.

All eight playlist endpoints under `/api/v1/playlists` require a JWT from login.
Use **Authorize** at `/api/docs` to try them. Members and administrators can manage
their own PERSONAL playlists. Personal playlists are private to their owner,
including against other administrators. Any active administrator can manage
REHEARSAL playlists. Members can read published rehearsal playlists but cannot
modify them. Draft rehearsals are visible only to administrators.

Create a personal playlist with `POST /api/v1/playlists`:

```json
{ "title": "My practice", "type": "PERSONAL", "description": "Weekly practice" }
```

An administrator can create a rehearsal playlist with:

```json
{ "title": "Sunday worship", "type": "REHEARSAL", "publicationStatus": "DRAFT" }
```

Publish or unpublish using `PATCH /api/v1/playlists/:id` with
`{"publicationStatus":"PUBLISHED"}` or `{"publicationStatus":"DRAFT"}`.
Personal playlists do not accept a publication status. Owner and type cannot be
changed. Metadata updates accept `title` and `description` (null clears description).

- `GET /api/v1/playlists?page=1&limit=20&type=REHEARSAL&publicationStatus=PUBLISHED`
  returns only visible playlists with pagination totals. Limit is 1–100.
- `GET /api/v1/playlists/:id` includes ordered songs with safe title, artist,
  duration and category metadata; audio provider identifiers are not returned.
- `POST /api/v1/playlists/:id/songs` accepts `{"songIds":["<song-uuid>"]}`.
  Add 1–100 existing songs per request, up to 1000 per playlist. Order follows the
  submitted array. Missing or duplicate songs reject the entire batch.
- `PATCH /api/v1/playlists/:id/songs/reorder` accepts the same shape containing
  **every current song ID exactly once**, in the desired order. Empty lists are
  valid only for empty playlists. Refresh and retry after a stale-set 409.
- `DELETE /api/v1/playlists/:id/songs/:songId` removes the entry and compacts
  remaining positions, returning updated playlist details.
- `DELETE /api/v1/playlists/:id` returns 204. A playlist referenced by a rehearsal
  event returns 409. Removing entries or playlists never deletes songs or media.

Writes lock the parent playlist and run in a Sequelize transaction. Reordering
uses temporary positive positions followed by final zero-based positions, keeping
entry IDs and timestamps while respecting immediate unique constraints. Invalid
requests return 400, unauthenticated requests 401, denied permissions 403, missing
resources 404, and conflicts 409.

Run `npm test` for unit/HTTP tests. Against a dedicated migrated test database:

```sh
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/TEST_DATABASE npm run test:playlists:db
```

The PostgreSQL suite exercises real JWT authentication, ownership, rehearsal
publication, pagination, batch validation, duplicate races, ordering and deletion.

## Rehearsals

The Rehearsals module uses the existing database schema. Apply pending migrations
with `npm run db:migrate`, then start the server normally. All endpoints require
an active account and JWT; write operations require ADMIN in both guards and the
service. Try the **Rehearsals** tag at `/api/docs` after using **Authorize**.

Create with `POST /api/v1/rehearsals`:

```json
{
  "title": "Sunday choir practice",
  "description": "Practice opening worship songs",
  "scheduledAt": "2026-11-15T17:00:00+01:00",
  "playlistId": "<existing-rehearsal-playlist-uuid>"
}
```

`scheduledAt` combines the rehearsal date and time. It must include seconds and
`Z` or an explicit UTC offset; timezone-free values are rejected. For example,
17:00 in Lagos (`+01:00`) is stored and returned as `2026-11-15T16:00:00.000Z`.
All response timestamps use UTC ISO 8601. The client can display these timestamps
in the viewer's timezone. This schedules a single event, with no recurrence.

- `GET /api/v1/rehearsals?page=1&limit=20&period=upcoming` returns upcoming
  rehearsals (`scheduledAt >= now`), soonest first. `period=past` returns past
  rehearsals (`scheduledAt < now`), newest first. Omit period for all visible
  rehearsals, soonest first. Pagination limits are 1–100; ties use rehearsal ID.
- `GET /api/v1/rehearsals/:id` includes the associated playlist and songs in
  playlist order. Song metadata excludes Cloudinary audio identifiers and URLs;
  use the existing secure song playback endpoint to listen.
- `PATCH /api/v1/rehearsals/:id` accepts title, description, scheduledAt and/or
  playlistId. Null clears description. Empty updates and owner changes are rejected.
- `DELETE /api/v1/rehearsals/:id` returns 204 and preserves the playlist, songs
  and media.

The associated playlist must exist and have type `REHEARSAL`; missing playlists
return 404 and PERSONAL playlists return 400. Admins can schedule against drafts.
A rehearsal's publication follows its playlist: publish through the existing
playlist endpoint (`PATCH /api/v1/playlists/:id` with
`{"publicationStatus":"PUBLISHED"}`). Members see only rehearsals associated
with published rehearsal playlists, including in pagination totals. Draft or
otherwise unavailable rehearsal details return 404. Unpublishing a playlist hides
all linked rehearsals from members; replacing the linked playlist adopts the new
playlist's visibility. No separate rehearsal publication flag is introduced.

Run `npm test` for service and existing HTTP tests. Real PostgreSQL HTTP tests:

```sh
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/TEST_DATABASE npm run test:rehearsals:db
```

Use a dedicated migrated test database. The suite checks JWT/role authorization,
validation, UTC conversion, playlist references, publication changes, pagination,
ordered songs, updates, safe deletion and Swagger metadata. Notifications and
attendance are not implemented.

## Test and security audit

See [the backend audit report](docs/backend-audit.md) for the coverage map,
executed results, test commands, Swagger browser check, and unresolved findings.
Before starting this version, run `npm run db:migrate` to apply migration
`008-auth-rate-limit`. Login and registration now use shared PostgreSQL attempt
limits; configuration defaults are in `.env.example`. Requests over the limit
receive 429 with `Retry-After`; unavailable limiter storage returns 503.

For a dedicated migrated test database, set `TEST_DATABASE_URL` and run
`npm run test:all` for TypeScript, Jest, and all PostgreSQL integration suites.
Use `npm run test:security:db` for the new registration-to-playback workflow and
shared rate-limit tests. Never use a production database for test fixtures.

## Troubleshooting an audio upload that waits and returns 502/504

If `/auth/me` succeeds but `/media/audio` fails, the upload has not yet reached song
creation. `100%` browser progress means the file reached NestJS; it does not mean
Cloudinary has accepted it. The frontend now identifies audio upload, artwork
upload, and song-saving stages separately and retains form contents after errors.

From the backend directory, with your normal `.env`:

```sh
npm run media:check
```

This sends a read-only Cloudinary Admin API ping with a ten-second total deadline.
It prints no credentials. `TIMEOUT`/`CONNECTION` indicate a backend connection,
DNS/firewall or proxy issue; `TLS` indicates trust/clock/proxy certificates;
`CREDENTIALS` indicates rejected credentials/permissions. A restricted API key may
lack Admin API ping permission even if it can upload; inspect that key's permissions.
An OK ping verifies connection/authentication, not file decoding, upload quotas or
private delivery entitlement. Never paste `.env` or API secrets into chat or logs.

Check `MEDIA_ENABLED=true` and the cloud name, API key and API secret from the same
Cloudinary product environment. Keep credentials only in the backend. On Windows,
allow Node.js outbound HTTPS and check VPN/firewall/proxy settings. If `HTTPS_PROXY`
is set, confirm that proxy is running and trusts the required certificates. Do not
disable TLS verification. A basic connectivity check without credentials is:

```sh
curl --connect-timeout 10 --max-time 20 -I https://api.cloudinary.com
```

An HTTP response, even 404/405, demonstrates that curl reached the service; it does
not verify Node's TLS trust, SDK authentication or upload permissions. After a
successful ping, try a small valid MP3 and inspect Cloudinary account upload limits.

The upload now has an overall deadline (`MEDIA_UPLOAD_TIMEOUT_SECONDS=90` by default,
5–300 seconds), in addition to the SDK socket timeout. Timed-out requests are
aborted. Network/TLS/timeout failures persist cleanup intent and return without
waiting on another provider call; the worker reconciles uncertain uploads after
the existing stale-upload grace period. Other immediate compensation calls have
a ten-second deadline. Do not discard MediaAsset records while cleanup is pending.
Safe, fixed media error messages pass through the global exception filter; raw SDK
messages and credentials do not. Backend logs identify an asset, stage and safe
failure code, such as `stage=provider; code=TIMEOUT`.

The frontend's `VITE_MEDIA_UPLOAD_TIMEOUT_SECONDS` defaults to 120 seconds. If you
increase the backend deadline, set the frontend deadline at least 30 seconds higher
and adjust any reverse-proxy timeout. Restart NestJS after `.env` changes and
restart/rebuild Vite after `VITE_*` changes. This fix needs no database migration.

### Credentials pass but playback returns 502

The Admin API ping checks a different path from authenticated CDN delivery. For a
specific song, run this read-only check from the backend directory:

```sh
npm run media:check -- --song YOUR_SONG_UUID
```

It looks up the tracked READY audio and checks the same signed original URL used
by the gateway with HEAD and a one-byte GET range. No account, song, or media
records are changed. Each request has a 15-second deadline. Signed URLs, tickets,
credentials and raw provider errors are not printed. The backend also logs these
safe delivery diagnostics during ordinary playback:

- `PROVIDER_HTTP` with `providerStatus=401/403`: the CDN rejected delivery; check
  the Cloudinary product environment, authenticated resource and signing/account permissions.
- `PROVIDER_HTTP` with `providerStatus=404`: verify the tracked audio still exists
  under the stored namespace and authenticated video delivery type.
- `RANGE_IGNORED`: the upstream returned a full response to a range request.
- `INVALID_RANGE_OR_LENGTH`: provider range/size metadata disagrees with tracked audio.
- `TLS`, `CONNECTION`, `TIMEOUT`: check the backend machine’s trust configuration,
  outbound access to `res.cloudinary.com`, DNS and HTTPS proxy. Keep TLS verification enabled.

Do not change ticket expiry to repair provider delivery errors. A successful song
check verifies access and range headers, but does not establish browser codec support.
