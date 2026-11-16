/* Run against the current dist build. Uses isolated temporary static hosting and
   anonymous API responses; no credentials or production services required. */
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtemp, cp, readFile, writeFile, rm } = require('node:fs/promises');
const { join, resolve, extname } = require('node:path');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright');
(async () => {
 const root = await mkdtemp(join(tmpdir(), 'onebody-pwa-')); let browser; let server;
 try {
  await cp(resolve(__dirname, '../dist'), root, { recursive: true });
  server = createServer(async (req, res) => {
   if (req.url.startsWith('/api/')) { res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }); res.end('{"message":"Unauthorized"}'); return; }
   const path = new URL(req.url, 'http://localhost').pathname;
   let file = join(root, path); if (!extname(path)) file = join(root, 'index.html');
   try { const body = await readFile(file); const type = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webmanifest':'application/manifest+json', '.png':'image/png', '.svg':'image/svg+xml' }[extname(file)]; res.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }); res.end(body); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args:['--no-sandbox'] });
  const context = await browser.newContext(); const page = await context.newPage(); const errors=[]; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.getByRole('heading', { name:'Welcome back.' }).waitFor();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.name, 'OnebodyMusic'); assert.equal(manifest.short_name, 'OnebodyMusic'); assert.equal(manifest.display, 'standalone'); assert.equal(manifest.scope, '/');
  for (const size of [192,512]) { const icon=manifest.icons.find(i=>i.sizes===`${size}x${size}`); const bytes=Buffer.from(await(await fetch(base+icon.src)).arrayBuffer()); assert.equal(bytes.readUInt32BE(16),size); assert.equal(bytes.readUInt32BE(20),size); }
  assert.ok(manifest.icons.some(i=>i.purpose==='maskable'));
  const cdp=await context.newCDPSession(page); const appManifest=await cdp.send('Page.getAppManifest'); assert.deepEqual(appManifest.errors,[]); const eligibility=await cdp.send('Page.getInstallabilityErrors'); // Playwright contexts are incognito: assert there are no application eligibility errors.
  assert.deepEqual(eligibility.installabilityErrors.map(error=>error.errorId),['in-incognito']); await cdp.detach();
  await page.getByText('Install OnebodyMusic',{exact:true}).click();
  await page.evaluate(() => { const event=new Event('beforeinstallprompt',{cancelable:true}); event.prompt=async()=>{ window.installRequested=true; }; event.userChoice=Promise.resolve({outcome:'accepted'}); window.dispatchEvent(event); });
  await page.getByRole('button',{name:'Install app',exact:true}).click(); assert.equal(await page.evaluate(()=>window.installRequested),true);
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled'))); await page.getByText('Install OnebodyMusic',{exact:true}).waitFor({state:'detached'});
  for(const width of [320,390,768,1440]) { await page.setViewportSize({width,height:900}); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`); }
  const urls=await page.evaluate(async()=>{ const result=[]; for(const name of await caches.keys()) for(const request of await(await caches.open(name)).keys()) result.push(request.url); return result; });
  assert.ok(urls.length); assert.ok(urls.every(url=>new URL(url).origin===locationOrigin(base) && !url.includes('/api/') && !/ticket|cloudinary|\.mp3|\.m4a/u.test(url)));
  await context.setOffline(true); await page.reload(); await page.getByRole('heading',{name:'You’re offline'}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Welcome back.'}).isVisible(),false);
  for(const width of [320,390,768]) { await page.setViewportSize({width,height:900}); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); }
  await context.setOffline(false); await page.getByRole('heading',{name:'Welcome back.'}).waitFor();
  // Publish a second actual worker and precache revision in the temporary host.
  const index=await readFile(join(root,'index.html'),'utf8'); const next=index.replace('<title>OnebodyMusic</title>','<title>OnebodyMusic updated</title>'); await writeFile(join(root,'index.html'),next);
  const sw=await readFile(join(root,'sw.js'),'utf8'); await writeFile(join(root,'sw.js'),sw.replace(/(url:"index.html",revision:")[^"]+/, '$1pwa-test-version-two'));
  await page.evaluate(async()=>{ const r=await navigator.serviceWorker.ready; await r.update(); });
  await page.getByRole('button',{name:'Reload to update'}).waitFor(); await page.getByRole('button',{name:'Later',exact:true}).click();
  assert.equal(await page.title(),'OnebodyMusic');
  await page.getByRole('button',{name:'Reload to update'}).click(); await page.waitForFunction(()=>document.title==='OnebodyMusic updated');
  await page.waitForFunction(async()=>{ const names=await caches.keys(); for(const name of names) {const cache=await caches.open(name); for(const r of await cache.keys())if(r.url.includes('index.html')&&r.url.includes('__WB_REVISION__=')&&!r.url.includes('pwa-test-version-two'))return false;}return true; });
  const ios=await browser.newContext({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',viewport:{width:390,height:844},isMobile:true});
  const iosPage=await ios.newPage(); await iosPage.goto(base); await iosPage.getByText('Install OnebodyMusic',{exact:true}).click(); await iosPage.getByText(/In Safari, tap Share/).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: manifest/icons, install event flow, iOS guidance, static-only cache isolation, offline shell/reconnection, mobile widths, real worker update/defer/apply and stale precache removal. Native OS installation and deployed HTTPS require manual device checks.');
 } finally { await browser?.close(); if(server)await new Promise(r=>server.close(r)); await rm(root,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
function locationOrigin(base) { return new URL(base).origin; }
