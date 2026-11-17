const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
(async()=>{
 const listeners={};let shown;let navigated;let focused=false;let closed=false;
 const self={location:{origin:'https://music.example.test'},addEventListener:(name,fn)=>{listeners[name]=fn;},registration:{showNotification:async(title,options)=>{shown={title,...options};}},clients:{matchAll:async()=>[{url:'https://music.example.test/profile',navigate:async url=>{navigated=url;},focus:async()=>{focused=true;}}],openWindow:async()=>{throw new Error('Existing window should be used');}}};
 runInNewContext(readFileSync(resolve(__dirname,'../public/push-events.js'),'utf8'),{self,URL});
 let pending;
 listeners.push({data:{json:()=>({title:'Private member details',body:'Private rehearsal',url:'https://untrusted.example',tag:'event-1'})},waitUntil:promise=>{pending=promise;}});await pending;
 assert.equal(shown.title,'OnebodyMusic');assert.equal(shown.body,'You have a new notification. Open the app to view it.');assert.equal(shown.tag,'event-1');assert.equal(shown.data.url,'/notifications');
 listeners.notificationclick({notification:{close:()=>{closed=true;},data:{url:'https://untrusted.example'}},waitUntil:promise=>{pending=promise;}});await pending;
 assert.equal(navigated,'https://music.example.test/notifications');assert.equal(focused,true);assert.equal(closed,true);
 console.log('PASS push privacy, stable tag and same-origin notification click handling');
})().catch(e=>{console.error(e);process.exitCode=1;});
