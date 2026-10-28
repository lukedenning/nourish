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
let emailRetryAt=0,emailInFlight=false,passwordInFlight=false;
let weightDirty=false,lastWeightUnit='lb';
$('date').value=localDate(new Date());
const id=()=>crypto.randomUUID();
function journalAccess(){
  $('journal').inert=!cloud?.user||!loaded||busy;
  $('export').disabled=!loaded;
  $('import').disabled=!loaded||busy;
  $('refreshCloud').disabled=busy;
  $('signOut').disabled=busy;
  $('syncNow').disabled=busy;
  $('syncNow').textContent=cloud?.user?'Sync now':'Sign in';
}
function setBusy(value){busy=value;journalAccess();}
function notify(message){$('status').textContent=message;}
function setSyncStatus(message){
  $('syncStatus').textContent=message;
  const signedIn=Boolean(cloud?.user);
  const problem=/unavailable|Not saved|Refresh required|required|Connection/.test(message);
  $('syncBanner').dataset.state=problem?'error':message.includes('Saving')||message.includes('Syncing')?'working':signedIn?'saved':'signed-out';
  $('syncNotice').textContent=problem?message+' · Check your connection and try again.':!signedIn?'Sign in to sync your saved food and weight entries across devices.':message==='Saved to cloud'?'Saved to cloud · Available on all your devices.':message;
}

function dirty(){return Boolean($('title').value||weightDirty||$('editId').value);}
async function refreshCloud(manual=false){
  if(!cloud?.user||busy||(!manual&&dirty()))return false;
  setBusy(true);const generation=epoch;
  if(manual)setSyncStatus('Syncing saved entries…');
  try{
    const row=await cloud.load();
    if(generation!==epoch)return false;
    validate(row.document);
    if(!Number.isSafeInteger(row.revision)||row.revision<0)throw Error('Invalid cloud revision');
    const changed=cloud.revision!==row.revision;
    cloud.accept(row);state=row.document;loaded=true;render();
    setSyncStatus(unsaved?'Not saved':'Saved to cloud');
    if(manual)notify('Cloud journal refreshed. Your form entries are unchanged.');
    else if(changed)notify('Journal updated from another device.');
    updateMigration();return true;
  }catch(error){if(generation===epoch){setSyncStatus('Cloud unavailable');notify('Could not load your cloud journal. Check your connection, then refresh.');}return false;}
  finally{if(generation===epoch)setBusy(false);}
}
async function save(next,message){
  if(!cloud?.user||!loaded){notify('Sign in and load your journal before saving.');return false;}
  if(busy){notify('Please wait for the current cloud request.');return false;}
  setBusy(true);const generation=epoch;unsaved=null;
  setSyncStatus('Saving…');
  try{
    validate(next);await cloud.save(next);
    if(generation!==epoch)return false;
    state=next;render();setSyncStatus('Saved to cloud');notify(message+' Saved to your account.');return true;
  }catch(error){
    if(generation!==epoch)return false;
    unsaved=next;
    if(error.conflict){
      try{const row=await cloud.load();if(generation!==epoch)return false;validate(row.document);cloud.accept(row);state=row.document;render();setSyncStatus('Latest cloud version loaded');}
      catch{ setSyncStatus('Refresh required'); }
      notify('Another device changed your journal. This change was not saved. Review the latest entries and try again; your form entries are still here. You can export the unsaved version.');
    }else{setSyncStatus('Not saved');notify('Could not save to the cloud. Check your connection and try again. Your form entries are still here.');}
    return false;
  }finally{if(generation===epoch)setBusy(false);}
}
function bounds(date,mode){let start=new Date(date+'T12:00:00'),end=new Date(start);if(mode==='week'){start.setDate(start.getDate()-((start.getDay()+6)%7));end=new Date(start);end.setDate(end.getDate()+6);}if(mode==='month'){start.setDate(1);end=new Date(start.getFullYear(),start.getMonth()+1,0,12);}return [localDate(start),localDate(end)];}
function daysBetween(a,b){const days=[];let d=new Date(a+'T12:00:00');while(localDate(d)<=b){days.push(localDate(d));d.setDate(d.getDate()+1);}return days;}
const weightText=kg=>`${fmt(kg*LB)} lbs / ${fmt(kg)} kg`;
function updateWeightPreview(){
  const value=Number($('weight').value),kg=$('unit').value==='kg'?value:value/LB;
  $('weight').max=$('unit').value==='kg'?'2000':'4409';
  $('weightPreview').textContent=$('weight').value&&Number.isFinite(kg)&&kg>0?weightText(kg):'Enter a weight to see both units.';
}
function syncWeightForm(){
  weightDirty=false;lastWeightUnit='lb';$('unit').value='lb';
  const current=state.weights.find(w=>w.date===$('date').value);
  $('weight').value=current?String(Math.round(current.kg*LB*100)/100):'';
  updateWeightPreview();
}
function weightChartMarkup(records,start,end){
  const points=records.filter(w=>w.date>=start&&w.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
  if(!points.length)return '<p class="empty weightEmpty">Add your first weigh-in to start your weight graph.</p>';
  const width=700,height=260,left=65,right=65,top=26,bottom=40;
  const plotW=width-left-right,plotH=height-top-bottom;
  const values=points.map(w=>w.kg*LB),min=Math.min(...values),max=Math.max(...values),padding=Math.max((max-min)*.2,1);
  const low=Math.max(0,min-padding),high=max+padding;
  const dayNumber=d=>Date.parse(d+'T12:00:00Z')/86400000,first=dayNumber(start),last=dayNumber(end);
  const x=d=>left+(last===first?.5:(dayNumber(d)-first)/(last-first))*plotW;
  const y=lbs=>top+(high-lbs)/(high-low)*plotH;
  const ticks=Array.from({length:4},(_,i)=>low+(high-low)*i/3);
  const dateLabel=d=>new Date(d+'T12:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short'});
  const axes=ticks.map(v=>`<line x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}" class="weightGrid"/><text x="${left-10}" y="${y(v)+4}" text-anchor="end">${fmt(v)}</text><text x="${width-right+10}" y="${y(v)+4}">${fmt(v/LB)}</text>`).join('');
  const labels=[start,...(last-first>3?[new Date((first+Math.floor((last-first)/2))*86400000).toISOString().slice(0,10)]:[]),end].filter((v,i,a)=>a.indexOf(v)===i);
  const dateTicks=labels.map(d=>`<text x="${x(d)}" y="${height-12}" text-anchor="middle">${esc(dateLabel(d))}</text>`).join('');
  const path=points.map((w,i)=>`${i?'L':'M'} ${x(w.date)} ${y(w.kg*LB)}`).join(' ');
  const markers=points.map(w=>`<circle class="weightDot" cx="${x(w.date)}" cy="${y(w.kg*LB)}" r="4.5"><title>${w.date}: ${weightText(w.kg)}</title></circle>`).join('');
  return `<svg class="weightSvg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="weightGraphTitle weightGraphDesc"><title id="weightGraphTitle">Recorded weight from ${start} to ${end}</title><desc id="weightGraphDesc">${points.length} recorded weigh-ins. First: ${weightText(points[0].kg)}. Latest: ${weightText(points.at(-1).kg)}. Left axis pounds, right axis kilograms. Exact values are in the recorded weights table.</desc><text x="${left-10}" y="12" text-anchor="end">lbs</text><text x="${width-right+10}" y="12">kg</text>${axes}${dateTicks}<path d="${path}" class="weightLine"/>${markers}</svg>`;
}
function renderWeightChart(){
  const date=$('date').value;
  // Daily view shows a month of progress; longer views follow the chosen period.
  const [start,end]=view==='day'?[localDate(new Date(new Date(date+'T12:00:00').setDate(new Date(date+'T12:00:00').getDate()-29))),date]:bounds(date,view);
  const points=state.weights.filter(w=>w.date>=start&&w.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
  $('weightChartPeriod').textContent=view==='day'?'Last 30 days':`${start} – ${end}`;
  $('weightChart').innerHTML=weightChartMarkup(points,start,end);
  $('weightChartNote').textContent=points.length===1?'Your first weigh-in is shown. Add another day to see the line.':points.length>1?'Recorded weigh-ins only; the line connects them across days without an entry. Left: lbs · Right: kg.':'Save a weigh-in above. Your progress will appear here.';
  $('weightHistory').innerHTML=points.length?points.slice().reverse().map(w=>`<tr><td>${w.date}</td><td>${fmt(w.kg*LB)}</td><td>${fmt(w.kg)}</td></tr>`).join(''):'<tr><td colspan="3">No weigh-ins in this period.</td></tr>';
}

function render(){const date=$('date').value;if(!validDate(date))return;const [start,end]=bounds(date,view),foods=state.foods.filter(f=>f.date>=start&&f.date<=end),weights=state.weights.filter(w=>w.date>=start&&w.date<=end).sort((a,b)=>a.date.localeCompare(b.date));const calories=foods.reduce((s,f)=>s+f.calories,0),protein=foods.reduce((s,f)=>s+f.protein,0),logged=new Set(foods.map(f=>f.date)).size;const latest=state.weights.filter(w=>w.date<=end).sort((a,b)=>b.date.localeCompare(a.date))[0];const changeStart=view==='day'?localDate(new Date(new Date(date+'T12:00:00').setDate(new Date(date+'T12:00:00').getDate()-29))):start;const changeWeights=state.weights.filter(w=>w.date>=changeStart&&w.date<=end).sort((a,b)=>a.date.localeCompare(b.date));const change=changeWeights.length>1?changeWeights.at(-1).kg-changeWeights[0].kg:null;
$('stats').innerHTML=[['Calories',fmt(calories),view==='day'?'kcal today':`kcal total · ${fmt(logged?calories/logged:0)} / logged day`],['Protein',fmt(protein)+' g',view==='day'?'protein today':`${fmt(logged?protein/logged:0)} g / logged day`],['Latest weight',latest?fmt(latest.kg*LB)+' lbs':'—',latest?`${fmt(latest.kg)} kg · ${latest.date}`:'Add your first weigh-in'],['Weight change',change===null?'—':(change>0?'+':'')+fmt(change*LB)+' lbs',change===null?'Needs two weigh-ins in the graph period':`${change>0?'+':''}${fmt(change)} kg · ${view==='day'?'last 30 days':'first to last'}`]].map(([label,value,note])=>`<div class="stat"><label>${label}</label><strong>${value}</strong><small>${note}</small></div>`).join('');
$('period').textContent=start===end?start:`${start} – ${end}`;
const consumed=state.foods.filter(f=>f.date===date);
$('consumedDate').textContent=date===localDate(new Date())?'Today':date;
$('consumedFoods').innerHTML=consumed.length?consumed.map(f=>`<li class="consumedFood"><div class="details"><b>${esc(f.title)}</b><small>${esc(f.portion||'1 portion')}</small></div><div class="nutrients">${fmt(f.calories)} kcal<small>${fmt(f.protein)} g protein</small></div></li>`).join(''):'<li class="empty">No foods logged for this day yet.</li>';
$('consumedTotals').innerHTML=consumed.length?`<span>${consumed.length} ${consumed.length===1?'entry':'entries'}</span><strong>${fmt(consumed.reduce((sum,f)=>sum+f.calories,0))} kcal · ${fmt(consumed.reduce((sum,f)=>sum+f.protein,0))} g protein</strong>`:'';

$('foodList').innerHTML=foods.length?foods.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(f=>`<div class="foodRow"><div class="details"><b>${esc(f.title)}</b><small>${esc(f.portion||'1 portion')}${view!=='day'?' · '+f.date:''}</small></div><div class="nutrients">${fmt(f.calories)} kcal<small>${fmt(f.protein)} g protein</small></div><button class="icon" data-edit="${esc(f.id)}" aria-label="Edit ${esc(f.title)}">Edit</button><button class="icon" data-delete="${esc(f.id)}" aria-label="Delete ${esc(f.title)}">×</button></div>`).join(''):'<p class="empty">Your journal is ready. Add your first food above.</p>';
$('favourites').innerHTML=state.favourites.length?state.favourites.map(f=>`<div class="fav"><div class="details"><b>${esc(f.title)}</b><small>${esc(f.portion||'1 portion')} · ${fmt(f.calories)} kcal · ${fmt(f.protein)} g</small></div><button data-quick="${esc(f.id)}" aria-label="Add ${esc(f.title)}">+</button><button class="icon" data-unfav="${esc(f.id)}" aria-label="Remove favourite ${esc(f.title)}">×</button></div>`).join(''):'<p class="empty">Save a food as a regular to find it here.</p>';
const current=state.weights.find(w=>w.date===date);$('weightInfo').textContent=current?weightText(current.kg):'No weigh-in for this date.';$('deleteWeight').hidden=!current;
$('weighDate').textContent='For '+date;$('weightSubmit').textContent=current?'Update weigh-in':'Save weigh-in';
if(!weightDirty)syncWeightForm();renderWeightChart();
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
$('date').onchange=()=>{if(validDate($('date').value)){resetFood();weightDirty=false;$('weightForm').reset();render();}};
$('weight').oninput=()=>{weightDirty=true;updateWeightPreview();};
$('unit').onchange=()=>{
  const value=Number($('weight').value),unit=$('unit').value;
  if($('weight').value&&Number.isFinite(value)&&value>0&&unit!==lastWeightUnit){
    const converted=unit==='kg'?value/LB:value*LB;$('weight').value=String(Math.round(converted*100)/100);
  }
  lastWeightUnit=unit;weightDirty=true;updateWeightPreview();
};
$('weightForm').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  const value=Number($('weight').value),kg=$('unit').value==='lb'?value/LB:value;
  if(!Number.isFinite(kg)||kg<=0||kg>2000||!validDate($('date').value))return;
  const next=structuredClone(state);next.weights=next.weights.filter(w=>w.date!==$('date').value);next.weights.push({date:$('date').value,kg});
  if(await save(next,'Weigh-in saved.'))syncWeightForm();
};
$('deleteWeight').onclick=async()=>{const next=structuredClone(state);next.weights=next.weights.filter(w=>w.date!==$('date').value);if(await save(next,'Weigh-in removed.'))syncWeightForm();};
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
  state=emptyJournal();resetFood();weightDirty=false;$('weightForm').reset();render();journalAccess();
  $('signedOut').hidden=Boolean(user);$('signedIn').hidden=!user;
  $('accountEmail').textContent=user?.email||'';
  $('authStatus').textContent='';$('passwordStatus').textContent='';
  for(const key of ['loginPassword','newPassword','confirmPassword'])$(key).value='';
  $('passwordSetup').open=false;notify('');
  if(user){setSyncStatus('Loading your journal…');await refreshCloud(true);}
  else setSyncStatus('Sign in to sync');
}
function updateEmailButton(){
  const remaining=Math.max(0,Math.ceil((emailRetryAt-Date.now())/1000));
  $('loginButton').disabled=!cloud||emailInFlight||remaining>0;
  $('loginButton').textContent=remaining?`Email link · wait ${remaining}s`:'Email me a sign-in link';
}
$('loginForm').onsubmit=async e=>{
  e.preventDefault();if(!cloud||emailInFlight||Date.now()<emailRetryAt)return;
  emailInFlight=true;updateEmailButton();
  try{
    const {error}=await cloud.client.auth.signInWithOtp({email:$('email').value.trim(),options:{emailRedirectTo:location.origin+location.pathname}});
    if(error)throw error;
    emailRetryAt=Date.now()+60000;
    $('authStatus').textContent='Check your email for a sign-in link. Once signed in, set a password to use on your other devices without more emails.';
  }catch(error){
    if(error.status===429||error.code==='over_email_send_rate_limit'||/rate.*limit|rate.*exceeded/i.test(error.message||'')){
      emailRetryAt=Date.now()+60000;
      $('authStatus').textContent='The sign-in email quota has been reached. Use your password above. If you have not set one, set it on a device where you are already signed in; otherwise wait for the email quota to reset. The retry timer does not indicate when the server quota resets.';
    }else $('authStatus').textContent='Could not send a sign-in email: '+error.message;
  }finally{emailInFlight=false;updateEmailButton();}
};
$('passwordLoginForm').onsubmit=async e=>{
  e.preventDefault();if(!cloud||passwordInFlight)return;
  passwordInFlight=true;$('passwordLoginButton').disabled=true;
  try{
    const {data,error}=await cloud.client.auth.signInWithPassword({email:$('passwordEmail').value.trim(),password:$('loginPassword').value});
    if(error)throw error;
    await activate(data.session);
  }catch(error){
    $('authStatus').textContent=error.status===429?'Too many sign-in attempts. Wait a little before trying again.':'Could not sign in. Check your email and password. If you have not set a password, set it from a device where you are already signed in.';
  }finally{$('loginPassword').value='';passwordInFlight=false;$('passwordLoginButton').disabled=false;}
};
$('setPasswordForm').onsubmit=async e=>{
  e.preventDefault();if(!cloud?.user||passwordInFlight)return;
  if($('newPassword').value.length<12){$('passwordStatus').textContent='Choose a password of at least 12 characters.';return;}
  if($('newPassword').value!==$('confirmPassword').value){$('passwordStatus').textContent='The passwords do not match.';return;}
  const generation=epoch;passwordInFlight=true;$('setPasswordButton').disabled=true;
  try{
    const {error}=await cloud.client.auth.updateUser({password:$('newPassword').value});
    if(error)throw error;
    if(generation===epoch)$('passwordStatus').textContent='Password saved. Use your email and this password to sign in on your other devices.';
  }catch(error){if(generation===epoch)$('passwordStatus').textContent='Could not save your password: '+error.message;}
  finally{for(const key of ['newPassword','confirmPassword'])$(key).value='';passwordInFlight=false;$('setPasswordButton').disabled=false;}
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
async function syncFromTop(){
  if(!cloud?.user){$('accountPanel').scrollIntoView({behavior:'smooth',block:'center'});$('passwordEmail').focus({preventScroll:true});return;}
  const hasDraft=dirty(),hasUnsaved=Boolean(unsaved);
  if(await refreshCloud(true)){
    if(hasUnsaved)notify('Latest saved entries loaded. Your previous change has not been saved; review it and try saving again.');
    else if(hasDraft)notify('Saved entries are synced. Finish adding your food or saving your weigh-in to sync the form entries too.');
    else notify('All saved entries are synced. Open Nourish with the same account on your other devices.');
  }
}
$('syncNow').onclick=syncFromTop;
$('refreshCloud').onclick=syncFromTop;
async function initialise(){
  journalAccess();render();
  try{
    const config=window.NOURISH_CONFIG;
    if(!window.supabase||!config?.url||!config?.publishableKey)throw Error('The cloud connection could not start. Reload the app to try again.');
    cloud=new JournalCloud(window.supabase.createClient(config.url,config.publishableKey));
    cloud.client.auth.onAuthStateChange((event,session)=>{setTimeout(()=>activate(session).catch(()=>notify('Unable to load this account. Please sign in again.')),0);});
    await activate(await cloud.session());
    updateEmailButton();setInterval(updateEmailButton,1000);
    setInterval(()=>{if(document.visibilityState==='visible')refreshCloud();},15000);
    window.addEventListener('focus',()=>refreshCloud());
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshCloud();});
  }catch(error){setSyncStatus('Connection unavailable');$('authStatus').textContent=error.message;}
}
initialise();
