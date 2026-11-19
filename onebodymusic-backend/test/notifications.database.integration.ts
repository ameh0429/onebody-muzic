import nodemailer, { type SendMailOptions } from 'nodemailer';
import type { EnvironmentVariables } from '../src/config/environment';
import webpush from 'web-push';
import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { createDatabase } from '../src/database/connection';
import { Playlist, PlaylistPublicationStatus, PlaylistType, Rehearsal, Role, User, UserStatus } from '../src/database/models';
import { NotificationsService } from '../src/notifications/notifications.service';
import { ApprovalEmailWorker } from '../src/notifications/approval-email.worker';
import { NotificationsWorker } from '../src/notifications/notifications.worker';
import type { UserResponseDto } from '../src/auth/dto/user-response.dto';
import { QueryTypes } from 'sequelize';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { hash } from 'argon2';
const url=process.env.TEST_DATABASE_URL;
if(!url) throw new Error('Dedicated TEST_DATABASE_URL required');
test('notification events, isolation, preferences and reminders',async t=>{
 const db=createDatabase(url); const config=new ConfigService({NODE_ENV:'test'}); const service=new NotificationsService(db,config); const worker=new NotificationsWorker(service,config);
 const suffix=randomUUID(); const ids:string[]=[]; let playlistId=''; let rehearsalId='';
 const socket=createServer(); socket.listen(0,'127.0.0.1'); await once(socket,'listening'); const address=socket.address(); assert.ok(address&&typeof address==='object'); const port=address.port; await new Promise<void>(r=>socket.close(()=>r()));
 const child=spawn(process.execPath,['dist/main.js'],{env:{...process.env,NODE_ENV:'test',DATABASE_URL:url,PORT:String(port),JWT_SECRET:randomBytes(48).toString('hex'),MEDIA_ENABLED:'false'},stdio:'ignore'}); const stopped=once(child,'exit');
 const call=(path:string,method='GET',token?:string,body?:object)=>fetch(`http://127.0.0.1:${port}/api/v1/${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 try {
  await db.authenticate(); for(let i=0;i<100;i++){assert.equal(child.exitCode,null);try{if((await call('health')).ok)break;}catch{}await delay(100);}
  const password=randomBytes(24).toString('hex');const passwordHash=await hash(password);
  const make=async(name:string,role=Role.MEMBER,status=UserStatus.ACTIVE)=>{const u=await User.create({name,email:`${name}-${suffix}@example.test`,passwordHash,role,status});ids.push(u.id);return u;};
  const admin=await make('admin',Role.ADMIN); const member=await make('member'); const actor=(u:User)=>({id:u.id,role:u.role,status:u.status} as UserResponseDto);
  const login=async(u:User)=>{const r=await call('auth/login','POST',undefined,{email:u.email,password});assert.equal(r.status,200);return(await r.json() as {accessToken:string}).accessToken;};
  const adminToken=await login(admin);const memberToken=await login(member);
  await t.test('registration and approval recipients; no-op updates stay silent',async()=>{
   const pending=await make('pending',Role.MEMBER,UserStatus.PENDING);
   assert.ok((await service.list(actor(admin),1)).data.some(n=>n.kind==='registration'&&n.body==='pending'));
   assert.equal((await service.list(actor(member),1)).total,0);
   await pending.update({status:UserStatus.ACTIVE});assert.equal((await service.list(actor(pending),1)).data[0]?.title,'Your account is approved');
   await pending.update({status:UserStatus.ACTIVE});assert.equal((await service.list(actor(pending),1)).total,1);
  });
  await t.test('rolled back events do not escape',async()=>{
   await assert.rejects(db.transaction(async transaction=>{await User.create({name:'rollback',email:`rollback-${suffix}@example.test`,passwordHash},{transaction});throw new Error('rollback');}));
   assert.equal((await service.list(actor(admin),1)).data.some(n=>n.body==='rollback'),false);
  });
  await t.test('approval email queues on commit and retries with a sign-in link', async () => {
   const pending = await make('email-approval', Role.MEMBER, UserStatus.PENDING);
   const config = new ConfigService<EnvironmentVariables, true>({
    GMAIL_SMTP_USER: 'onebodymusic@example.test',
    GMAIL_SMTP_APP_PASSWORD: 'testpasswordonly',
    APP_FRONTEND_ORIGIN: 'https://app.example.test',
   });
   const emailWorker = new ApprovalEmailWorker(db, config);
   const messages: SendMailOptions[] = [];
   const smtp = t.mock.method(nodemailer, 'createTransport', () => ({
    async sendMail(message: SendMailOptions) {
     assert.ok(message.to && typeof message.to === 'object' && 'address' in message.to);
     if (message.to.address !== pending.email) return;
     messages.push(message);
     if (messages.length === 1) throw new Error('SMTP temporarily unavailable');
    },
   }));
   const getJobs = () => db.query<{ attempts: number; finishedAt: Date | null }>(
    'SELECT attempts, "finishedAt" FROM "ApprovalEmail" WHERE "userId"=:id',
    { type: QueryTypes.SELECT, replacements: { id: pending.id } },
   );

   try {
    await assert.rejects(db.transaction(async transaction => {
     await User.update({ status: UserStatus.ACTIVE }, { where: { id: pending.id }, transaction });
     throw new Error('rollback');
    }), /rollback/);
    assert.deepEqual(await getJobs(), []);
    await pending.update({ status: UserStatus.ACTIVE });
    await pending.update({ status: UserStatus.ACTIVE });
    assert.equal((await getJobs()).length, 1);

    await emailWorker.tick();
    assert.deepEqual(await getJobs(), [{ attempts: 1, finishedAt: null }]);
    await emailWorker.tick();
    assert.equal(messages.length, 1);
    await db.query('UPDATE "ApprovalEmail" SET "nextAttemptAt"=now() WHERE "userId"=:id', {
     replacements: { id: pending.id },
    });
    await Promise.all([emailWorker.tick(), emailWorker.tick()]);
    assert.equal(messages.length, 2);
    assert.match(String(messages[1]?.text), /https:\/\/app\.example\.test\/login/);
    const [job] = await getJobs();
    assert.equal(job?.attempts, 2);
    assert.ok(job.finishedAt);
   } finally {
    smtp.mock.restore();
   }
  });
  let notificationId='';
  await t.test('draft visibility, publication, coalesced changes, unpublication',async()=>{
   const p=await Playlist.create({title:'Set',type:PlaylistType.REHEARSAL,createdById:admin.id});playlistId=p.id;
   const r=await Rehearsal.create({title:'Practice',playlistId,createdById:admin.id,scheduledAt:new Date(Date.now()+23*3600000)});rehearsalId=r.id;
   assert.equal((await service.list(actor(member),1)).total,0);
   await p.update({publicationStatus:PlaylistPublicationStatus.PUBLISHED});assert.equal((await service.list(actor(member),1)).data[0]?.body,'Practice');
   await r.update({title:'Updated practice'});await r.update({description:'Bring your folder'});
   const inbox=await service.list(actor(member),1);assert.equal(inbox.data.filter(n=>n.kind==='rehearsal-updated').length,1);notificationId=inbox.data[0]!.id;
   await p.update({publicationStatus:PlaylistPublicationStatus.DRAFT});assert.equal((await service.list(actor(member),1)).total,0);
   await p.update({publicationStatus:PlaylistPublicationStatus.PUBLISHED});
  });
  await t.test('HTTP authentication, ownership, DTO validation, read state and preferences',async()=>{
   assert.equal((await call('notifications')).status,401);assert.equal((await call('notifications?page=0','GET',memberToken)).status,400);
   assert.equal((await call(`notifications/${notificationId}/read`,'PATCH',adminToken)).status,404);
   assert.equal((await call(`notifications/${notificationId}/read`,'PATCH',memberToken)).status,200);assert.equal((await service.list(actor(member),1)).unreadCount,0);
   assert.equal((await call('notifications/preferences','PATCH',memberToken,{rehearsals:false,reminders:true,push:false})).status,200);
   assert.equal((await call('notifications/preferences','PATCH',memberToken,{rehearsals:'false',reminders:true,push:false})).status,400);
   assert.equal((await call('notifications/preferences','PATCH',memberToken,{rehearsals:true,reminders:true,push:true})).status,503);
   assert.equal((await call('notifications/push/subscriptions','POST',memberToken,{endpoint:'http://127.0.0.1/private',p256dh:'x',auth:'x'})).status,400);
  });
  await t.test('concurrent reminder runs deduplicate and honor preferences',async()=>{
   await service.savePreferences(member.id,{rehearsals:false,reminders:false,push:false});await Promise.all([worker.tick(),worker.tick()]);
   assert.equal((await service.list(actor(member),1)).data.some(n=>n.kind==='reminder'),false);
   await service.savePreferences(member.id,{rehearsals:true,reminders:true,push:false});await Promise.all([worker.tick(),worker.tick()]);
   assert.equal((await service.list(actor(member),1)).data.filter(n=>n.kind==='reminder').length,1);
  });
  await t.test('push subscriptions remain account-scoped and device count is bounded',async()=>{
   const keys=webpush.generateVAPIDKeys();const pushConfig=new ConfigService({WEB_PUSH_PUBLIC_KEY:keys.publicKey,WEB_PUSH_PRIVATE_KEY:keys.privateKey,WEB_PUSH_SUBJECT:'mailto:test@example.test'});const pushService=new NotificationsService(db,pushConfig);
   const subscription={endpoint:`https://fcm.googleapis.com/send/${suffix}`,p256dh:keys.publicKey,auth:randomBytes(16).toString('base64url')};
   await pushService.subscribe(member.id,subscription);await pushService.subscribe(member.id,subscription);
   await assert.rejects(pushService.subscribe(admin.id,subscription));
   await pushService.unsubscribe(admin.id,subscription.endpoint);
   const [count]=await db.query<{count:number}>('SELECT count(*)::int AS count FROM "PushSubscription" WHERE "userId"=:id',{type:QueryTypes.SELECT,replacements:{id:member.id}});assert.equal(count!.count,1);
   for(let i=0;i<9;i++)await pushService.subscribe(member.id,{...subscription,endpoint:subscription.endpoint+'-'+i});
   await pushService.subscribe(member.id,subscription);
   await assert.rejects(pushService.subscribe(member.id,{...subscription,endpoint:subscription.endpoint+'-overflow'}));
   await pushService.savePreferences(member.id,{rehearsals:true,reminders:true,push:true});
   await Rehearsal.update({description:'Push delivery check'},{where:{id:rehearsalId}});
   const sent:string[]=[];const send=t.mock.method(webpush,'sendNotification',async(...args:Parameters<typeof webpush.sendNotification>)=>{sent.push(String(args[1]));return {statusCode:201,body:'',headers:{}};});
   try {await new NotificationsWorker(pushService,pushConfig).tick();assert.equal(sent.length,10);assert.ok(sent.every(payload=>!payload.includes('Push delivery check')&&payload.includes('Open the app to view it.')));} finally {send.mock.restore();}
   await pushService.savePreferences(member.id,{rehearsals:true,reminders:true,push:false});
   await pushService.unsubscribe(member.id,subscription.endpoint);
  });
  await t.test('cancellation links survive deletion; suspension and demotion enforce access',async()=>{
   await Rehearsal.destroy({where:{id:rehearsalId}});let inbox=await service.list(actor(member),1);assert.ok(inbox.data.some(n=>n.kind==='rehearsal-cancelled'));assert.ok(inbox.data.every(n=>n.href==='/rehearsals'));
   await call('notifications/read-all','PATCH',memberToken);assert.equal((await service.list(actor(member),1)).unreadCount,0);
   await member.update({status:UserStatus.SUSPENDED});assert.equal((await call('notifications','GET',memberToken)).status,401);
   await admin.update({role:Role.MEMBER});assert.equal((await service.list(actor(admin),1)).data.some(n=>n.kind==='registration'),false);
   const [count]=await db.query<{count:number}>('SELECT count(*)::int AS count FROM "Notification" WHERE "userId"=:id AND kind=\'registration\'',{type:QueryTypes.SELECT,replacements:{id:admin.id}});assert.ok(count!.count>0);
  });
 } finally {child.kill('SIGTERM');await stopped;if(rehearsalId)await Rehearsal.destroy({where:{id:rehearsalId}});if(playlistId)await Playlist.destroy({where:{id:playlistId}});await User.destroy({where:{id:ids}});await db.close();}
});
