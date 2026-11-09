# OnebodyMusic frontend

Mobile-first React PWA for the existing OnebodyMusic NestJS/Sequelize backend.
The project directory is `onebodymusic-frontend`; the user-facing product name is
OnebodyMusic.

## Start locally

Use Node.js 22.12+ (Node 24 recommended) and npm. In separate terminals:

```sh
# Repository root: start the existing backend first.
cd onebodymusic-backend
npm ci
# Configure .env as described in the backend README; never commit credentials.
npm run db:migrate
npm run start:dev
```

```sh
# Repository root: start the frontend.
cd onebodymusic-frontend
npm ci
cp .env.example .env
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to `http://localhost:3000`.
Swagger remains at http://localhost:3000/api/docs. There are no seeded or demo
frontend credentials. Use an ACTIVE backend account. Public registration creates
a PENDING member; an administrator must approve the account before it can sign in.
Use the backend's environment-based seed instructions to create the initial admin.

Production builds:

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

Deploy `dist/` to an HTTPS static host. Configure a history fallback to `index.html`
for frontend routes. Forward `/api` to NestJS **before** the SPA fallback, or set
`VITE_API_BASE_URL=https://your-api.example.org/api/v1` before building. For a separate
API origin, set the backend `CORS_ALLOWED_ORIGINS` to the exact frontend origin.
Vite's development/preview proxy is not a production reverse proxy.

`VITE_*` settings are public build-time values; **never** put JWT secrets,
Cloudinary credentials or database URLs in frontend environment files. Optional
`VITE_AUDIO_MAX_BYTES` and `VITE_IMAGE_MAX_BYTES` should match backend upload limits.
The backend is authoritative for file content validation, access control and limits.

## Structure

```text
public/                    App icons and favicon
src/
  app/                     Router, role-protected routes, responsive shell
  components/              Shared states, headings, covers, pagination,
                           paginated remote selectors, PWA prompt, error boundary
  features/
    auth/                  Memory-only session, login, pending registration
    dashboard/             Recent songs and upcoming rehearsals
    library/               Songs, artists, albums, details, lyrics, audio playback
    playlists/             Personal/rehearsal sets, metadata, ordered song controls
    rehearsals/            Published schedule and ordered setlists; admin scheduling
    profile/               Own-name updates and account access
    admin/                 Member approval/status/roles, artist/album/audio creation
  lib/                     Axios, typed API models, TanStack Query, API unit tests
  main.tsx                 Application providers and entry point
  styles.css               Tailwind import, mobile-first tokens and component styles
  vite-env.d.ts            Vite/PWA types
  ...
tests/browser.cjs          Real-backend desktop/mobile/PWA workflow tests
vite.config.ts             React, Tailwind, PWA, development proxy
tsconfig.json              Strict TypeScript and unused-code checks
.env.example               Public configuration only
```

## Screens and routes

| Screen | Route | Access |
| --- | --- | --- |
| Login / registration | `/login`, `/register` | Public |
| Dashboard | `/` | Active accounts |
| Songs / details | `/songs`, `/songs/:id` | Active accounts |
| Artists / details | `/artists`, `/artists/:id` | Active accounts |
| Albums / details | `/albums`, `/albums/:id` | Active accounts |
| Playlists / details | `/playlists`, `/playlists/:id` | Backend enforces ownership/publication |
| Rehearsals / setlist | `/rehearsals`, `/rehearsals/:id` | Published for members; all for admins |
| Profile | `/profile` | Active accounts |
| Admin dashboard | `/admin` | ADMIN |
| Admin music upload | `/admin/upload` | ADMIN |

Desktop uses a sidebar; mobile uses a fixed five-item bottom navigation. Artists
and albums are also reachable through the library tabs. Admin tools are available
from Profile on mobile. Layouts respect safe areas, reflow without horizontal
scrolling, and use 44px controls where practical. The interface includes visible
focus rings, associated input labels, native form validation, keyboard-accessible
ordering buttons, reduced-motion styling, and light/dark themes. Theme preference
is the only persistent app preference. No external fonts or stock images are
required; artwork loads lazily when supplied by the backend.

## Authentication and data

- Axios attaches the access JWT to API requests. Tokens and user/session data stay
  in memory, never localStorage, sessionStorage, IndexedDB, or a service-worker
  cache. **Reloading/reopening the app requires signing in again.** The current
  backend has no refresh-token endpoint; the frontend does not invent one.
- The app signs out at the configured access-token expiry and on API 401 responses.
  Current account status and roles are rechecked on window focus and each minute;
  the backend still checks permissions on every request. Query data is cleared on
  logout and on identity changes. Admin guards are UI controls, not a replacement
  for backend authorization.
- Lists use server pagination. Song/artist/album search is debounced; selector and
  playlist-picker searches are submitted explicitly. Query requests support abort
  signals, use a 60-second stale time, and do not automatically retry failures.
- Registration never sends role/status. Members can create PERSONAL playlists;
  only admins create and publish REHEARSAL sets. Reordering sends the complete
  permutation to the backend's transactional endpoint. Deleting a playlist keeps
  library songs. Backend reference conflicts are surfaced in the interface.
- Admins can approve, suspend, reactivate and change other accounts' roles. Own
  access fields are not editable; backend last-active-admin protection remains.
- Scheduling accepts local device time and converts it to UTC ISO 8601 before
  submission. Display uses the viewer's device timezone. Publishing the associated
  REHEARSAL playlist controls member visibility.

## Upload and playback

The admin upload screen can create an artist/album, search existing selections,
upload MP3/M4A audio and optional JPEG/PNG/WebP song artwork, and create a song with
category/lyrics. File sizes/extensions are checked client-side for feedback; the
server checks MIME/signatures and stores authenticated audio. Uploads show progress.
If song creation fails, the frontend requests deletion of newly uploaded assets;
if that cleanup fails or a tab closes, the backend's tracked reservations and
reconciliation remain responsible for eventual cleanup. Keep the backend worker
running. Do not navigate away during an upload.

Song details request `/songs/:id/stream?redirect=false` only after **Load audio** is
pressed. The browser receives a short-lived application ticket URL, never a permanent
Cloudinary audio URL. The native audio player uses `preload="none"` and provider-backed
range streaming; it does not fetch full files into React memory. After expiry, use
**Refresh playback access** and seek back to the desired position. Existing legacy
songs without tracked media display an unavailable message. Lyrics are rendered as
plain text, including line breaks, never interpreted as HTML.

## PWA and bandwidth

`vite-plugin-pwa` generates the manifest, 192/512px icons and static-shell precache.
Install through your browser's install action (Android/desktop), or Share → Add to
Home Screen on iOS. HTTPS or localhost is required. Test the service worker with the
production build/preview; it is not enabled in the Vite dev server.

Only versioned build assets and the app shell are precached. API routes are excluded
from navigation fallback, with **no runtime API/audio caching**. No offline music
files, account data, uploads or playback tickets are stored. The offline shell can
open, but sign-in, library access and music require a network connection. Lazy route
chunks, local system fonts, paginated lists, lazy artwork and on-demand playback
reduce network work. An available-update prompt allows deferral; applying an update
reloads and requires signing in again. Finish uploads before applying an update.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Optional Chromium workflow test:

```sh
# Backend dependencies and compiled output must already exist.
npm --prefix ../onebodymusic-backend run build
# Install browser tooling separately; it is not shipped to app users.
npm install --no-save --package-lock=false playwright
npx playwright install chromium
# Set TEST_DATABASE_URL to a dedicated PostgreSQL test database.
DATABASE_URL="$TEST_DATABASE_URL" npm --prefix ../onebodymusic-backend run db:migrate
npm run test:browser
```

Never use production for this test: it creates and deletes scoped fixtures. The test
starts isolated backend/production-preview servers on available localhost ports,
uses temporary admin/member credentials, and cleans up. `BROWSER_EXECUTABLE_PATH`
can select an existing Chromium executable. All browser screenshots are written to
`/tmp` and are not committed.

Executed during implementation: strict type checking, production/PWA build and
three API unit tests passed. The real NestJS/PostgreSQL Chromium workflow verified
registration/approval, login/logout, required screens, member admin-route blocking,
profile updates, playlist creation/song addition/reordering, responsive navigation at 320/390/768/1440px,
dark theme, static-only service-worker caching and offline-shell loading. The upload
compensation check uses explicitly controlled media responses; **real Cloudinary
uploads/playback were not exercised** without provider credentials. The frontend
production dependency audit reported zero advisories at implementation time.

Frontend MVP scope does not include offline downloads, notifications, attendance,
password recovery, refresh tokens, or full artist/album/song editing/deletion UIs.
Those backend endpoints remain available through Swagger. The included admin flow
covers creation/upload, account management, playlist management and scheduling.
