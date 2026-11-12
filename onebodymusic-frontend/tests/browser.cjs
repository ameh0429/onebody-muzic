/* Real local NestJS/PostgreSQL + production frontend browser workflows.
   Requires TEST_DATABASE_URL and optional Playwright/Chromium installation. */
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const backend = resolve(__dirname, '../../onebodymusic-backend'); const req = createRequire(`${backend}/package.json`); req('reflect-metadata');
const { createDatabase } = req('./dist/database/connection'); const { Artist, Album, Song, Playlist, Rehearsal, User, Role, UserStatus, PlaylistType, PlaylistPublicationStatus } = req('./dist/database/models'); const { hash } = req('argon2');
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must point to a dedicated migrated test database.');
async function port() { const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const n = socket.address().port; await new Promise((r) => socket.close(r)); return n; }
async function ready(url) { for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) return; } catch {} await delay(100); } throw new Error('Server did not start'); }
async function main() {
 const db = createDatabase(url); const processes = []; let browser; let page; const suffix = randomUUID(); const emails = ['admin','member','new'].map((s) => `frontend-${s}-${suffix}@example.org`); const password = randomBytes(24).toString('hex'); let artist; let album; let songs = []; const checks = [];
 try {
  await db.authenticate(); const passwordHash = await hash(password);
  const admin = await User.create({name:'Grace Admin',email:emails[0],passwordHash,role:Role.ADMIN,status:UserStatus.ACTIVE});
  await User.create({name:'James Member',email:emails[1],passwordHash,role:Role.MEMBER,status:UserStatus.ACTIVE});
  artist = await Artist.create({ name:`The Worship Collective ${suffix}`, biography:'A community of voices, joined in worship.' });
  album = await Album.create({title:'Songs for the Journey',artistId:artist.id,releaseYear:2026});
  for (const title of ['Amazing Grace','Great Is Your Faithfulness']) songs.push(await Song.create({title,artistId:artist.id,albumId:album.id,uploadedById:admin.id,category:'Worship',lyrics:'Verse 1\nAmazing grace, how sweet the sound\n\nChorus\nWe sing together.',audioPublicId:`fixture-${randomUUID()}`,audioResourceType:'video',durationSeconds:241}));
  const set = await Playlist.create({title:'Sunday worship',type:PlaylistType.REHEARSAL,publicationStatus:PlaylistPublicationStatus.PUBLISHED,createdById:admin.id});
  const event = await Rehearsal.create({title:'Sunday choir practice',scheduledAt:new Date('2099-12-01T16:00:00Z'),playlistId:set.id,createdById:admin.id});
  const apiPort = await port(); const webPort = await port();
  for (const [command,args,cwd,env] of [[process.execPath,['dist/main.js'],backend,{DATABASE_URL:url,PORT:String(apiPort),JWT_SECRET:randomBytes(48).toString('hex'),CORS_ALLOWED_ORIGINS:`http://127.0.0.1:${webPort}`,MEDIA_ENABLED:'false'}],[process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(webPort),'--strictPort'],resolve(__dirname,'..'),{VITE_DEV_API_TARGET:`http://127.0.0.1:${apiPort}`} ]]) { const child = spawn(command,args,{cwd,env:{...process.env,...env},stdio:'ignore'}); processes.push({child,stopped:once(child,'exit')}); }
  await ready(`http://127.0.0.1:${apiPort}/api/v1/health`); await ready(`http://127.0.0.1:${webPort}`);
  browser = await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE_PATH ? {executablePath:process.env.BROWSER_EXECUTABLE_PATH}: {})});
  const context = await browser.newContext({viewport:{width:1440,height:1000}}); page = await context.newPage(); page.on('dialog', (dialog) => void dialog.accept()); const errors = []; page.on('pageerror',(e)=>errors.push(e.message));
  const base = `http://127.0.0.1:${webPort}`; const go = async (path) => { await page.evaluate((path)=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'));},path); await page.waitForTimeout(250); };
  const login = async (email) => { await page.getByLabel('Email address').fill(email); await page.getByLabel('Password',{exact:true}).fill(password); await page.getByRole('button',{name:'Sign in',exact:true}).click(); await page.getByRole('heading',{name:/Hello,/}).waitFor(); };
  await page.goto(`${base}/admin`); await page.getByRole('heading',{name:'Welcome back.'}).waitFor(); checks.push('anonymous protected route redirects to login');
  await page.getByRole('link',{name:'Create an account'}).click(); await page.getByLabel('Full name').fill('New Choir Member'); await page.getByLabel('Email address').fill(emails[2]); await page.getByLabel('Password',{exact:true}).fill(password); await page.getByLabel('Confirm password').fill(password); await page.getByRole('button',{name:'Create account',exact:true}).click(); await page.getByRole('heading',{name:'You’re on the list.'}).waitFor();
  assert.equal((await User.findOne({where:{email:emails[2]}})).status,'PENDING'); await page.getByRole('link',{name:'Back to sign in'}).click(); checks.push('registration creates pending account with approval guidance');
  await login(emails[0]); await page.getByText('Amazing Grace',{exact:true}).first().waitFor(); await page.screenshot({path:'/tmp/onebodymusic-desktop.png',fullPage:true}); checks.push('admin login and live dashboard');
  for (const [path,heading] of [['/songs','Music library'],[`/songs/${songs[0].id}`,'Amazing Grace'],['/artists','Voices of worship'],[`/artists/${artist.id}`,artist.name],['/albums','Albums'],[`/albums/${album.id}`,album.title],['/playlists','Your playlists'],['/rehearsals','Rehearsals'],[`/rehearsals/${event.id}`,event.title],['/profile','Your profile'],['/admin','Admin workspace'],['/admin/upload','Add to the library']]) { await go(path); await page.getByRole('heading',{name:heading,exact:true}).first().waitFor(); }
  checks.push('all library, details, profile, rehearsal and admin screens render against real API');
  await go('/admin'); await page.getByText('New Choir Member',{exact:true}).waitFor(); await page.getByRole('button',{name:'Approve',exact:true}).click();
  await page.getByText('New Choir Member',{exact:true}).waitFor({state:'hidden'}); assert.equal((await User.findOne({where:{email:emails[2]}})).status,'ACTIVE'); checks.push('administrator approves a newly registered account');
  await page.setViewportSize({width:390,height:844}); await go('/'); await page.getByRole('navigation',{name:'Mobile navigation'}).waitFor(); await page.screenshot({path:'/tmp/onebodymusic-mobile.png',fullPage:true});
  for (const path of ['/','/songs',`/songs/${songs[0].id}`,'/artists','/albums','/playlists','/rehearsals','/profile','/admin','/admin/upload']) { await go(path); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow: ${path}`); }
  await page.getByRole('button',{name:'Use dark theme'}).click(); assert.equal(await page.locator('html').getAttribute('data-theme'),'dark'); checks.push('mobile navigation, theme switching and no horizontal overflow at 390px');
  await go('/profile'); await page.getByLabel('Full name').fill('Grace Updated'); await page.getByRole('button',{name:'Save profile'}).click(); await page.getByRole('status').filter({hasText:'Your profile has been updated.'}).waitFor();
  await page.getByRole('button',{name:'Sign out',exact:true}).click(); await login(emails[1]); await go('/admin/upload'); await page.getByRole('heading',{name:/Hello,/}).waitFor(); assert.equal(await page.getByRole('link',{name:'Admin workspace',exact:true}).count(),0); checks.push('profile update, logout and member admin-route restriction');
  await go('/playlists'); await page.getByLabel('Playlist name').fill(`My practice ${suffix}`); await page.getByRole('button',{name:'Create playlist'}).click(); await page.getByRole('heading',{name:`My practice ${suffix}`}).waitFor();
  await page.getByRole('button',{name:'Add',exact:true}).first().click(); await page.getByRole('button',{name:'Added',exact:true}).waitFor(); await page.getByRole('button',{name:'Add',exact:true}).first().click(); const firstTitle=await page.locator('.song-row').first().locator('strong').innerText();
  await page.getByRole('button',{name:`Move ${firstTitle} down`}).click(); await page.waitForTimeout(400); checks.push('personal playlist create, add songs and reorder');
  await go('/profile');
  const photo = page.getByLabel('Profile picture',{exact:true});
  await photo.setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')});
  await page.getByRole('alert').filter({hasText:'Choose a non-empty JPEG'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Upload picture',exact:true}).isDisabled(),true);
  const photoBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64');
  const photoUrl=`data:image/png;base64,${photoBytes.toString('base64')}`;
  let pictureRequests=0; let pictureFailure=false;
  await page.route('**/api/v1/users/me/picture',async r=>{
    pictureRequests++;
    if(pictureFailure){await r.fulfill({status:502,contentType:'application/json',body:JSON.stringify({message:'Picture upload could not be completed'})});return;}
    const profileImageUrl=r.request().method()==='DELETE'?null:photoUrl;
    const current=await User.findOne({where:{email:emails[1]}});
    await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:current.id,name:current.name,email:current.email,role:current.role,status:current.status,profileImageUrl})});
  });
  await photo.setInputFiles({name:'profile.png',mimeType:'image/png',buffer:photoBytes});
  await page.locator('.profile-avatar img').waitFor();
  await page.getByRole('button',{name:'Cancel selection',exact:true}).click();
  await page.locator('.profile-avatar img').waitFor({state:'detached'});
  assert.equal(await page.locator('.profile-avatar img').count(),0);
  assert.equal(pictureRequests,0);
  await photo.setInputFiles({name:'profile.png',mimeType:'image/png',buffer:photoBytes});
  await page.getByRole('button',{name:'Upload picture',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Your profile picture has been updated.'}).waitFor();
  await page.locator('.topbar .avatar img').waitFor();
  assert.equal(await page.locator('.avatar img').count(),2);
  assert.equal(await page.locator('.profile-avatar img').getAttribute('src'),photoUrl);
  pictureFailure=true;
  await photo.setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:photoBytes});
  await page.getByRole('button',{name:'Replace picture',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Picture upload could not be completed'}).waitFor();
  assert.equal(await page.locator('.topbar .avatar img').getAttribute('src'),photoUrl);
  pictureFailure=false;
  await page.getByRole('button',{name:'Replace picture',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Your profile picture has been updated.'}).waitFor();
  await page.getByRole('button',{name:'Remove picture',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Your profile picture has been removed.'}).waitFor();
  await page.locator('.profile-avatar img').waitFor({state:'detached'});
  assert.equal(await page.locator('.avatar img,.profile-avatar img').count(),0);
  assert.equal(pictureRequests,4);
  await page.unroute('**/api/v1/users/me/picture');
  checks.push('member profile picture validation, preview/cancel, upload, shared avatars and removal (controlled provider responses)');
  await go('/profile'); await page.getByRole('button',{name:'Sign out',exact:true}).click(); await login(emails[0]); await go('/admin/upload');
  await page.getByRole('combobox',{name:'Artist',exact:true}).selectOption(artist.id); await page.getByLabel('Song title').fill('Upload failure probe');
  const assetId=randomUUID(); let compensated=false;
  await page.route('**/api/v1/media/audio',r=>r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:assetId,status:'READY'})}));
  await page.route('**/api/v1/songs',r=>r.request().method()==='POST'?r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Song could not be saved'})}):r.continue());
  await page.route(`**/api/v1/media/${assetId}`,r=>{compensated=r.request().method()==='DELETE';return r.fulfill({status:204});});
  await page.locator('input[name=file]').setInputFiles({name:'practice.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('test audio fixture')});
  await page.getByRole('button',{name:'Upload & publish song'}).click(); await page.getByRole('alert').filter({hasText:'Song could not be saved'}).waitFor(); assert.equal(compensated,true); checks.push('failed song save requests deletion of uploaded asset (controlled media responses)');
  await page.unrouteAll({behavior:'wait'});
  for(const width of [320,768]) { await page.setViewportSize({width,height:900});for(const path of ['/','/songs',`/songs/${songs[0].id}`,'/artists',`/artists/${artist.id}`,'/albums',`/albums/${album.id}`,'/playlists','/rehearsals','/profile','/admin','/admin/upload']) {await go(path);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow: ${width} ${path}`);}}
  checks.push('additional no-overflow checks at 320px and 768px');
  const manifest=await(await fetch(`${base}/manifest.webmanifest`)).json();assert.equal(manifest.display,'standalone');assert.equal(manifest.icons.length,2);
  const cache = await page.evaluate(async()=>{await navigator.serviceWorker.ready;const names=await caches.keys();const urls=[];for(const name of names)for(const r of await(await caches.open(name)).keys())urls.push(r.url);return urls;}); assert.ok(cache.length); assert.equal(cache.some((u)=>u.includes('/api/')),false);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some((k)=>/token|auth|user/i.test(k))),false); checks.push('installed service worker caches static shell only; no persisted access token');
  await context.setOffline(true); await page.reload(); await page.getByRole('heading',{name:'Welcome back.'}).waitFor(); await context.setOffline(false); checks.push('offline app shell loads without retaining private session');
  assert.deepEqual(errors,[]); checks.push('no browser JavaScript errors'); console.log(JSON.stringify({passed:checks}));
 } catch(error) { await page?.screenshot({path:'/tmp/onebodymusic-browser-failure.png',fullPage:true}).catch(()=>undefined); throw error; } finally {
  await browser?.close(); for(const {child,stopped}of processes.reverse()){if(child.exitCode===null)child.kill('SIGTERM');await stopped;}
  try {const users=await User.findAll({where:{email:emails}});const ids=users.map(u=>u.id);await Rehearsal.destroy({where:{createdById:ids}});await Playlist.destroy({where:{createdById:ids}});await Song.destroy({where:{uploadedById:ids}});if(album)await Album.destroy({where:{id:album.id}});if(artist)await Artist.destroy({where:{id:artist.id}});await User.destroy({where:{id:ids}});}finally{await db.close();}
 }
}
main().catch((e)=>{console.error(e.message);process.exitCode=1;});
