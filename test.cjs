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
 // Date arrows cross month and year boundaries using the existing date-change handler.
 el('date').value='2026-12-31';el('date').onchange();el('nextDay').onclick();assert.equal(el('date').value,'2027-01-01');el('previousDay').onclick();assert.equal(el('date').value,'2026-12-31');
 el('date').value='2028-03-01';el('date').onchange();el('previousDay').onclick();assert.equal(el('date').value,'2028-02-29');
 el('date').value='2026-10-28';el('date').onchange();
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
 // The top sync button loads the same remote account without import.
 run('resetFood();syncWeightForm();unsaved=null');
 db.get('account-a').document.foods.push({id:'from-phone',date:'2026-10-28',title:'Phone entry',portion:'1',calories:125,protein:12});db.get('account-a').revision++;
 await el('syncNow').onclick();assert.ok(run('state.foods.some(f=>f.id==="from-phone")'));assert.equal(el('syncNow').textContent,'Synced');assert.equal(el('syncNow').dataset.synced,'true');assert.match(el('status').textContent,/All saved entries are synced/);
 el('title').value='Unsubmitted food';handlers.input[0]();assert.equal(el('syncNow').textContent,'Sync now');await el('syncNow').onclick();assert.equal(el('title').value,'Unsubmitted food');assert.match(el('status').textContent,/Finish adding/);run('resetFood()');
 failSave=true;el('title').value='Draft after failure';el('calories').value='10';el('protein').value='1';await el('foodForm').onsubmit({preventDefault(){}});assert.equal(el('syncNow').textContent,'Sync now');assert.equal(el('syncNow').dataset.synced,'false');failSave=false;
 await el('syncNow').onclick();assert.equal(el('syncNow').textContent,'Sync now');assert.equal(el('syncNow').dataset.synced,'false');assert.match(el('status').textContent,/has not been saved/);
 assert.equal(el('title').value,'Draft after failure');
 // Daily notes save to the account, remain separate by date, and preserve drafts on failure.
 run('resetFood();syncWeightForm();unsaved=null;notesDirty=false');el('date').value='2026-10-28';el('date').onchange();
 const firstNote='Felt good after lunch.\nKeep <b>this</b> as plain text.';el('dayNotes').value=firstNote;el('dayNotes').oninput();await el('notesForm').onsubmit({preventDefault(){}});
 assert.equal(db.get('account-a').document.notes['2026-10-28'],firstNote);assert.equal(run('notesDirty'),false);assert.match(el('noteStatus').textContent,/Saved for/);
 el('date').value='2026-10-29';el('date').onchange();assert.equal(el('dayNotes').value,'');el('dayNotes').value='Second day note';el('dayNotes').oninput();await el('notesForm').onsubmit({preventDefault(){}});assert.equal(db.get('account-a').document.notes['2026-10-28'],firstNote);assert.equal(db.get('account-a').document.notes['2026-10-29'],'Second day note');
 failSave=true;el('dayNotes').value='Unsaved note draft';el('dayNotes').oninput();await el('notesForm').onsubmit({preventDefault(){}});assert.equal(el('dayNotes').value,'Unsaved note draft');assert.equal(db.get('account-a').document.notes['2026-10-29'],'Second day note');assert.match(el('noteStatus').textContent,/not saved/);failSave=false;
 await run('refreshCloud(true)');assert.equal(el('dayNotes').value,'Unsaved note draft');
 context.confirm=()=>false;el('date').value='2026-10-30';el('date').onchange();assert.equal(el('date').value,'2026-10-29');assert.equal(el('dayNotes').value,'Unsaved note draft');context.confirm=()=>true;
 await el('notesForm').onsubmit({preventDefault(){}});assert.equal(db.get('account-a').document.notes['2026-10-29'],'Unsaved note draft');
 el('date').value='2026-10-28';el('date').onchange();assert.equal(el('dayNotes').value,firstNote);el('dayNotes').value='';el('dayNotes').oninput();await el('notesForm').onsubmit({preventDefault(){}});assert.equal(db.get('account-a').document.notes['2026-10-28'],undefined);assert.ok(db.get('account-a').document.notes['2026-10-29']);
 assert.throws(()=>run("validate({...emptyJournal(),notes:{'not-a-date':'x'}})"));assert.throws(()=>run("validate({...emptyJournal(),notes:{'2026-10-28':'x'.repeat(5001)}})"));assert.throws(()=>run("validate({...emptyJournal(),notes:[]})"));assert.doesNotThrow(()=>run('validate({version:1,foods:[],weights:[],favourites:[]})'));
 console.log('Passed: cloud daily notes, per-date separation, multiline plain text, failed-save draft retention, date-change guard, clearing and legacy compatibility;');
 // A blank protein field saves as zero, including when saving a regular food.
 run('resetFood();notesDirty=false');el('date').value='2026-10-28';el('date').onchange();
 el('title').value='Zero protein example';el('portion').value='1 portion';el('calories').value='95';el('protein').value='';el('saveFav').checked=true;await el('foodForm').onsubmit({preventDefault(){}});
 assert.equal(run('state.foods.find(f=>f.title==="Zero protein example").protein'),0);assert.equal(run('state.favourites.find(f=>f.title==="Zero protein example").protein'),0);assert.equal(db.get('account-a').document.foods.find(f=>f.title==='Zero protein example').protein,0);
 // Optional macros survive cloud saves, regular foods and inline updates.
 run('resetFood()');el('title').value='Macro example';el('calories').value='250';el('protein').value='15';el('carbs').value='30';el('fats').value='8';el('saveFav').checked=true;await el('foodForm').onsubmit({preventDefault(){}});
 assert.equal(db.get('account-a').document.foods.find(f=>f.title==='Macro example').carbs,30);assert.equal(run('state.favourites.find(f=>f.title==="Macro example").fats'),8);
 const macroId=run('state.foods.find(f=>f.title==="Macro example").id');await handlers.submit[0]({target:{dataset:{macros:macroId},elements:{carbs:{value:'32'},fats:{value:'9'}}},preventDefault(){}});assert.equal(db.get('account-a').document.foods.find(f=>f.id===macroId).carbs,32);
 assert.throws(()=>run('validate({...emptyJournal(),foods:[{...state.foods[0],carbs:-1}]})'));assert.match(el('foodList').innerHTML,/data-macros=/);assert.match(el('stats').innerHTML,/macroTotals/);
 console.log('Passed: blank protein saves and syncs as zero, including regular foods;');
 // The consumed-food sidebar always follows the selected day, even in a month view.
 run("state=emptyJournal();state.foods=[{id:'day-a',date:'2026-10-28',title:'Oats',portion:'1 bowl',calories:100,protein:10},{id:'day-b',date:'2026-10-28',title:'<b>Yoghurt</b>',portion:'200 g',calories:200,protein:20},{id:'other-day',date:'2026-10-29',title:'Other day meal',portion:'1 plate',calories:900,protein:90}];view='month'");
 el('date').value='2026-10-28';run('render()');assert.match(el('consumedFoods').innerHTML,/Oats/);assert.match(el('consumedFoods').innerHTML,/&lt;b&gt;Yoghurt/);assert.doesNotMatch(el('consumedFoods').innerHTML,/Other day meal|<b>Yoghurt/);assert.match(el('consumedTotals').innerHTML,/300 kcal · 30 g protein/);
 el('date').value='2026-10-29';run('render()');assert.match(el('consumedFoods').innerHTML,/Other day meal/);assert.doesNotMatch(el('consumedFoods').innerHTML,/Oats/);assert.equal(el('consumedDate').textContent,run("localDate(new Date())==='2026-10-29'?'Today':'2026-10-29'"));
 el('date').value='2026-10-30';run('render()');assert.match(el('consumedFoods').innerHTML,/No foods logged/);assert.equal(el('consumedTotals').innerHTML,'');
 // Pull-to-refresh only starts at the page top, ignores controls, and needs a deliberate pull.
 let reloads=0;context.location.reload=()=>reloads++;context.window.scrollY=0;run('resetFood();notesDirty=false;weightDirty=false;unsaved=null');
 const touch=(x,y,blocked=false)=>({touches:[{clientX:x,clientY:y}],target:{closest:()=>blocked?{}:null},cancelable:true,preventDefault(){}});
 handlers.touchstart[0](touch(10,10));handlers.touchmove[0](touch(10,70));handlers.touchend[0]();assert.equal(reloads,0);
 handlers.touchstart[0](touch(10,10));handlers.touchmove[0](touch(10,115));assert.match(el('pullRefresh').textContent,/Release/);handlers.touchend[0]();assert.equal(reloads,1);assert.equal(el('pullRefresh').hidden,true);
 context.window.scrollY=100;handlers.touchstart[0](touch(10,10));handlers.touchmove[0](touch(10,115));handlers.touchend[0]();assert.equal(reloads,1);context.window.scrollY=0;
 handlers.touchstart[0](touch(10,10,true));handlers.touchmove[0](touch(10,115));handlers.touchend[0]();assert.equal(reloads,1);
 handlers.touchstart[0](touch(10,10));handlers.touchmove[0](touch(150,30));handlers.touchend[0]();assert.equal(reloads,1);
 el('title').value='Unsaved draft';context.confirm=()=>false;handlers.touchstart[0](touch(10,10));handlers.touchmove[0](touch(10,115));handlers.touchend[0]();assert.equal(reloads,1);context.confirm=()=>true;run('resetFood()');
 // Regular-food search matches titles only and never changes saved favourites.
 const savedRegulars=run('structuredClone(state.favourites)');run("state.favourites=[{id:'search-a',title:'Greek Yoghurt',portion:'oats portion',calories:100,protein:10},{id:'search-b',title:'Oats',portion:'1 bowl',calories:200,protein:5}]");el('regularSearch').value='  YOGHURT ';el('regularSearch').oninput();assert.match(el('favourites').innerHTML,/Greek Yoghurt/);assert.doesNotMatch(el('favourites').innerHTML,/>Oats</);
 el('regularSearch').value='oats';el('regularSearch').oninput();assert.doesNotMatch(el('favourites').innerHTML,/Greek Yoghurt/);assert.match(el('favourites').innerHTML,/>Oats</);assert.equal(run('state.favourites.length'),2);
 el('regularSearch').value='missing';el('regularSearch').oninput();assert.match(el('favourites').innerHTML,/No regular foods match/);el('regularSearch').value='';el('regularSearch').oninput();assert.match(el('favourites').innerHTML,/Greek Yoghurt/);context.savedRegulars=savedRegulars;run('state.favourites=savedRegulars');
 // Custom ranges include both boundaries and filter totals, food history and weight graphs.
 el('rangeStart').value='2026-10-28';el('rangeEnd').value='2026-10-29';run("view='custom'");el('rangeForm').onsubmit({preventDefault(){}});assert.equal(run('bounds($("date").value,view).join(",")'),'2026-10-28,2026-10-29');assert.match(el('stats').innerHTML,/1,200/);assert.match(el('foodList').innerHTML,/Oats/);assert.match(el('foodList').innerHTML,/Other day meal/);assert.match(el('history').innerHTML,/2026-10-28/);assert.doesNotMatch(el('history').innerHTML,/2026-10-30/);assert.equal(el('weightChartPeriod').textContent,'2026-10-28 – 2026-10-29');
 el('rangeStart').value='2026-10-30';el('rangeForm').onsubmit({preventDefault(){}});assert.match(el('rangeStatus').textContent,/on or before/);assert.equal(run('customRange[0]'),'2026-10-28');
 el('rangeStart').value='2026-10-29';el('rangeForm').onsubmit({preventDefault(){}});assert.match(el('stats').innerHTML,/900/);assert.doesNotMatch(el('foodList').innerHTML,/Oats/);run("view='day';render()");
 console.log('Passed: selected-day consumed-food list, independent of period, with totals, escaping and empty state;');
 console.log('Passed: top sync loads remote records without import, preserves drafts and retains unsaved warnings;');
 console.log('Passed: default lbs, kg conversion, selected-date update, weight chart bounds and missing days;');
 console.log('Passed: password sign-in without email, password setup validation and clearing, email-quota fallback, resend cooldown;');
 console.log('Passed: nutrition, favourites, edits, weight conversion, date boundaries, cloud reload, concurrent-device conflict, network failure, account isolation, signed-out writes, local migration, link validation.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
