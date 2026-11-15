/* Run after npm run build. Requires Playwright/Chromium. API and audio use controlled fixtures. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { resolve } = require('node:path');
const delay = ms => new Promise(r => setTimeout(r, ms));
function wave(seconds) {
  const b = Buffer.alloc(44 + Math.floor(16000 * seconds));
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40);
  return b;
}
async function main() {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: resolve(__dirname, '..'), stdio: 'ignore' });
  const stopped = once(server, 'exit'); let browser;
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) { assert.equal(server.exitCode, null); try { if ((await fetch(base)).ok) break; } catch {} await delay(100); }
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    const user = { id: 'member', name: 'Queue Member', email: 'queue@example.test', role: 'MEMBER', status: 'ACTIVE' };
    const artist = { id: 'artist', name: 'Choir' };
    const songs = ['First song', 'Second song'].map((title, i) => ({ id: `song-${i}`, title, artistId: artist.id, artist, featuredArtists: [], albumId: 'album', album: { id: 'album', title: 'Practice album' }, category: null, durationSeconds: 30, coverImageUrl: null, hasAudioAsset: true }));
    const playlist = { id: 'set', title: 'Practice set', type: 'REHEARSAL', publicationStatus: 'PUBLISHED', createdById: 'admin', songCount: 2, songs: songs.map((song, position) => ({ songId: song.id, position, song: { ...song, artistName: artist.name } })) };
    let short = true, failSecond = false, holdFirst = false, releaseFirst; const tickets = [];
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url()); const path = url.pathname.replace('/api/v1', '');
      const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (path === '/auth/refresh') return json({ user, accessToken: 'test-access', expiresIn: 3600 });
      if (path === '/auth/me') return json(user);
      if (path === '/auth/logout') return json({});
      if (path === '/playlists/set') return json(playlist);
      if (path === '/albums/album') return json({ id: 'album', title: 'Practice album', artist, releaseYear: 2026, songCount: 2, songs });
      if (path === '/rehearsals/practice') return json({ id: 'practice', title: 'Choir practice', scheduledAt: '2099-01-01T16:00:00Z', playlist });
      const found = songs.find(song => path === `/songs/${song.id}`);
      if (found) {
        if (holdFirst && found.id === songs[0].id) { holdFirst = false; await new Promise(r => { releaseFirst = r; }); }
        if (failSecond && found.id === songs[1].id) return json({ message: 'Song unavailable' }, 404);
        return json(found);
      }
      const stream = songs.find(song => path === `/songs/${song.id}/stream`);
      if (stream && url.searchParams.has('redirect')) { tickets.push(stream.id); return json({ url: `/api/v1/songs/${stream.id}/stream?ticket=${tickets.length}`, expiresIn: 60 }); }
      if (stream) {
        const body = wave(short ? 0.6 : 30); const match = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
        const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
        return route.fulfill({ status: match ? 206 : 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', ...(match ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}) }, body: body.subarray(start, end + 1) });
      }
      return json({ data: [], total: 0, page: 1, totalPages: 0 });
    });
    const go = async path => { await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path); await page.getByRole('button', { name: 'Play all', exact: true }).waitFor(); };
    const title = name => page.locator('.player-title strong').filter({ hasText: name }).waitFor();
    const started = () => page.waitForFunction(() => { const a = document.querySelector('audio'); return a && !a.paused && a.currentTime > 0; });
    await page.goto(`${base}/playlists/set`);
    await page.getByRole('button', { name: 'Play all', exact: true }).click();
    await title('Second song'); await page.waitForFunction(() => document.querySelector('audio').ended);
    assert.deepEqual(tickets, ['song-0', 'song-1']);
    assert.equal(await page.getByRole('button', { name: 'Next song', exact: true }).isDisabled(), true);
    console.log('PASS natural audio end advances in order, requests fresh access, stops at queue end');
    short = false;
    await page.getByRole('button', { name: 'Previous song' }).click(); await title('First song'); await started();
    assert.equal(await page.getByRole('button', { name: 'Previous song' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Next song', exact: true }).click(); await title('Second song'); await started();
    await page.getByRole('button', { name: 'Refresh playback access', exact: true }).click(); await started();
    assert.equal(await page.getByLabel('Queue position').textContent(), '2 / 2');
    await go('/albums/album'); await title('Second song'); await started();
    await page.getByRole('button', { name: 'Play all', exact: true }).click(); await title('First song'); await started();
    await page.getByRole('button', { name: 'Next song', exact: true }).click(); await title('Second song'); await started();
    await go('/rehearsals/practice'); await page.getByRole('button', { name: 'Play all', exact: true }).click(); await title('First song'); await started();
    console.log('PASS previous/next, refresh preserves queue, navigation preserves playback, album/rehearsal Play all');
    failSecond = true; await page.getByRole('button', { name: 'Next song', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Song unavailable' }).waitFor();
    assert.equal(await page.locator('audio').evaluate(a => a.paused && !a.getAttribute('src')), true);
    failSecond = false;
    await page.getByRole('button', { name: 'Refresh playback access', exact: true }).click(); await title('Second song'); await started();
    console.log('PASS failed next-song request stops audio and remains retryable');
    await page.evaluate(() => { history.pushState({}, '', '/songs/song-0'); dispatchEvent(new PopStateEvent('popstate')); });
    short = true;
    await page.getByRole('button', { name: 'Load audio', exact: true }).click();
    await title('First song');
    await page.getByRole('button', { name: 'Play audio', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('audio').ended);
    assert.equal(await page.getByRole('button', { name: 'Next song', exact: true }).count(), 0);
    const singleTickets = tickets.length; await delay(100); assert.equal(tickets.length, singleTickets);
    console.log('PASS loading an individual song clears the queue and does not advance');
    short = false; await go('/rehearsals/practice');
    await page.setViewportSize({ width: 320, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Close player' }).click(); holdFirst = true;
    await page.getByRole('button', { name: 'Play all', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Preparing audio' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.player-title')?.textContent.includes('Loading'));
    await page.getByRole('button', { name: 'Close player' }).click();
    releaseFirst?.(); await delay(200);
    assert.equal(await page.getByRole('region', { name: 'Now playing' }).isVisible(), false);
    assert.equal(await page.locator('audio').evaluate(a => a.paused && !a.getAttribute('src')), true);
    console.log('PASS mobile queue layout and closing during loading cancels stale playback');
    await page.getByRole('button', { name: 'Play all', exact: true }).click(); await title('First song'); await started();
    await page.evaluate(() => window.dispatchEvent(new Event('session-expired')));
    await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
    assert.equal(await page.locator('audio').evaluate(a => a.paused && !a.getAttribute('src')), true);
    assert.equal(await page.getByRole('button', { name: 'Next song', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS session loss clears playback and queue; no browser JavaScript errors');
  } finally { await browser?.close(); if (server.exitCode === null) server.kill('SIGTERM'); await stopped; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
