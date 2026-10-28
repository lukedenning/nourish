const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const empty=()=>({version:1,foods:[],favourites:[],weights:[],notes:{}});
const food=(id,title=id)=>({id,title,date:'2026-10-28',portion:'1',calories:100,protein:10,carbs:12,sugars:3,fats:4,saturates:1,fiber:2,salt:0.4});
const storageMap=new Map();let storageFull=false,fail=false,sessionFails=false,casRace=false,rpcCalls=0;
const storage={getItem:key=>storageMap.get(key)||null,setItem:(key,value)=>{if(storageFull)throw Error('Quota exceeded');storageMap.set(key,value);},removeItem:key=>storageMap.delete(key)};
const db=new Map();let user={id:'a',email:'a@example.invalid'};
const client={auth:{getSession:async()=>{if(sessionFails)throw Error('Offline');return {data:{session:{user}},error:null};}},from:()=>({select:()=>({eq:(key,id)=>({maybeSingle:async()=>{if(fail)throw Error('Offline');return {data:structuredClone(db.get(id)||null),error:null};}})})}),rpc:async(name,args)=>{
 rpcCalls++;if(fail)throw Error('Network lost');const row=db.get(user.id)||{document:empty(),revision:0};
 if(casRace){casRace=false;row.document.foods.push(food('racing-device'));row.revision++;db.set(user.id,row);}
 if(args.expected_revision!==row.revision)return {error:{message:'journal_conflict'}};
 const saved={document:structuredClone(args.next_document),revision:row.revision+1};db.set(user.id,saved);return {data:structuredClone(saved)};
}};
const context={structuredClone,console,localStorage:storage,navigator:{onLine:true},JSON,Map,Set,Number,Error};context.globalThis=context;vm.createContext(context);
for(const file of ['cloud.js','offline.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),context);
const validate=doc=>{assert.equal(doc.version,1);for(const key of ['foods','weights','favourites'])assert.ok(Array.isArray(doc[key]));return doc;};
const create=()=>new context.OfflineJournalCloud(client,validate,storage);
async function main(){
 let cloud=create();await cloud.session();let row=await cloud.load();cloud.accept(row);
 let doc=empty();doc.foods.push(food('first'));doc.weights.push({date:'2026-10-28',kg:90});doc.notes['2026-10-28']='Original';row=await cloud.save(doc);assert.equal(row.pending,false);assert.equal(db.get('a').document.foods.length,1);
 // Save all record types offline and reopen from durable account-specific storage.
 fail=true;context.navigator.onLine=false;doc=structuredClone(row.document);doc.foods.push(food('offline'));doc.favourites.push(food('regular'));doc.weights[0].kg=89;doc.notes['2026-10-29']='Offline note';row=await cloud.save(doc);assert.equal(row.pending,true);assert.equal(db.get('a').document.foods.length,1);
 sessionFails=true;cloud=create();await cloud.session();row=await cloud.load();assert.equal(row.document.foods.length,2);assert.equal(row.document.weights[0].kg,89);assert.equal(row.document.notes['2026-10-29'],'Offline note');assert.equal(row.document.favourites.length,1);assert.equal(row.document.foods[1].sugars,3);assert.equal(row.document.foods[1].saturates,1);assert.equal(row.document.foods[1].fiber,2);assert.equal(row.document.foods[1].salt,0.4);sessionFails=false;
 // Another device adds unrelated records; reconnect auto merges both copies.
 db.get('a').document.foods.push(food('remote'));db.get('a').document.notes['2026-10-30']='Remote note';db.get('a').revision++;
 fail=false;context.navigator.onLine=true;row=await cloud.load();assert.equal(row.pending,false);assert.equal(row.document.foods.length,3);assert.equal(row.document.notes['2026-10-30'],'Remote note');assert.equal(row.document.weights[0].kg,89);
 // CAS race is rebased, preserving the racing device's addition.
 doc=structuredClone(row.document);doc.foods.push(food('race-local'));casRace=true;row=await cloud.save(doc);assert.equal(row.pending,false);assert.ok(row.document.foods.some(f=>f.id==='racing-device'));assert.ok(row.document.foods.some(f=>f.id==='race-local'));
 // Offline deletion merges without resurrecting an unchanged remote record.
 context.navigator.onLine=false;doc=structuredClone(row.document);doc.foods=doc.foods.filter(f=>f.id!=='first');await cloud.save(doc);context.navigator.onLine=true;row=await cloud.load();assert.equal(row.document.foods.some(f=>f.id==='first'),false);
 // Same-note and same-date weight conflicts keep local drafts pending, never overwrite cloud.
 context.navigator.onLine=false;doc=structuredClone(row.document);doc.notes['2026-10-28']='Local edit';doc.weights[0].kg=88;await cloud.save(doc);
 db.get('a').document.notes['2026-10-28']='Remote edit';db.get('a').document.weights[0].kg=87;db.get('a').revision++;context.navigator.onLine=true;
 row=await cloud.load();assert.equal(row.offlineConflict,true);assert.equal(row.pending,true);assert.equal(row.document.notes['2026-10-28'],'Local edit');assert.equal(db.get('a').document.notes['2026-10-28'],'Remote edit');assert.equal(db.get('a').document.weights[0].kg,87);
 row=await cloud.resolveOffline();assert.equal(row.pending,false);assert.equal(db.get('a').document.weights[0].kg,88);assert.equal(db.get('a').document.notes['2026-10-28'],'Local edit');
 // Network failure despite an online indicator is still durable and retries later.
 fail=true;doc=structuredClone(row.document);doc.foods.push(food('network-failure'));row=await cloud.save(doc);assert.equal(row.pending,true);fail=false;row=await cloud.load();assert.equal(row.pending,false);assert.ok(row.document.foods.some(f=>f.id==='network-failure'));
 // Local write failure never claims offline success or submits an undurable write.
 storageFull=true;const before=rpcCalls;doc=structuredClone(row.document);doc.foods.push(food('no-space'));await assert.rejects(cloud.save(doc),/could not save locally/);assert.equal(rpcCalls,before);storageFull=false;
 // Two tabs preserve independent local changes before reconnecting.
 const other=create();await other.session();await other.load();context.navigator.onLine=false;doc=structuredClone(row.document);doc.foods.push(food('tab-one'));await cloud.save(doc);let otherDoc=structuredClone(row.document);otherDoc.foods.push(food('tab-two'));await other.save(otherDoc);context.navigator.onLine=true;row=await cloud.load();assert.ok(row.document.foods.some(f=>f.id==='tab-one'));assert.ok(row.document.foods.some(f=>f.id==='tab-two'));
 // Switching or signing out cannot reveal another account's cache.
 user={id:'b',email:'b@example.invalid'};cloud.setUser(user);row=await cloud.load();assert.equal(row.document.foods.length,0);cloud.setUser(null);await assert.rejects(cloud.load(),/Sign in/);assert.equal(storage.getItem('nourish-offline-account'),null);
 console.log('Passed: durable offline records and restart, account isolation, automatic reconnect merge, CAS retry, deletions, conflict review, network errors, storage quota failures and multiple tabs.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
