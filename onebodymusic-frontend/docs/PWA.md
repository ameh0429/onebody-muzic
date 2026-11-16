# OnebodyMusic PWA deployment and testing

## Production hosting

Build with Node 24: `npm ci && npm run typecheck && npm test && npm run build`.
Deploy the complete `dist/` directory to an HTTPS origin with a valid, trusted
certificate. Localhost is a secure-context exception for development only; plain
HTTP on a phone's LAN IP does not qualify. Redirect HTTP to HTTPS. Verify
`window.isSecureContext === true` on the deployed site and check that
`navigator.serviceWorker` exists. Native installation availability depends on the
browser and operating system. Vite development mode does not enable the worker.

Host at the origin root. Route `/api/` to the API **before** applying the SPA
fallback; return `index.html` for other application navigation paths. Return real
404s for missing `/assets/` files, never HTML masquerading as JavaScript. Serve
`.webmanifest` as `application/manifest+json` and `.js` as JavaScript. Do not
redirect `/sw.js`, narrow its scope, or require authentication for static assets.
A CSP must permit same-origin workers (`worker-src 'self'`).

Configure hosting response headers:

| Path | Cache-Control |
| --- | --- |
| `/`, `/index.html`, SPA navigation HTML | `no-cache, max-age=0, must-revalidate` |
| `/sw.js`, `/manifest.webmanifest`, `/workbox-*.js`, icons | `no-cache, max-age=0, must-revalidate` |
| `/assets/*` (content hashed by Vite) | `public, max-age=31536000, immutable` |
| `/api/*`, authentication, stream tickets and audio | `private, no-store` |

The existing NestJS configuration supplies `private, no-store` for API responses;
ensure reverse proxies/CDNs preserve that header and never override it. Do not
cache an authenticated API or media origin at the CDN. Use verified HTTPS for API
and media too. Configure production cookie/CORS settings per the backend README.

Publish assets before HTML/service worker, preferably with atomic deployments.
Retain the previous deployment's hashed assets while clients may still run it.
Never replace the contents of a hashed asset URL. The active worker serves a
consistent version until a waiting update is accepted. A new version is checked
on launch, reconnection, return to a visible tab and hourly while visible. The
update message remains available after Later; Reload to update activates the
waiting worker and reloads. Finish uploads first. Workbox removes obsolete
precache entries on activation. Do not enable forced skipWaiting/autoUpdate:
that could interrupt uploads or mix old pages with new chunks. These deployment
headers and atomic releases are necessary alongside the client configuration.

## Installation

- Android Chrome / desktop Chrome or Edge: expand Install OnebodyMusic, then
  Install app when offered; the browser's own menu/address-bar install action
  also works. Browser eligibility and engagement heuristics control availability.
- iPhone/iPad Safari: open the app in Safari, Share → Add to Home Screen → Add.
  iOS does not expose `beforeinstallprompt`; the app shows Safari instructions.
- Open from the new home-screen/app icon. Verify standalone presentation,
  OnebodyMusic name, icon, theme, portrait/landscape layout and safe-area spacing.
- Other browsers may support only a bookmark or browser tab. The app remains
  usable without installation. Installation never grants offline music access.

## Privacy and offline behavior

Workbox precaches only HTML, hashed application JS/CSS/fonts and local icons.
There are no runtime caching routes. `/api` navigation is excluded from the shell
fallback. Authentication, JWTs, user profiles, library responses, provider artwork,
private media URLs, audio and playback tickets never enter service-worker caches.
The offline screen hides the live application while disconnected. It returns to
the application on reconnection; request errors have retry/reconnect guidance.
The browser's connectivity indicator is a hint, not proof that the API is reachable.

Access JWTs and TanStack Query data stay in memory. Logout clears identity and
query data, remounts the player, stops playback, removes its source and clears
Media Session metadata. Logout propagates across tabs and revokes the HttpOnly
server session. If disconnected, a non-secret logout-pending flag prevents
restoration until server revocation succeeds. Static shell caches intentionally
survive logout; they contain no user state. Do not add localStorage token storage,
query persistence, or API/audio runtime caches.

## Automated checks

From the frontend directory:

```sh
npm run typecheck
npm test
npm run build
# Install test-only tooling outside the application; no manifest/lockfile edits.
npm install --prefix /tmp/onebody-pwa-tools playwright
NODE_PATH=/tmp/onebody-pwa-tools/node_modules BROWSER_EXECUTABLE_PATH=/usr/bin/chromium npm run test:pwa
```

Use an available Chromium path or install Playwright's Chromium separately.
`test:pwa` hosts an isolated copy of the production build, verifies manifest/icon
sizes, exercises the install-event UI and iOS instructions, checks static-only
cache isolation, offline shell/reconnection and 320/390/768/1440px layouts. It
publishes a second worker/precache revision on its temporary origin and verifies
update notification, deferral, activation, reload and removal of stale precache
entries. It does not modify the actual `dist/` build or require a backend.

For real sessions, logout isolation, API failure handling, audio cleanup and
responsive authenticated screens, run the existing `npm run test:browser` suite
with `TEST_DATABASE_URL` set to a dedicated migrated PostgreSQL database and the
backend built. See the frontend README. Provider responses in these tests are
controlled fixtures, not live Cloudinary validation.

## Release/device checklist

1. Deploy version A over HTTPS. Check the manifest and service worker in browser
   developer tools. Inspect the Network headers listed above. Confirm API/auth
   responses are `no-store`, and `/api/missing` never returns cached SPA HTML.
2. Install on physical Android Chrome, iOS Safari and supported desktop browser.
   Launch from the icon and verify name/icons/standalone mode. Browser automation
   tests the install event flow; it cannot confirm native OS installation dialogs.
3. Load once online, then disable networking and reopen/reload a deep link such as
   `/songs`. Expect the offline screen. Reconnect and verify recovery. Test a fresh
   visitor offline too: without a prior install/cache, no offline shell is promised.
4. Interrupt a list request, sign-in and upload. Expect a visible connection/error
   message and an explicit retry, no blank screen or automatic duplicate mutation.
5. Keep A open, deploy B with changed app content, return to the tab and trigger
   worker update in developer tools if needed. Defer once, then apply. Verify B
   loads, obsolete precache entries disappear, and uploads are not auto-reloaded.
6. As user A, view private data and play audio; inspect Cache Storage and browser
   storage for tokens/API/media URLs. Logout with a second tab open: playback must
   stop in both tabs, cached queries clear and a reload cannot restore the session.
   Login as user B and confirm none of A's profile, playlists or playback remain.
7. Repeat logout while offline, reconnect and finish server sign-out. Verify the
   HttpOnly refresh cookie is revoked; static-only Cache Storage may remain.

Native OS installation and actual deployed HTTPS headers must be checked on the
release target; localhost automation is not evidence those deployment checks pass.
