const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map(),handlers={},storage=new Map(),db=new Map();
let currentUser={id:'account-a',email:'test@example.invalid'},failSave=false,saveCalls=0,signoutCallback,emailCalls=0,passwordCalls=0,passwordUpdates=0,signOutCalls=0;
const empty=()=>({version:1,foods:[],favourites:[],weights:[]});
function el(id){if(!elements.has(id))elements.set(id,{id,value:'',checked:false,hidden:false,disabled:false,inert:false,innerHTML:'',textContent:'',dataset:{},reset(){if(id==='foodForm'){for(const k of ['title','portion','calories','protein'])el(k).value='';el('saveFav').checked=false;}if(id==='weightForm'){el('weight').value='';el('unit').value='kg';}},focus(){},setAttribute(){},click(){}});return elements.get(id);}
const client={
 auth:{getSession:async()=>({data:{session:currentUser?{user:currentUser}:null},error:null}),onAuthStateChange:fn=>{signoutCallback=fn;return {};},signOut:async options=>{assert.equal(options.scope,'local');signOutCalls++;currentUser=null;return {error:null};},signInWithOtp:async()=>{emailCalls++;return {error:{status:429,code:'over_email_send_rate_limit',message:'email rate limit exceeded'}};},signInWithPassword:async ({email,password})=>{passwordCalls++;assert.equal(email,'test@example.invalid');if(password==='wrong')return {error:{status:400}};return {data:{session:{user:currentUser}},error:null};},updateUser:async ({password})=>{passwordUpdates++;assert.ok(password.length>=12);return {data:{user:currentUser},error:null};},verifyOtp:async()=>({data:{session:{user:currentUser}},error:null})},
 from:table=>({select:()=>({eq:(key,value)=>({maybeSingle:async()=>{assert.equal(value,currentUser.id);return {data:db.has(value)?structuredClone(db.get(value)):null,error:null};}})})}),
 rpc:async(name,args)=>{saveCalls++;assert.equal(name,'save_nourish_journal');if(failSave)return {error:{message:'Network unavailable'}};const row=db.get(currentUser.id);if((row?.revision||0)!==args.expected_revision)return {error:{message:'journal_conflict'}};const data={document:structuredClone(args.next_document),revision:args.expected_revision+1};db.set(currentUser.id,data);return {data:structuredClone(data),error:null};}
};
const document={getElementById:el,querySelectorAll:()=>[],addEventListener:(event,fn)=>{(handlers[event]??=[]).push(fn);},createElement:()=>el('a'),visibilityState:'visible'};
const context={document,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},crypto:require('node:crypto').webcrypto,structuredClone,Intl,Date,Number,Set,JSON,String,Math,console,setTimeout:()=>0,setInterval:()=>0,URL,Blob,confirm:()=>true,location:{origin:'https://example.invalid',pathname:'/nourish/'}};
context.window={NOURISH_CONFIG:{url:'https://example.supabase.co',publishableKey:'public-test'},supabase:{createClient:()=>client},addEventListener(){}};
vm.createContext(context);
for(const file of ['cloud.js','app.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),context);
const run=s=>vm.runInContext(s,context),flush=()=>new Promise(resolve=>setImmediate(resolve));
async function click(dataset){for(const handler of handlers.click||[])await handler({target:{closest:()=>({dataset})}});}
async function main(){
 await flush();assert.equal(run('loaded'),true);assert.equal(el('journal').inert,false);
 el('date').value='2026-10-28';el('title').value='Yoghurt';el('portion').value='200 g';el('calories').value='160';el('protein').value='20';el('saveFav').checked=true;
 await el('foodForm').onsubmit({preventDefault(){}});
 assert.equal(run('state.foods.length'),1);assert.equal(run('state.favourites.length'),1);assert.match(el('stats').innerHTML,/160/);assert.equal(storage.size,0,'Cloud journal must not be written to localStorage');
 await click({quick:run('state.favourites[0].id')});assert.equal(run('state.foods.length'),2);assert.match(el('stats').innerHTML,/320/);assert.notEqual(run('state.foods[0].id'),run('state.foods[1].id'));
 await click({edit:run('state.foods[1].id')});el('calories').value='80';el('protein').value='10';await el('foodForm').onsubmit({preventDefault(){}});assert.equal(run('state.foods.reduce((s,f)=>s+f.calories,0)'),240);
 el('unit').value='lb';el('weight').value='220.46226218';await el('weightForm').onsubmit({preventDefault(){}});assert.ok(Math.abs(run('state.weights[0].kg')-100)<1e-8);assert.match(el('weightInfo').textContent,/100 kg/);
 assert.equal(run("bounds('2026-11-01','week').join(',')"),'2026-10-26,2026-11-01');assert.equal(run("bounds('2028-02-15','month').join(',')"),'2028-02-01,2028-02-29');assert.equal(run("validDate('2026-02-30')"),false);
 assert.throws(()=>run('validate({version:1,foods:[{title:"bad"}],favourites:[],weights:[]})'));
 // Simulate another device advancing the cloud revision.
 db.get('account-a').revision++;db.get('account-a').document.foods.push({...db.get('account-a').document.foods[0],id:'other-device'});
 el('title').value='Draft';el('calories').value='50';el('protein').value='2';await el('foodForm').onsubmit({preventDefault(){}});
 assert.match(el('status').textContent,/not saved/);assert.equal(el('title').value,'Draft');assert.equal(run('state.foods.length'),3);assert.equal(run('unsaved.foods.length'),3);
 await el('foodForm').onsubmit({preventDefault(){}});assert.equal(run('state.foods.length'),4);assert.equal(el('title').value,'');
 failSave=true;el('title').value='Offline draft';el('calories').value='5';el('protein').value='1';const before=JSON.stringify(db.get('account-a'));await el('foodForm').onsubmit({preventDefault(){}});assert.equal(JSON.stringify(db.get('account-a')),before);assert.equal(el('title').value,'Offline draft');assert.match(el('syncStatus').textContent,/Not saved/);failSave=false;
 run('resetFood()');
 // Account switching must erase the previous journal from memory and UI.
 currentUser={id:'account-b',email:'other@example.invalid'};await run('activate({user:{id:"account-b",email:"other@example.invalid"}})');assert.equal(run('state.foods.length'),0);assert.equal(run('unsaved'),null);assert.doesNotMatch(el('foodList').innerHTML,/Yoghurt/);
 await run('activate(null)');const count=saveCalls;assert.equal(await run('save(emptyJournal(),"No")'),false);assert.equal(saveCalls,count);assert.equal(el('journal').inert,true);
 // Reload the original account: data comes from the remote store.
 currentUser={id:'account-a',email:'test@example.invalid'};await run('activate({user:{id:"account-a",email:"test@example.invalid"}})');assert.equal(run('state.foods.length'),4);
 // Local migration never overwrites a cloud weigh-in on the same date.
 const merged=run('mergeJournals(state,{version:1,foods:[],favourites:[],weights:[{date:"2026-10-28",kg:1},{date:"2026-10-27",kg:99}]})');assert.equal(merged.weights.length,2);assert.ok(merged.weights.find(w=>w.date==='2026-10-28').kg>99);
 await click({delete:run('state.foods[0].id')});assert.equal(run('state.foods.length'),3);
 // Sign-in-link fallback rejects arbitrary origins before using any token.
 el('loginLink').value='https://evil.example/auth/v1/verify?token=x&type=magiclink';await el('verifyForm').onsubmit({preventDefault(){}});assert.match(el('authStatus').textContent,/original sign-in link/);
 // Weight entry defaults to pounds, prefills the selected date, and converts both ways.
 run('syncWeightForm()');assert.equal(el('unit').value,'lb');assert.match(el('weightPreview').textContent,/lbs \/ .*kg/);assert.equal(run('weightDirty'),false);
 el('weight').value='220.46226218';el('weight').oninput();assert.match(el('weightPreview').textContent,/100 kg/);assert.equal(run('weightDirty'),true);
 el('unit').value='kg';el('unit').onchange();assert.equal(Number(el('weight').value),100);el('unit').value='lb';el('unit').onchange();assert.ok(Math.abs(Number(el('weight').value)-220.46)<.001);
 // Empty, single-point and multi-point plots; no missing day is treated as zero.
 const blank=run("weightChartMarkup([], '2026-10-01','2026-10-31')");assert.match(blank,/first weigh-in/);assert.doesNotMatch(blank,/<svg/);
 const single=run("weightChartMarkup([{date:'2026-10-28',kg:100}], '2026-10-01','2026-10-31')");assert.equal((single.match(/class="weightDot"/g)||[]).length,1);assert.doesNotMatch(single,/NaN|Infinity/);
 const graph=run("weightChartMarkup([{date:'2026-10-28',kg:99},{date:'2026-10-01',kg:101},{date:'2026-11-01',kg:98}], '2026-10-01','2026-10-31')");assert.equal((graph.match(/class="weightDot"/g)||[]).length,2);assert.match(graph,/Left axis pounds, right axis kilograms/);assert.doesNotMatch(graph,/2026-11-01|NaN|Infinity/);
 const d=graph.match(/<path d="([^"]+)"/)[1];assert.ok(Number(d.split(' ')[1])<Number(d.split(' ')[4]),'Points must be sorted along the date axis');
 // Updating the same day replaces one weigh-in; changing dates restores the lbs default.
 const countBefore=run('state.weights.length');el('weight').value='218';el('unit').value='lb';await el('weightForm').onsubmit({preventDefault(){}});assert.equal(run('state.weights.length'),countBefore);assert.ok(Math.abs(run('state.weights.find(w=>w.date==="2026-10-28").kg')-218/2.2046226218)<1e-8);
 el('date').value='2026-10-29';el('date').onchange();assert.equal(el('unit').value,'lb');assert.equal(el('weight').value,'');el('date').value='2026-10-28';el('date').onchange();assert.equal(Number(el('weight').value),218);
 assert.match(el('weightChartPeriod').textContent,/30 days/);await click({view:'week'});assert.match(el('weightChartPeriod').textContent,/2026-10-26/);await click({view:'month'});assert.match(el('weightChartPeriod').textContent,/2026-10-01/);await click({view:'day'});
 // Email quota errors produce a useful fallback and suppress repeat requests.
 await el('loginForm').onsubmit({preventDefault(){}});assert.equal(emailCalls,1);assert.match(el('authStatus').textContent,/quota/);assert.equal(el('loginButton').disabled,true);
 await el('loginForm').onsubmit({preventDefault(){}});assert.equal(emailCalls,1);
 // Saving a password requires a signed-in user and matching strong input.
 el('newPassword').value='synthetic-test-password';el('confirmPassword').value='mismatch';await el('setPasswordForm').onsubmit({preventDefault(){}});assert.equal(passwordUpdates,0);assert.match(el('passwordStatus').textContent,/do not match/);
 el('confirmPassword').value='synthetic-test-password';await el('setPasswordForm').onsubmit({preventDefault(){}});assert.equal(passwordUpdates,1);assert.equal(el('newPassword').value,'');assert.equal(el('confirmPassword').value,'');assert.match(el('passwordStatus').textContent,/Password saved/);
 // Password sign-in uses no email or sign-out request, and clears its input.
 el('passwordEmail').value='test@example.invalid';el('loginPassword').value='synthetic-test-password';await el('passwordLoginForm').onsubmit({preventDefault(){}});assert.equal(passwordCalls,1);assert.equal(emailCalls,1);assert.equal(signOutCalls,0);assert.equal(el('loginPassword').value,'');assert.equal(run('loaded'),true);
 el('loginPassword').value='wrong';await el('passwordLoginForm').onsubmit({preventDefault(){}});assert.match(el('authStatus').textContent,/Check your email and password/);assert.equal(el('loginPassword').value,'');
 assert.ok(![...storage.values()].some(value=>String(value).includes('synthetic-test-password')),'Passwords must never be stored by the app');
 console.log('Passed: default lbs, kg conversion, selected-date update, weight chart bounds and missing days;');
 console.log('Passed: password sign-in without email, password setup validation and clearing, email-quota fallback, resend cooldown;');
 console.log('Passed: nutrition, favourites, edits, weight conversion, date boundaries, cloud reload, concurrent-device conflict, network failure, account isolation, signed-out writes, local migration, link validation.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
