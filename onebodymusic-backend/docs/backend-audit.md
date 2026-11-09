# Backend testing, security and Swagger audit

Audit date: 9 November 2026. Stack: NestJS 11, Sequelize 6, PostgreSQL.
Prisma is not installed; query safety was reviewed against the actual Sequelize
implementation. Scope includes authentication, users, artists, albums, media,
songs/playback, playlists, rehearsals, health, configuration, exception handling,
database migrations and seed, and all existing test suites.

## Executed results

- `npm run typecheck`: passed.
- `npm test -- --silent`: **328 tests passed in 24 Jest suites**.
- `npm run test:integration`: **71 tests passed**, 0 failed/skipped, across all
  ten PostgreSQL suite files. This command also completed `npm run build`.
- Migration 008 applied successfully to the dedicated local test database;
  schema tests confirmed the complete migration history is repeatable.
- Headless Chromium/Playwright against the compiled application and dedicated
  PostgreSQL database: **6 checks passed** — 41 operations rendered, 9 module
  groups, health execution 200, actual Authorize dialog followed by `/auth/me`
  execution 200, multipart file picker visible, and no page JavaScript errors.
- Both full and production-only npm dependency audits completed and returned
  nonzero exit codes because the remaining advisories below are unresolved.

These results reflect commands actually executed during this audit. Earlier
iterations caught test typing/fixture cleanup/browser-selector failures; the
counts above are from their successful reruns. Provider doubles are explicitly
identified below; these are not live Cloudinary test results.

## Changes

- Added a PostgreSQL-backed authentication limiter, shared across application
  instances. Atomic counters cap both successful and failed attempts before DTO
  validation/password hashing. Login and registration have separate counters.
  Responses use the existing JSON error envelope; 429 includes `Retry-After`.
  Storage failure returns a generic 503 and does not bypass limiting.
- Migration `008-auth-rate-limit` adds a private infrastructure table and expiry
  index. Counters contain an HMAC of endpoint scope and socket peer, never email,
  passwords, access tokens, or plain IP addresses. Opportunistic cleanup removes
  at most 100 expired records per minute per process; no timer keeps the app alive.
- Kept Helmet and the explicit CORS origin allowlist. Added HTTP assertions for
  frame protection, referrer policy, MIME sniff protection, no powered-by header,
  denied origins/preflights, and private/no-store API responses.
- Added bounded 100 KiB JSON/form parsers and generic malformed-body errors.
  Parser errors no longer echo submitted password/body snippets. Multipart uploads
  retain their independent configured limits.
- Forced Nest's transitive Multer to use the existing direct 2.5.0 dependency.
  Previously its nested 2.4.0 was affected by
  [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m).
  The lockfile now deduplicates both paths to 2.5.0.
- Updated the Swagger overview, generic authentication examples, authentication
  throttling errors, and playback JSON/binary/redirect/range response metadata.
  Replaced a personal email example and a registration password example shorter
  than the documented minimum. Clarified liveness versus dependency readiness.

## Test coverage and files

| Layer | Coverage | Files |
| --- | --- | --- |
| Unit | Password hashing/verification, minimal JWT claims, sanitization, duplicates/races, inactive/deleted users | `src/auth/auth.service.spec.ts` (new) |
| Unit | Scope separation, peer hashing, ignored spoofed forwarding headers, 429/Retry-After, fail-closed storage errors | `src/auth/rate-limit/auth-rate-limit.guard.spec.ts` (new) |
| HTTP | Headers, CORS, malformed/oversized bodies, DTO validation, generic errors and log redaction | `test/app.e2e-spec.ts` (expanded) |
| Configuration | Authentication limiter bounds, existing secret/origin/media/TTL validation | `src/config/environment.spec.ts` (expanded) |
| Swagger/HTTP | Route metadata versus OpenAPI, tags, response schemas, schema references, protected routes, pagination, uploads, playback, rate-limit errors | `test/swagger.e2e-spec.ts` (new) |
| PostgreSQL + real HTTP | Registration → pending rejection → approval → login → artist/album creation → multipart audio → songs → private playlist ordering → published rehearsal → scoped playback → suspension → safe deletion | `test/security.database.integration.ts` (new) |
| PostgreSQL | Concurrent shared counters, HTTP spoof resistance, invalid requests counted, expired window reset | `test/security.database.integration.ts` (new) |
| Browser | Full Swagger rendering, health execution, Authorize/JWT execution, multipart picker, JavaScript errors | `test/swagger.browser.cjs` (new, optional Playwright) |

Existing service/HTTP/PostgreSQL suites were retained and executed for users,
artists, albums, media, songs, playlists and rehearsals. They cover last-active-admin
protection, JWT expiry/wrong signatures, role revocation, normalized uniqueness,
file signatures/MIME/size/path checks, provider failures, durable cleanup, media
ownership/reuse, byte ranges, playlist ownership/duplicates/order, publication
visibility, foreign keys and safe deletions. The new cross-module suite additionally
checks malformed UUIDs and pagination boundaries for all six list resources,
repeated query parameters, literal SQL-like search input, and invalid sorting.

## Security review conclusions

- Public registration accepts no role/status/owner fields; creation always uses
  MEMBER/PENDING. JWTs contain a subject plus standard signing claims. Passport
  checks signature, algorithm, issuer, audience and expiry. Current account status
  and role come from PostgreSQL for every protected request.
- User responses use explicit safe DTOs; the User default scope and serialization
  also exclude password hashes. Database SQL logging is disabled. Unexpected
  errors log only a generic status; neither credentials nor request bodies are logged.
- Query predicates use Sequelize operators with validated DTOs. Search patterns
  escape SQL LIKE wildcards. Sorting is enum-validated. SQL literals are fixed
  server-owned statements; reordering and rate limiting pass variable values via
  Sequelize replacements. No user-provided SQL/operator object is accepted.
- Guards protect write routes; services enforce playlist ownership/rehearsal access
  and revalidate administrators for access changes and rehearsal writes. Account
  access changes serialize in PostgreSQL and preserve the last active administrator.
- Upload authentication/roles execute before multipart processing. Memory, file
  count, field count and concurrency are bounded. Client filenames do not become
  storage keys. MIME/extension/signature checks and provider metadata validation
  remain enabled. Cleanup reservations/intent survive failed provider/database calls.
- Audio uses Cloudinary authenticated delivery. Provider signed URLs stay inside
  the server because ordinary delivery signatures do not establish short expiry.
  Browsers receive short-lived, song-scoped application tickets; every range/HEAD
  request rechecks account status. Access JWTs and playback tickets use separate
  keys/issuers/audiences. Provider bytes stream without full-file buffering.
- Members cannot access personal playlists owned by others or draft rehearsals.
  Ordering writes serialize on playlist locks and preserve unique positions.

## Reproduce

From `onebodymusic-backend`:

```sh
npm ci
npm run db:migrate
npm run typecheck
npm test
```

For database tests, create a **dedicated** PostgreSQL database; never point these
fixture-creating/deleting suites at production. Supply its connection string
through environment variables rather than committing it:

```sh
# Set TEST_DATABASE_URL to your dedicated test database in your shell.
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm run test:integration
# Or just the new cross-module workflow:
npm run test:security:db
# All type, Jest and database checks (after migration):
npm run test:all
```

Individual suites retain `test:auth:db`, `test:users:db`, `test:artists:db`,
`test:albums:db`, `test:media:db`, `test:songs:db`, `test:playlists:db` and
`test:rehearsals:db`. `test:integration` builds once and runs all ten PostgreSQL
suite files sequentially, including schema/seed tests.

Optional browser test, against a running server: install Playwright in your test
workspace (`npm install --no-save --package-lock=false playwright` and
`npx playwright install chromium`), then run:

```sh
BROWSER_BASE_URL=http://localhost:3000 node test/swagger.browser.cjs
```

Optionally set `SWAGGER_TEST_TOKEN` to a short-lived active-user access token in
your shell to test the actual Authorize dialog and protected `/auth/me` execution.
The script never prints the token. `BROWSER_EXECUTABLE_PATH` can select an existing
Chromium installation. The audit used this authenticated variant with a temporary
administrator fixture against the dedicated local PostgreSQL database.

Dependency checks:

```sh
npm audit --omit=dev
npm audit
```

## Deployment and unresolved findings

- Apply migration **008** before deploying the new authentication code. Defaults:
  `AUTH_LOGIN_MAX_ATTEMPTS=10`, `AUTH_REGISTER_MAX_ATTEMPTS=5`, and
  `AUTH_RATE_LIMIT_WINDOW_SECONDS=60`. Limits cannot be disabled with zero values;
  bounds are validated at startup. JWT secret rotation also resets limiter keys.
- The limiter deliberately uses the socket peer, not arbitrary `X-Forwarded-For`.
  Behind a reverse proxy, requests share that proxy's bucket. Configure appropriate
  per-client edge limits and size these backend limits for the deployment; a trusted
  proxy/client-IP policy is not assumed. This is a baseline attempt limiter, not
  protection against a distributed denial-of-service attack.
- Live Cloudinary operations were **not** exercised: this environment has no real
  provider credentials. Integration tests use real Nest/Passport/Multer/PostgreSQL
  with controlled Cloudinary and audio gateway doubles; SDK/gateway unit tests
  verify options/errors/range handling. Actual account entitlement, authenticated
  original delivery and CDN behavior still need deployment smoke tests.
- The final dependency audit reports **0 high / 0 critical** findings. Production
  dependency reporting includes **4 moderate** entries, all from the Sequelize →
  `uuid` advisory [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
  The application generates UUIDs with PostgreSQL `gen_random_uuid()` or Node
  `randomUUID()`; it does not expose the affected buffer-based UUID APIs. No safe
  upstream dependency fix is reported by npm. Forcing an incompatible UUID major
  version under Sequelize was not used as a workaround.
- The full dependency tree reports **26 entries: 21 moderate and 5 low** (including
  parent-package rollups, not 26 distinct advisories). Remaining direct advisory
  sources are `uuid`, development-tool `glob`/`minimatch`, and `deepmerge`. These
  remain open for compatible upstream updates. Dependency advisories can change;
  rerun the commands above at deployment time.
- Production TLS termination, proxy/access-log redaction of playback query tickets,
  real secret provisioning and database privileges must be verified in the actual
  deployment. Application tests do not verify external infrastructure.
