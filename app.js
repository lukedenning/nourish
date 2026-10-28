'use strict';
const $=id=>document.getElementById(id), KEY='nourish-journal-v1', LB=2.2046226218;
const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmt=n=>new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(new Date(s+'T12:00:00'))&&localDate(new Date(s+'T12:00:00'))===s;
const nutrition=x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&x.title.trim().length>0&&x.title.length<=100&&typeof x.portion==='string'&&x.portion.length<=60&&Number.isFinite(x.calories)&&x.calories>=0&&x.calories<=100000&&Number.isFinite(x.protein)&&x.protein>=0&&x.protein<=10000;
function validate(s){if(!s||s.version!==1||!Array.isArray(s.foods)||!Array.isArray(s.favourites)||!Array.isArray(s.weights)||!s.foods.every(x=>nutrition(x)&&validDate(x.date))||!s.favourites.every(nutrition)||!s.weights.every(x=>validDate(x.date)&&Number.isFinite(x.kg)&&x.kg>0&&x.kg<=2000))throw Error('Invalid journal backup');for(const rows of [s.foods,s.favourites])if(new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('Duplicate entry IDs');if(new Set(s.weights.map(x=>x.date)).size!==s.weights.length)throw Error('Duplicate weigh-in dates');return s;}
const emptyJournal=()=>({version:1,foods:[],favourites:[],weights:[]});
let state=emptyJournal(),view='day',cloud=null,loaded=false,busy=false,epoch=0,unsaved=null;
$('date').value=localDate(new Date());
const id=()=>crypto.randomUUID();
function journalAccess(){
  $('journal').inert=!cloud?.user||!loaded||busy;
  $('export').disabled=!loaded;
  $('import').disabled=!loaded||busy;
  $('refreshCloud').disabled=busy;
  $('signOut').disabled=busy;
}
function setBusy(value){busy=value;journalAccess();}
function notify(message){$('status').textContent=message;}
function dirty(){return Boolean($('title').value||$('weight').value||$('editId').value);}
async function refreshCloud(manual=false){
  if(!cloud?.user||busy||(!manual&&dirty()))return false;
  setBusy(true);const generation=epoch;
  try{
    const row=await cloud.load();
    if(generation!==epoch)return false;
    validate(row.document);
    if(!Number.isSafeInteger(row.revision)||row.revision<0)throw Error('Invalid cloud revision');
    const changed=cloud.revision!==row.revision;
    cloud.accept(row);state=row.document;loaded=true;render();
    $('syncStatus').textContent='Saved to cloud';
    if(manual)notify('Cloud journal refreshed. Your form entries are unchanged.');
    else if(changed)notify('Journal updated from another device.');
    updateMigration();return true;
  }catch(error){if(generation===epoch){$('syncStatus').textContent='Cloud unavailable';notify('Could not load your cloud journal. Check your connection, then refresh.');}return false;}
  finally{if(generation===epoch)setBusy(false);}
}
async function save(next,message){
  if(!cloud?.user||!loaded){notify('Sign in and load your journal before saving.');return false;}
  if(busy){notify('Please wait for the current cloud request.');return false;}
  setBusy(true);const generation=epoch;unsaved=null;
  $('syncStatus').textContent='Saving…';
  try{
    validate(next);await cloud.save(next);
    if(generation!==epoch)return false;
    state=next;render();$('syncStatus').textContent='Saved to cloud';notify(message+' Saved to your account.');return true;
  }catch(error){
    if(generation!==epoch)return false;
    unsaved=next;
    if(error.conflict){
      try{const row=await cloud.load();if(generation!==epoch)return false;validate(row.document);cloud.accept(row);state=row.document;render();$('syncStatus').textContent='Latest cloud version loaded';}
      catch{ $('syncStatus').textContent='Refresh required'; }
      notify('Another device changed your journal. This change was not saved. Review the latest entries and try again; your form entries are still here. You can export the unsaved version.');
    }else{$('syncStatus').textContent='Not saved';notify('Could not save to the cloud. Check your connection and try again. Your form entries are still here.');}
    return false;
  }finally{if(generation===epoch)setBusy(false);}
}
function bounds(date,mode){let start=new Date(date+'T12:00:00'),end=new Date(start);if(mode==='week'){start.setDate(start.getDate()-((start.getDay()+6)%7));end=new Date(start);end.setDate(end.getDate()+6);}if(mode==='month'){start.setDate(1);end=new Date(start.getFullYear(),start.getMonth()+1,0,12);}return [localDate(start),localDate(end)];}
function daysBetween(a,b){const days=[];let d=new Date(a+'T12:00:00');while(localDate(d)<=b){days.push(localDate(d));d.setDate(d.getDate()+1);}return days;}
const weightText=kg=>`${fmt(kg)} kg / ${fmt(kg*LB)} lbs`;
function render(){const date=$('date').value;if(!validDate(date))return;const [start,end]=bounds(date,view),foods=state.foods.filter(f=>f.date>=start&&f.date<=end),weights=state.weights.filter(w=>w.date>=start&&w.date<=end).sort((a,b)=>a.date.localeCompare(b.date));const calories=foods.reduce((s,f)=>s+f.calories,0),protein=foods.reduce((s,f)=>s+f.protein,0),logged=new Set(foods.map(f=>f.date)).size;const latest=state.weights.filter(w=>w.date<=end).sort((a,b)=>b.date.localeCompare(a.date))[0];const change=weights.length>1?weights.at(-1).kg-weights[0].kg:null;
$('stats').innerHTML=[['Calories',fmt(calories),view==='day'?'kcal today':`kcal total · ${fmt(logged?calories/logged:0)} / logged day`],['Protein',fmt(protein)+' g',view==='day'?'protein today':`${fmt(logged?protein/logged:0)} g / logged day`],['Latest weight',latest?fmt(latest.kg)+' kg':'—',latest?`${fmt(latest.kg*LB)} lbs · ${latest.date}`:'Add your first weigh-in'],['Weight change',change===null?'—':(change>0?'+':'')+fmt(change)+' kg',change===null?'Needs two weigh-ins in this period':`${change>0?'+':''}${fmt(change*LB)} lbs · first to last`]].map(([label,value,note])=>`<div class="stat"><label>${label}</label><strong>${value}</strong><small>${note}</small></div>`).join('');
$('period').textContent=start===end?start:`${start} – ${end}`;
$('foodList').innerHTML=foods.length?foods.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(f=>`<div class="foodRow"><div class="details"><b>${esc(f.title)}</b><small>${esc(f.portion||'1 portion')}${view!=='day'?' · '+f.date:''}</small></div><div class="nutrients">${fmt(f.calories)} kcal<small>${fmt(f.protein)} g protein</small></div><button class="icon" data-edit="${esc(f.id)}" aria-label="Edit ${esc(f.title)}">Edit</button><button class="icon" data-delete="${esc(f.id)}" aria-label="Delete ${esc(f.title)}">×</button></div>`).join(''):'<p class="empty">Your journal is ready. Add your first food above.</p>';
$('favourites').innerHTML=state.favourites.length?state.favourites.map(f=>`<div class="fav"><div class="details"><b>${esc(f.title)}</b><small>${esc(f.portion||'1 portion')} · ${fmt(f.calories)} kcal · ${fmt(f.protein)} g</small></div><button data-quick="${esc(f.id)}" aria-label="Add ${esc(f.title)}">+</button><button class="icon" data-unfav="${esc(f.id)}" aria-label="Remove favourite ${esc(f.title)}">×</button></div>`).join(''):'<p class="empty">Save a food as a regular to find it here.</p>';
const current=state.weights.find(w=>w.date===date);$('weightInfo').textContent=current?weightText(current.kg):'No weigh-in for this date.';$('deleteWeight').hidden=!current;
let chartDays=view==='day'?daysBetween(localDate(new Date(new Date(date+'T12:00:00').setDate(new Date(date+'T12:00:00').getDate()-6))),date):daysBetween(start,end);
const totals=chartDays.map(d=>({date:d,cal:state.foods.filter(f=>f.date===d).reduce((s,f)=>s+f.calories,0)})),max=Math.max(1,...totals.map(t=>t.cal));
$('chart').innerHTML=`<div class="chart" role="img" aria-label="Daily calorie totals; exact values in the table below">${totals.map((t,i)=>`<div class="bar" style="height:${Math.max(1,t.cal/max*100)}%" title="${t.date}: ${fmt(t.cal)} kcal"><span>${chartDays.length<10||i%5===0?Number(t.date.slice(-2)):''}</span></div>`).join('')}</div>`;
$('history').innerHTML=chartDays.slice().reverse().map(d=>{const fs=state.foods.filter(f=>f.date===d),w=state.weights.find(w=>w.date===d);return `<tr><td>${d}</td><td>${fs.length?fmt(fs.reduce((s,f)=>s+f.calories,0)):'—'}</td><td>${fs.length?fmt(fs.reduce((s,f)=>s+f.protein,0))+' g':'—'}</td><td>${w?weightText(w.kg):'—'}</td></tr>`;}).join('');}
$('foodForm').onsubmit=async e=>{
  e.preventDefault();if(busy||!validDate($('date').value))return;
  const edit=$('editId').value,old=state.foods.find(f=>f.id===edit);
  if(edit&&!old){notify('This food was removed on another device. Cancel the edit to add it again.');return;}
  const food={id:edit||id(),date:old?old.date:$('date').value,title:$('title').value.trim(),portion:$('portion').value.trim(),calories:Number($('calories').value),protein:Number($('protein').value)};
  if(!nutrition(food))return;const next=structuredClone(state);
  if(edit)next.foods=next.foods.map(f=>f.id===edit?food:f);else next.foods.push(food);
  if($('saveFav').checked){const {date,...fav}=food;fav.id=id();next.favourites.push(fav);}
  if(await save(next,edit?'Food updated.':'Food added.'))resetFood();
};
function resetFood(){$('foodForm').reset();$('editId').value='';$('addFood').textContent='Add food';$('cancelEdit').hidden=true;}
$('cancelEdit').onclick=resetFood;
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||busy)return;
  if(b.dataset.view){view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();return;}
  if(!loaded)return;
  const next=structuredClone(state);
  if(b.dataset.quick){const f=state.favourites.find(f=>f.id===b.dataset.quick);if(!f||!validDate($('date').value))return;next.foods.push({...f,id:id(),date:$('date').value});await save(next,'Usual portion added.');}
  if(b.dataset.unfav){next.favourites=next.favourites.filter(f=>f.id!==b.dataset.unfav);await save(next,'Regular food removed.');}
  if(b.dataset.delete){next.foods=next.foods.filter(f=>f.id!==b.dataset.delete);if(await save(next,'Food removed.')&&$('editId').value===b.dataset.delete)resetFood();}
  if(b.dataset.edit){const f=state.foods.find(f=>f.id===b.dataset.edit);if(!f)return;$('editId').value=f.id;for(const k of ['title','portion','calories','protein'])$(k).value=f[k];$('addFood').textContent='Save changes';$('cancelEdit').hidden=false;$('title').focus();}
});
$('date').onchange=()=>{if(validDate($('date').value)){resetFood();$('weightForm').reset();render();}};
$('weightForm').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  const value=Number($('weight').value),kg=$('unit').value==='lb'?value/LB:value;
  if(!Number.isFinite(kg)||kg<=0||kg>2000||!validDate($('date').value))return;
  const next=structuredClone(state);next.weights=next.weights.filter(w=>w.date!==$('date').value);next.weights.push({date:$('date').value,kg});
  if(await save(next,'Weight saved.'))$('weight').value='';
};
$('deleteWeight').onclick=async()=>{const next=structuredClone(state);next.weights=next.weights.filter(w=>w.date!==$('date').value);await save(next,'Weigh-in removed.');};
function downloadJournal(journal,suffix=''){
  const url=URL.createObjectURL(new Blob([JSON.stringify(journal,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`nourish-backup-${localDate(new Date())}${suffix}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('export').onclick=()=>{if(!loaded)return;if(unsaved&&confirm('Export the unsaved attempted version? Choose Cancel to export the current cloud journal instead.'))downloadJournal(unsaved,'-unsaved');else downloadJournal(state);};
$('import').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>10000000)throw Error('Too large');const imported=validate(JSON.parse(await file.text()));
    if(confirm('Replace your cloud journal on all devices with this backup? Export the current journal first if you want to keep it.')){
      if(await save(imported,'Backup imported.'))resetFood();
    }
  }catch(error){notify('This file is not a valid Nourish backup. Your journal has not changed.');}
  e.target.value='';
};
function localJournal(){try{const raw=localStorage.getItem(KEY);return raw?validate(JSON.parse(raw)):null;}catch{return null;}}
function updateMigration(){
  const local=localJournal();let done=false;
  try{done=localStorage.getItem('nourish-migrated-'+cloud.user.id)==='yes';}catch{}
  $('migration').hidden=done||!local||!(local.foods.length+local.favourites.length+local.weights.length);
}
function mergeJournals(remote,local){
  const next=structuredClone(remote);
  for(const key of ['foods','favourites'])for(const item of local[key]){
    const match=next[key].find(x=>x.id===item.id);
    if(!match)next[key].push(item);
    else if(JSON.stringify(match)!==JSON.stringify(item))next[key].push({...item,id:id()});
  }
  for(const w of local.weights)if(!next.weights.some(x=>x.date===w.date))next.weights.push(w);
  return validate(next);
}
$('migrateLocal').onclick=async()=>{
  const local=localJournal();if(!local||!cloud?.user||busy)return;
  if(!confirm('Merge the old entries in this browser into this signed-in account? Existing cloud weights take priority on matching dates.'))return;
  if(await save(mergeJournals(state,local),'Previous local entries imported.')){
    try{localStorage.setItem('nourish-migrated-'+cloud.user.id,'yes');}catch{}
    $('migration').hidden=true;
  }
};
async function activate(session){
  const user=session?.user||null;
  if(user?.id===cloud.user?.id&&loaded)return;
  epoch++;busy=false;loaded=false;unsaved=null;cloud.setUser(user);
  state=emptyJournal();resetFood();$('weightForm').reset();render();journalAccess();
  $('signedOut').hidden=Boolean(user);$('signedIn').hidden=!user;
  $('accountEmail').textContent=user?.email||'';
  $('authStatus').textContent='';notify('');
  if(user){$('syncStatus').textContent='Loading your journal…';await refreshCloud(true);}
  else $('syncStatus').textContent='Sign in to sync';
}
$('loginForm').onsubmit=async e=>{
  e.preventDefault();if(!cloud)return;const button=$('loginButton');button.disabled=true;
  try{
    const {error}=await cloud.client.auth.signInWithOtp({email:$('email').value.trim(),options:{emailRedirectTo:location.origin+location.pathname}});
    if(error)throw error;
    $('authStatus').textContent='Check your email for a sign-in link. Open it, or copy it into the link box below. Use the same email on every device.';
  }catch(error){$('authStatus').textContent='Could not send a sign-in email: '+error.message;}
  finally{button.disabled=false;}
};
$('verifyForm').onsubmit=async e=>{
  e.preventDefault();if(!cloud)return;
  try{
    const link=new URL($('loginLink').value.trim()),config=window.NOURISH_CONFIG;
    if(link.origin!==new URL(config.url).origin||link.pathname!=='/auth/v1/verify')throw Error('Paste the original sign-in link from your Supabase email.');
    const token=link.searchParams.get('token_hash')||link.searchParams.get('token');
    const type=link.searchParams.get('type');
    if(!token||!['email','magiclink','signup'].includes(type))throw Error('This is not a sign-in link. Request a new email above.');
    const {data,error}=await cloud.client.auth.verifyOtp({token_hash:token,type});
    if(error)throw error;
    $('loginLink').value='';await activate(data.session);
  }catch(error){$('authStatus').textContent=error.message;}
};
$('signOut').onclick=async()=>{
  if(!cloud||busy)return;
  if(dirty()&&!confirm('Sign out and discard the entries you have not saved?'))return;
  const {error}=await cloud.client.auth.signOut({scope:'local'});
  if(error){notify('Could not sign out. Please try again.');return;}
  await activate(null);
};
$('refreshCloud').onclick=()=>refreshCloud(true);
async function initialise(){
  journalAccess();render();
  try{
    const config=window.NOURISH_CONFIG;
    if(!window.supabase||!config?.url||!config?.publishableKey)throw Error('The cloud connection could not start. Reload the app to try again.');
    cloud=new JournalCloud(window.supabase.createClient(config.url,config.publishableKey));
    cloud.client.auth.onAuthStateChange((event,session)=>{setTimeout(()=>activate(session).catch(()=>notify('Unable to load this account. Please sign in again.')),0);});
    await activate(await cloud.session());
    setInterval(()=>{if(document.visibilityState==='visible')refreshCloud();},15000);
    window.addEventListener('focus',()=>refreshCloud());
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshCloud();});
  }catch(error){$('syncStatus').textContent='Connection unavailable';$('authStatus').textContent=error.message;}
}
initialise();
