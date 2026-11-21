const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { once } = require('node:events');
const { resolve } = require('node:path');
const delay = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:resolve(__dirname,'..'),stdio:'ignore'});const stopped=once(server,'exit');let browser;
 try {
  const base=`http://127.0.0.1:${port}`;for(let i=0;i<100;i++){assert.equal(server.exitCode,null);try{if((await fetch(base)).ok)break;}catch{}await delay(100);}
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||'/usr/bin/chromium'});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(() => {
   const subscription = {
    endpoint: 'https://push.example/sub',
    toJSON: () => ({ keys: { p256dh: 'key', auth: 'auth' } }),
    unsubscribe: async () => { localStorage.removeItem('test-push-subscription'); return true; },
   };
   Object.defineProperty(Notification, 'requestPermission', { value: async () => 'granted' });
   Object.defineProperty(Notification, 'permission', { value: 'granted' });
   navigator.serviceWorker.getRegistration = async () => ({
    active: true,
    pushManager: {
     getSubscription: async () => localStorage.getItem('test-push-subscription') ? subscription : null,
     subscribe: async () => { localStorage.setItem('test-push-subscription', '1'); return subscription; },
    },
   });
  });
  const user={id:'notification-member',name:'Choir Member',email:'member@example.test',role:'MEMBER',status:'ACTIVE'};
  let items=[{id:'notice-one',kind:'rehearsal-updated',title:'Rehearsal updated',body:'Sunday preparation',href:'/rehearsals',createdAt:new Date().toISOString(),readAt:null},{id:'notice-two',kind:'account',title:'Your account is approved',body:'Welcome to OnebodyMusic',href:'/profile',createdAt:new Date().toISOString(),readAt:null}];
  let prefs={rehearsals:true,reminders:true,push:false};let rejectRead=false;
  let signedIn=true;let pushAvailable=false;
  await page.route('**/api/v1/**',async route=>{
   const request=route.request();const path=new URL(request.url()).pathname.replace('/api/v1','');const method=request.method();
   const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   if(path==='/auth/logout'){signedIn=false;return json({});}
   if(path==='/auth/session')signedIn=true;
   if(path==='/auth/refresh'||path==='/auth/session')return signedIn ? json({user,accessToken:'test-access',expiresIn:3600}) : json({},401);
   if(path==='/auth/me')return json(user);
   if(path==='/notifications')return json({data:items,unreadCount:items.filter(i=>!i.readAt).length,total:items.length,page:1,totalPages:1});
   if(path==='/notifications/preferences'){if(method==='PATCH')prefs=request.postDataJSON();return json(prefs);}
   if(path==='/notifications/push/options')return json({enabled:pushAvailable,publicKey:pushAvailable?'a2V5':null});
   if(path.startsWith('/notifications/')&&method==='PATCH'){
    if(rejectRead)return json({message:'Could not save notification'},500);
    items=items.map(i=>path.endsWith('/read-all')||path.includes(i.id)?{...i,readAt:new Date().toISOString()}:i);return json({updated:1});
   }
   return json({data:[],total:0,totalPages:0,page:1});
  });
  await page.goto(base+'/notifications');await page.getByRole('heading',{name:'Notifications',exact:true}).waitFor();
  await page.getByRole('link',{name:'Notifications, 2 unread',exact:true}).waitFor();
  rejectRead=true;await page.getByRole('button',{name:'Mark as read',exact:true}).first().click();await page.getByRole('alert').filter({hasText:'Could not save notification'}).waitFor();assert.equal(items.filter(i=>!i.readAt).length,2);
  rejectRead=false;await page.getByRole('button',{name:'Mark as read',exact:true}).first().click();await page.getByRole('link',{name:'Notifications, 1 unread',exact:true}).waitFor();
  await page.getByRole('button',{name:'Mark all as read'}).click();await page.getByRole('link',{name:'Notifications',exact:true}).waitFor();assert.equal(items.filter(i=>!i.readAt).length,0);
  await page.getByRole('button',{name:'View details'}).nth(1).click();await page.getByRole('heading',{name:'Your profile',exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'Rehearsal reminders (24 hours before)',exact:true}).uncheck();await page.getByText('Notification preferences saved.',{exact:true}).waitFor();assert.equal(prefs.reminders,false);
  assert.equal(await page.getByRole('button',{name:'Enable notifications on this device'}).isDisabled(),true);
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Profile overflow at ${width}: ${await page.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(e=>e.getBoundingClientRect().right>innerWidth).slice(0,8).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width}))) .then(JSON.stringify)}`);}
  await page.getByRole('link',{name:'Notifications',exact:true}).click();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Inbox overflow at ${width}`);}
  items=[];await page.reload();await page.getByRole('heading',{name:'You’re all caught up'}).waitFor();
  pushAvailable=true;
  await page.goto(base+'/profile');
  await page.getByRole('button',{name:'Enable notifications on this device'}).click();
  await page.getByText('Push notifications enabled.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Sign out',exact:true}).filter({visible:true}).first().click();
  await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('test-push-subscription')),'1');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password',{exact:true}).fill('test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).filter({visible:true}).first().waitFor();
  await page.goto(base+'/profile');
  await page.getByRole('button',{name:'Disable push notifications',exact:true}).click();
  await page.getByText('Push notifications disabled.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('test-push-subscription')),null);
  assert.deepEqual(errors,[]);console.log('PASS inbox, unread badge, failed-read retry, individual/all read state, detail navigation, preferences, push persistence across sign-out, empty state and responsive layouts');
 }finally{await browser?.close();server.kill('SIGTERM');await stopped;}
})().catch(e=>{console.error(e);process.exitCode=1;});
