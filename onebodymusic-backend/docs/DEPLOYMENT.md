# Deploy OnebodyMusic to Render

The repository-root `render.yaml` defines a Node 24 API and private PostgreSQL 17 database in the same region. It selects paid plans to support a pre-deploy command and an always-running API for cleanup/reminder workers. Review Render's current plan availability and pricing before creating resources. This file prepares deployment; it does not create a service or supply credentials.

## Local setup and tests

Use Node 24 and npm. From `onebodymusic-backend`:

```sh
npm ci
# Copy only if .env does not already exist; preserve existing settings.
cp -n .env.example .env
```

Set your local database password, matching `DATABASE_URL`, a random JWT secret of at least 32 characters, and explicit CORS origins. Generate a secret locally with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`; put it only in secure settings or ignored `.env`. Then:

```sh
docker compose up -d --wait
npm run db:migrate
npm run start:dev
```

In another terminal, run `npm run typecheck`, `npm test`, and `npm run build`. Database tests require a separate disposable PostgreSQL database: set `TEST_DATABASE_URL`, migrate that database by temporarily setting `DATABASE_URL` to its URL, then run `npm run test:integration`. Never run integration/browser tests against production. Frontend setup is in `../../onebodymusic-frontend/README.md`.

## Render deployment

1. Connect the repository to Render and create a Blueprint from root `render.yaml`, selecting `develop`. Alternatively create a PostgreSQL 17 database and a Node web service manually with the settings below. Use the same region for both. Restrict external database access; the Blueprint disables external IP access. Use the database's **Internal Database URL** for the API.
2. Set root directory `onebodymusic-backend`, Node version `24.22.1`, build command `npm ci --include=dev && npm run build:prod`, pre-deploy command `npm run deploy:migrate`, start command `npm run start:prod`, and health-check path `/api/v1/health`. Include development dependencies during the build even with `NODE_ENV=production`; Nest CLI/TypeScript are build tools. The compiled start and migration commands require no TypeScript runner.
3. Fill the required environment settings below securely. The Blueprint generates JWT_SECRET; retain it across deploys. Configure Cloudinary values from your own account dashboard. Do not paste secrets in Git, tickets, screenshots, or logs. Render supplies PORT; do not hardcode or override it. The API binds to `0.0.0.0`.
4. Configure the exact HTTPS frontend origin in CORS. For a separate frontend origin use `VITE_API_BASE_URL=https://YOUR-API-HOST/api/v1` at frontend build time; Vite development proxies are not production proxies. If frontend and API are cross-site (including separate onrender.com sites), set `AUTH_COOKIE_SAME_SITE=none`; production cookies are Secure. Browser third-party-cookie restrictions can still block sessions, so prefer same-site custom domains or a same-origin reverse proxy. Never place backend secrets in VITE variables.
5. Deploy and inspect the pre-deploy logs before routing traffic. Migration failure must fail the deployment. Seed an initial admin only through the explicit command below, then remove seed credentials. Do not run the seed automatically on every deployment.

## Environment reference

Environment variables override ignored `.env`. Production should use Render settings rather than an uploaded `.env`. See `.env.example` for local defaults.

| Variable | Production setting |
| --- | --- |
| `NODE_ENV` | Required: `production`; enables JSON logging, Secure cookies, and disables every Swagger route. |
| `NODE_VERSION` | Render toolchain pin `24.22.1`. |
| `PORT` | Supplied by Render; validated integer 1–65535. Local default 3000. |
| `DATABASE_URL` | Required secret: Render Internal Database URL. Same region/private network; PostgreSQL 17+. |
| `JWT_SECRET` | Required secret, random, at least 32 characters. Stable across instances/deploys. Rotation invalidates access tokens; plan it deliberately. |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | 60–3600, default 900. Refresh tokens are random, hashed in PostgreSQL; no second JWT secret is required. |
| `CORS_ALLOWED_ORIGINS` | Required comma-separated exact HTTPS frontend origins; no wildcard, path, or trailing slash. Include all browser origins that must use authentication. CORS is not an API access-control mechanism. |
| `AUTH_COOKIE_SAME_SITE` | Default `lax`; use `none` for cross-site HTTPS sessions. `strict` also supported. |
| `MEDIA_ENABLED` | `true` in Blueprint. Set `false` to deploy without uploads/provider credentials. |
| `CLOUDINARY_CLOUD_NAME` | Required when media enabled: your Cloudinary cloud name. |
| `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Required secure settings when media enabled. Never frontend variables. |
| `MEDIA_AUDIO_MAX_BYTES`, `MEDIA_IMAGE_MAX_BYTES` | Defaults 26214400 and 5242880; match public frontend limits. |
| `MEDIA_MAX_CONCURRENT_UPLOADS` | 1–8, default 2 per API process. Size instances for concurrency and Argon2 memory. |
| `MEDIA_UPLOAD_TIMEOUT_SECONDS` | 5–300, default 90; frontend timeout must allow at least 30 seconds extra. |
| `MEDIA_CLEANUP_INTERVAL_SECONDS` | 15–3600, default 60. Keep an API running for reconciliation. |
| `MEDIA_STALE_UPLOAD_SECONDS` | 600–86400, default 900. |
| `MEDIA_PLAYBACK_TTL_SECONDS` | 15–300, default 60. |
| `MEDIA_PLAYBACK_IDLE_TIMEOUT_SECONDS` | 5–120, default 30. |
| `AUTH_LOGIN_MAX_ATTEMPTS`, `AUTH_REGISTER_MAX_ATTEMPTS` | 1–100, defaults 10 and 5. PostgreSQL-backed limits. |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | 10–3600, default 60. Do not enable blanket trust proxy: existing limiter uses socket peers. Behind Render, clients may share a limiter bucket; tune and use edge rate limiting before launch. |
| `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` | Optional matching VAPID keys and real mailto/HTTPS contact; omit all three to use inbox only. Retain keys across deployments. |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Only for explicit `npm run db:seed:prod`. Password 16–128 characters. Remove after seed. |
| `TEST_DATABASE_URL` | Local/CI dedicated test DB only; not production. |
| `POSTGRES_PASSWORD` | Local Compose only; Render manages database credentials. |

Cloudinary requests require outbound HTTPS to its API and account delivery hosts. Verify real upload, playback ranges and cleanup with a controlled asset after deployment; local test doubles do not establish provider access. Optional push requires outbound HTTPS to browser push providers. Do not disable TLS validation to resolve connectivity. For an external PostgreSQL URL use the provider's verified TLS settings and trusted CA; never set `rejectUnauthorized=false` or `NODE_TLS_REJECT_UNAUTHORIZED=0`. Internal Render database access uses its private connection URL; follow Render's TLS requirements for the chosen connection.

## Safe migrations and rollback

The build only compiles code; it never connects to the database. `npm run deploy:migrate` runs the compiled Umzug runner in Render's **pre-deploy** step, before new instances serve traffic. It serializes concurrent CLI runners with a PostgreSQL advisory transaction lock and closes connections on success/failure. Sequelize synchronization stays disabled. `npm run db:status:prod` reports applied/pending migrations without changing schema.

Use a plan supporting pre-deploy commands. If unavailable, run `npm run db:migrate:prod` once in a controlled release job with production database access and the exact newly built artifact, verify success, then deploy. Do not silently move migrations into every web start or a networked build step. Run migration jobs where the internal database is reachable.

Back up and verify restore procedures before schema changes. Existing migration files are immutable; add forward migrations. New schema must remain compatible with old instances during a rolling deploy (expand first, deploy code, contract later). Advisory locking prevents concurrent migration runners; it does not make an entire release atomic or ensure compatibility. Avoid long locks and schedule disruptive changes separately. Never automatically run `db:rollback`, reset a database, or call `sequelize.sync` in production. Rolling back application code does not roll back schema: use compatible code or a reviewed forward repair migration.

Seed only once after migrations with secure ADMIN settings via `npm run db:seed:prod`. The seed does not promote/reset existing users. Remove ADMIN_PASSWORD afterward.

## Logging, shutdown and Swagger

Production uses Nest ConsoleLogger JSON on stdout/stderr, captured by Render. It records levels, timestamps and contexts. Existing application errors are sanitized; startup failure logs omit exception details to avoid connection-string/credential leaks. Logs do not deliberately record bodies, passwords, cookies, tokens or media tickets. Do not turn on SQL/body/header logging in production. Limit log access and retention. This is application logging, not an audit trail or a full HTTP access-log system.

SIGTERM/SIGINT invoke Nest shutdown hooks: workers stop their timers and await active ticks, and Sequelize closes its pool. Allow Render's termination grace period for in-flight work; long uploads may still be interrupted and reconciled by the media worker. No migrations run on shutdown/startup. Do not enable force-close behavior that discards requests.

With NODE_ENV=production, Swagger UI, JSON/YAML schemas and associated static routes are not registered and return 404. JWT protection of business endpoints does not protect Swagger. Inspect documentation locally or in a restricted nonproduction environment; do not switch the live service out of production to expose docs. Local/test Swagger remains at `/api/docs` and `/api/docs-json`.

## Deployment verification checklist

- [ ] Build and pre-deploy migration commands completed successfully; status reports no pending migrations.
- [ ] `GET https://YOUR-API-HOST/api/v1/health` returns 200, `status: ok`, correct service name and timestamp. Health checks process liveness; startup authenticates the database, but this is not an ongoing DB/provider readiness probe.
- [ ] Logs are parseable JSON; no secrets or raw request bodies appear. Service listens on Render's PORT.
- [ ] `/api/docs`, `/api/docs-json`, `/api/docs-yaml` and Swagger assets return 404.
- [ ] Approved frontend origin receives exact credentialed CORS headers; an unrelated origin receives no allow-origin header.
- [ ] HTTPS login, refresh, logout and page reload work; pending/suspended users remain blocked.
- [ ] Controlled Cloudinary upload, full/range playback, deletion and cleanup work without permanent private URLs leaking to clients.
- [ ] Restart the service; persistent data remains, workers resume, logs show a clean startup, and no automatic schema synchronization/seed occurs.
- [ ] Confirm database backup/retention, restore procedure and alerts. Review resource use and shared-peer rate limits under representative traffic.
- [ ] No secrets in the Git diff or tracked environment files. Keep production credentials in Render settings.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Build cannot find nest/tsc | Use `npm ci --include=dev`; verify root directory and Node 24. |
| Render reports no open port | Use compiled start command; inspect config errors; do not override Render PORT or bind only loopback. |
| Startup or migration fails | Check required variable names, internal URL, database readiness, region and account permissions. Startup errors intentionally omit values. Inspect migration status; never reset production. |
| Migration waits | Investigate another release runner or database locks before canceling anything. Deploy one release at a time. |
| Login works but refresh fails | Check exact CORS origin, HTTPS, cookie SameSite/Secure policy, frontend credentials mode, and third-party cookie blocking. |
| All users get 429 | Render may present a shared socket peer; review edge controls and configured limits. Do not trust arbitrary X-Forwarded-For headers. |
| Media disabled / 502 / timeout | Confirm MEDIA_ENABLED and matching Cloudinary account credentials; check provider access/quota and timeout settings. Never log secrets or disable TLS checks. |
| Swagger returns 404 | Expected in production. Use local docs. |
| Health succeeds but a feature fails | Health is liveness only. Test the database/provider operation and inspect sanitized logs. |
| Restart lost data | Verify DATABASE_URL references managed PostgreSQL, not a disposable local container. Keep production assets in Cloudinary. |

No Render deployment, production credential validation or fresh hosted smoke test is implied by local verification. Run this checklist on the actual service after deployment.
