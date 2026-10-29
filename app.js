'use strict';
const $=id=>document.getElementById(id), KEY='nourish-journal-v1', LB=2.2046226218;
const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmt=n=>new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(new Date(s+'T12:00:00'))&&localDate(new Date(s+'T12:00:00'))===s;
const MACROS=[['carbs','Carbs'],['sugars','Sugars'],['fats','Fats'],['saturates','Saturates'],['fiber','Fiber'],['salt','Salt']];
const nutrition=x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&x.title.trim().length>0&&x.title.length<=100&&typeof x.portion==='string'&&x.portion.length<=60&&Number.isFinite(x.calories)&&x.calories>=0&&x.calories<=100000&&Number.isFinite(x.protein)&&x.protein>=0&&x.protein<=10000&&MACROS.every(([k])=>x[k]===undefined||(Number.isFinite(x[k])&&x[k]>=0&&x[k]<=10000));
function validate(s){if(!s||s.version!==1||!Array.isArray(s.foods)||!Array.isArray(s.favourites)||!Array.isArray(s.weights)||!s.foods.every(x=>nutrition(x)&&validDate(x.date))||!s.favourites.every(nutrition)||!s.weights.every(x=>validDate(x.date)&&Number.isFinite(x.kg)&&x.kg>0&&x.kg<=2000))throw Error('Invalid journal backup');for(const rows of [s.foods,s.favourites])if(new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('Duplicate entry IDs');if(new Set(s.weights.map(x=>x.date)).size!==s.weights.length)throw Error('Duplicate weigh-in dates');if(s.notes!==undefined&&(s.notes===null||typeof s.notes!=='object'||Array.isArray(s.notes)||!Object.entries(s.notes).every(([date,text])=>validDate(date)&&typeof text==='string'&&text.length<=5000)))throw Error('Invalid daily notes');return s;}
const emptyJournal=()=>({version:1,foods:[],favourites:[],weights:[],notes:{}});
let state=emptyJournal(),view='day',cloud=null,loaded=false,busy=false,epoch=0,unsaved=null;
const TREND_MACROS=[['protein','Protein'],['carbs','Carbs'],['fats','Fats'],['saturates','Saturates'],['fiber','Fiber'],['salt','Salt'],['calories','Calories']];
let trendMacroIndex=0,trendRange=null,trendRangeDraft=false,selectedTrendDay=null;
let cloudSynced=false;
let emailRetryAt=0,emailInFlight=false,passwordInFlight=false;
let weightDirty=false,lastWeightUnit='lb',notesDirty=false;
function deviceToday(){try{const date=new Date();return Number.isFinite(date.getTime())?localDate(date):null;}catch{return null;}}
let followsToday=true,lastDeviceDay=deviceToday();
$('date').value=lastDeviceDay||'';
let activeJournalDate=$('date').value;
let customRange=lastDeviceDay?bounds(activeJournalDate,'month'):['',''];
$('rangeStart').value=customRange[0];$('rangeEnd').value=customRange[1];
const id=()=>crypto.randomUUID();
function journalAccess(){
  $('journal').inert=!cloud?.user||!loaded||busy;
  $('export').disabled=!loaded;
  $('import').disabled=!loaded||busy;
  $('refreshCloud').disabled=busy;
  $('signOut').disabled=busy;
  $('syncNow').disabled=busy;
  updateSyncButton();
}
function setBusy(value){busy=value;journalAccess();}
function notify(message){$('status').textContent=message;}
function setSyncStatus(message){
  $('syncStatus').textContent=message;
  cloudSynced=message==='Saved to cloud';
  updateSyncButton();
}

function updateSyncButton(){
  const synced=Boolean(cloud?.user&&loaded&&cloudSynced&&!busy&&!unsaved&&!dirty());
  $('syncNow').textContent=synced?'Synced':'Sync now';
  $('syncNow').dataset.synced=String(synced);
  $('syncNow').title=synced?'Saved to cloud and available on all your devices':'Sync saved entries with your other devices';
  $('syncNow').setAttribute('aria-label',synced?'Synced: saved to cloud and available on all your devices':'Sync now');
}
function dirty(){return Boolean($('title').value||weightDirty||notesDirty||$('editId').value||MACROS.some(([key])=>$(key).value));}
async function refreshCloud(manual=false){
  if(!cloud?.user||busy||(!manual&&dirty()&&!cloud.cache?.pending))return false;
  setBusy(true);const generation=epoch;
  if(manual)setSyncStatus('Syncing saved entries…');
  try{
    const row=await cloud.load();
    if(generation!==epoch)return false;
    validate(row.document);
    if(!Number.isSafeInteger(row.revision)||row.revision<0)throw Error('Invalid cloud revision');
    const changed=cloud.revision!==row.revision;
    cloud.accept(row);state=row.document;loaded=true;render();
    setSyncStatus(row.offlineConflict?'Saved on this device · Sync conflict':row.pending?'Saved on this device · Waiting to sync':row.cacheWarning||'Saved to cloud');
    $('resolveOffline').hidden=!row.offlineConflict;
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
    validate(next);const saved=await cloud.save(next);
    if(generation!==epoch)return false;
    state=saved?.document||next;render();
    $('resolveOffline').hidden=!saved?.offlineConflict;
    setSyncStatus(saved?.offlineConflict?'Saved on this device · Sync conflict':saved?.pending?'Saved on this device · Waiting to sync':saved?.cacheWarning||'Saved to cloud');
    notify(message+(saved?.pending?' Saved on this device; it will sync when connected.':' Saved to your account.'));return true;
  }catch(error){
    if(generation!==epoch)return false;
    unsaved=next;
    if(error.localStorage){setSyncStatus('Not saved · Device storage unavailable');notify(error.message);return false;}
    if(error.conflict){
      try{const row=await cloud.load();if(generation!==epoch)return false;validate(row.document);cloud.accept(row);state=row.document;render();setSyncStatus('Latest cloud version loaded');}
      catch{ setSyncStatus('Refresh required'); }
      notify('Another device changed your journal. This change was not saved. Review the latest entries and try again; your form entries are still here. You can export the unsaved version.');
    }else{setSyncStatus('Not saved');notify('Could not save to the cloud. Check your connection and try again. Your form entries are still here.');}
    return false;
  }finally{if(generation===epoch)setBusy(false);}
}
function bounds(date,mode){if(mode==='custom')return [...customRange];let start=new Date(date+'T12:00:00'),end=new Date(start);if(mode==='week'){start.setDate(start.getDate()-((start.getDay()+6)%7));end=new Date(start);end.setDate(end.getDate()+6);}if(mode==='month'){start.setDate(1);end=new Date(start.getFullYear(),start.getMonth()+1,0,12);}return [localDate(start),localDate(end)];}
function daysBetween(a,b){const days=[];let d=new Date(a+'T12:00:00');while(localDate(d)<=b){days.push(localDate(d));d.setDate(d.getDate()+1);}return days;}
function syncNoteForm(){
  const date=$('date').value;
  $('notesDate').textContent=date;
  $('dayNotes').value=state.notes?.[date]||'';
  $('noteCount').textContent=fmt($('dayNotes').value.length)+' / 5,000';
  $('noteStatus').textContent=state.notes?.[date]?'Saved for '+date+'.':'No note saved for this day.';updateSyncButton();
}
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
  updateWeightPreview();updateSyncButton();
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

let calendarMonth='';
function updateDateDisplay(){
  $('journalDateControls').hidden=view==='custom';
  const date=$('date').value,weekly=view==='week',monthly=view==='month';
  const shortDate=value=>value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(2,4);
  $('openJournalCalendar').textContent=validDate(date)?weekly?bounds(date,'week').map(shortDate).join(' - '):monthly?new Date(date+'T12:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'}):['Sun','Mon','Tues','Wed','Thurs','Fri','Sat'][new Date(date+'T12:00:00').getDay()]+' '+Number(date.slice(8,10))+' '+new Date(date+'T12:00:00').toLocaleDateString('en-GB',{month:'short'}):'Choose date';
  $('openJournalCalendar').dataset.week=String(weekly);
  $('journalDateControls').dataset.view=view;
  $('openJournalCalendar').setAttribute('aria-label',weekly?'Choose journal week: '+$('openJournalCalendar').textContent:monthly?'Choose journal month: '+$('openJournalCalendar').textContent:'Choose journal date');
  for(const [key,label] of [['previousDay','Previous'],['nextDay','Next']]){const text=label+(weekly?' week':monthly?' month':' day');$(key).title=text;$(key).setAttribute('aria-label',text);}
}

function renderJournalCalendar(){
  const first=calendarMonth+'-01';
  if(!validDate(first)){$('calendarTitle').textContent='Choose a month';$('calendarDays').innerHTML='';return;}
  const month=new Date(first+'T12:00:00'),end=new Date(month);end.setMonth(end.getMonth()+1);end.setDate(0);
  $('calendarTitle').textContent=month.toLocaleDateString(undefined,{month:'long',year:'numeric'});$('calendarMonth').value=calendarMonth;
  const offset=(month.getDay()+6)%7,today=deviceToday();
  $('calendarDays').innerHTML='<span aria-hidden="true"></span>'.repeat(offset)+Array.from({length:end.getDate()},(_,index)=>{
    const date=calendarMonth+'-'+String(index+1).padStart(2,'0'),hasNote=Boolean(state.notes?.[date]);
    const label=new Date(date+'T12:00:00').toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'});
    return `<button class="calendarDay" type="button" data-calendar-day="${date}" data-note="${hasNote}" aria-label="${esc(label)}${hasNote?' · Note saved':''}" aria-pressed="${date===$('date').value}"${date===today?' aria-current="date"':''}>${index+1}${hasNote?'<span class="noteDot" aria-hidden="true">●</span>':''}</button>`;
  }).join('');
}
$('openJournalCalendar').onclick=()=>{calendarMonth=(validDate($('date').value)?$('date').value:deviceToday()||'').slice(0,7);renderJournalCalendar();$('journalCalendar').showModal();};
$('closeJournalCalendar').onclick=()=>$('journalCalendar').close();
$('journalCalendar').addEventListener('click',event=>{
  if(event.target!==$('journalCalendar'))return;
  const bounds=$('journalCalendar').getBoundingClientRect();
  if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)$('journalCalendar').close();
});
function moveCalendarMonth(offset){
  if(!validDate(calendarMonth+'-01'))return;
  const month=new Date(calendarMonth+'-01T12:00:00');month.setMonth(month.getMonth()+offset);
  const next=localDate(month);if(!validDate(next))return;calendarMonth=next.slice(0,7);renderJournalCalendar();
}
$('calendarPrevious').onclick=()=>moveCalendarMonth(-1);$('calendarNext').onclick=()=>moveCalendarMonth(1);
$('calendarMonth').onchange=()=>{if(validDate($('calendarMonth').value+'-01')){calendarMonth=$('calendarMonth').value;renderJournalCalendar();}};

function renderFavourites(){
  const query=$('regularSearch').value.trim().toLocaleLowerCase();
  const regulars=state.favourites.filter(f=>f.title.toLocaleLowerCase().includes(query));
  $('favourites').innerHTML=regulars.length?regulars.map(f=>`<div class="fav"><div class="details"><b>${esc(f.title)}</b><small>${esc(f.portion||'1 portion')} · ${fmt(f.calories)} kcal · ${fmt(f.protein)} g</small></div><button data-quick="${esc(f.id)}" aria-label="Add ${esc(f.title)}">+</button><button class="icon" data-edit-regular="${esc(f.id)}" aria-label="Edit regular ${esc(f.title)}">Edit</button><button class="icon" data-unfav="${esc(f.id)}" aria-label="Remove favourite ${esc(f.title)}">×</button></div>`).join(''):state.favourites.length?'<p class="empty">No regular foods match your search.</p>':'<p class="empty">Save a food as a regular to find it here.</p>';
}
$('regularSearch').oninput=renderFavourites;

function render(){updateDateDisplay();if($('journalCalendar').open)renderJournalCalendar();const date=$('date').value;if(!validDate(date))return;const [start,end]=bounds(date,view),foods=state.foods.filter(f=>f.date>=start&&f.date<=end),weights=state.weights.filter(w=>w.date>=start&&w.date<=end).sort((a,b)=>a.date.localeCompare(b.date));const calories=foods.reduce((s,f)=>s+f.calories,0),protein=foods.reduce((s,f)=>s+f.protein,0),logged=new Set(foods.map(f=>f.date)).size;const latest=state.weights.filter(w=>w.date<=end).sort((a,b)=>b.date.localeCompare(a.date))[0];const changeStart=view==='day'?localDate(new Date(new Date(date+'T12:00:00').setDate(new Date(date+'T12:00:00').getDate()-29))):start;const changeWeights=state.weights.filter(w=>w.date>=changeStart&&w.date<=end).sort((a,b)=>a.date.localeCompare(b.date));const change=changeWeights.length>1?changeWeights.at(-1).kg-changeWeights[0].kg:null;
$('stats').innerHTML=[['Calories',fmt(calories),view==='day'?'kcal today':`kcal total · ${fmt(logged?calories/logged:0)} / logged day`],['Protein',fmt(protein)+' g',view==='day'?'protein today':`${fmt(logged?protein/logged:0)} g / logged day`],['Latest weight',latest?fmt(latest.kg*LB)+' lbs':'—',latest?`${fmt(latest.kg)} kg · ${latest.date}`:'Add your first weigh-in'],['Weight change',change===null?'—':(change>0?'+':'')+fmt(change*LB)+' lbs',change===null?'Needs two weigh-ins in the graph period':`${change>0?'+':''}${fmt(change)} kg · ${view==='day'?'last 30 days':'first to last'}`]].map(([label,value,note])=>`<div class="stat">${label==='Protein'?`<details class="macroTotals"><summary><span>${label}</span><strong>${value}</strong><small>${note} · expand</small></summary><div class="macroTotalsGrid">${MACROS.map(([key,label])=>`<p><span>${label}</span><b>${fmt(foods.reduce((sum,food)=>sum+(food[key]||0),0))} g</b></p>`).join('')}</div></details>`:`<label>${label}</label><strong>${value}</strong><small>${note}</small>`}</div>`).join('');
$('period').textContent=start===end?start:`${start} – ${end}`;
$('rangeForm').hidden=view!=='custom';

$('foodList').innerHTML=foods.length?foods.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(f=>`<div class="foodRow"><div class="details"><b>${esc(f.title)}</b><small>${esc(f.portion||'1 portion')}${view!=='day'?' · '+f.date:''}</small></div><div class="nutrients">${fmt(f.calories)} kcal<small>${fmt(f.protein)} g protein</small></div><button class="icon" data-edit="${esc(f.id)}" aria-label="Edit ${esc(f.title)}">Edit</button><button class="icon" data-delete="${esc(f.id)}" aria-label="Delete ${esc(f.title)}">×</button></div>`).join(''):'<p class="empty">Your journal is ready. Add your first food above.</p>';
renderFavourites();
const current=state.weights.find(w=>w.date===date);$('weightInfo').textContent=current?weightText(current.kg):'No weigh-in for this date.';$('deleteWeight').hidden=!current;
$('weighDate').textContent='For '+date;$('weightSubmit').textContent=current?'Update weigh-in':'Save weigh-in';
if(!weightDirty)syncWeightForm();if(!notesDirty)syncNoteForm();renderWeightChart();
const [trendStart,trendEnd]=trendRange||(view==='day'?[localDate(new Date(new Date(date+'T12:00:00').setDate(new Date(date+'T12:00:00').getDate()-6))),date]:[start,end]);
if(selectedTrendDay&&(selectedTrendDay<trendStart||selectedTrendDay>trendEnd))selectedTrendDay=null;
const chartDays=daysBetween(trendStart,trendEnd),[macroKey,macroLabel]=TREND_MACROS[trendMacroIndex];
const macroUnit=macroKey==='calories'?'kcal':'g';
$('trendUnitHint').textContent=(macroKey==='calories'?'Daily kcal':'Daily grams')+' · tap the nutrient to cycle';
if(!trendRangeDraft){$('trendStart').value=trendStart;$('trendEnd').value=trendEnd;}$('trendPeriod').textContent=`${trendStart} – ${trendEnd}`;
for(const key of ['cycleTrendMacro','cycleTableMacro']){$(key).textContent=macroLabel;$(key).setAttribute('aria-label',macroLabel+'. Show next nutrient');}
const dayFoods=new Map(chartDays.map(day=>[day,[]]));for(const food of state.foods)dayFoods.get(food.date)?.push(food);
const totals=chartDays.map(day=>({date:day,value:dayFoods.get(day).reduce((sum,food)=>sum+(food[macroKey]||0),0)})),max=Math.max(1,...totals.map(t=>t.value));
$('chart').innerHTML=`<div class="chart selectableChart" role="group" aria-label="Daily ${macroLabel.toLowerCase()} totals in ${macroUnit}; choose a day to filter the table" style="min-width:${Math.max(280,chartDays.length*26)}px">${totals.map((t,i)=>`<button class="trendDay" type="button" data-trend-day="${t.date}" aria-pressed="${selectedTrendDay===t.date}" aria-label="${t.date}: ${fmt(t.value)} ${macroUnit} ${macroLabel.toLowerCase()}. Show this day" title="${t.date}: ${fmt(t.value)} ${macroUnit} ${macroLabel.toLowerCase()}"><span class="bar" style="height:${t.value/max*100}%"><span>${chartDays.length<10||i%Math.max(5,Math.ceil(chartDays.length/8))===0?Number(t.date.slice(-2)):''}</span></span></button>`).join('')}</div>`;
$('trendDayStatus').textContent=selectedTrendDay?'Showing '+selectedTrendDay+' in the table.':'Select a day on the graph to see its values below.';
$('showAllTrendDays').hidden=!selectedTrendDay;
$('history').innerHTML=(selectedTrendDay?[selectedTrendDay]:chartDays.slice().reverse()).map(day=>{const foods=dayFoods.get(day),weight=state.weights.find(w=>w.date===day);return `<tr><td>${day}</td><td>${foods.length?fmt(foods.reduce((sum,food)=>sum+food.calories,0)):'—'}</td><td>${foods.length?fmt(foods.reduce((sum,food)=>sum+(food[macroKey]||0),0))+' '+macroUnit:'—'}</td><td>${weight?weightText(weight.kg):'—'}</td></tr>`;}).join('');}
function cycleTrendMacro(){trendMacroIndex=(trendMacroIndex+1)%TREND_MACROS.length;render();}
$('cycleTrendMacro').onclick=cycleTrendMacro;$('cycleTableMacro').onclick=cycleTrendMacro;
function shiftTrendRange(direction){
  const start=$('trendStart').value,end=$('trendEnd').value;
  if(!validDate(start)||!validDate(end)||start>end){$('trendRangeStatus').textContent='Choose valid dates before moving the range.';return;}
  const day=86400000,first=Date.parse(start+'T12:00:00Z'),last=Date.parse(end+'T12:00:00Z'),count=Math.round((last-first)/day)+1;
  if(count>3661){$('trendRangeStatus').textContent='Choose a range of up to 10 years.';return;}
  const nextStart=new Date(first+direction*count*day).toISOString().slice(0,10),nextEnd=new Date(last+direction*count*day).toISOString().slice(0,10);
  if(!validDate(nextStart)||!validDate(nextEnd))return;
  trendRange=[nextStart,nextEnd];trendRangeDraft=false;selectedTrendDay=null;$('trendRangeStatus').textContent='Moved by '+count+' '+(count===1?'day.':'days.');render();
}
$('previousTrendRange').onclick=()=>shiftTrendRange(-1);$('nextTrendRange').onclick=()=>shiftTrendRange(1);
$('showAllTrendDays').onclick=()=>{selectedTrendDay=null;render();};
$('trendStart').oninput=$('trendEnd').oninput=()=>{trendRangeDraft=true;};
$('trendRangeForm').onsubmit=e=>{
  e.preventDefault();const start=$('trendStart').value,end=$('trendEnd').value;
  if(!validDate(start)||!validDate(end)||start>end){$('trendRangeStatus').textContent='Choose valid dates with From on or before To.';return;}
  if((Date.parse(end+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000>3660){$('trendRangeStatus').textContent='Choose a range of up to 10 years.';return;}
  selectedTrendDay=null;trendRangeDraft=false;trendRange=[start,end];$('trendRangeStatus').textContent='Showing the selected dates, inclusive.';render();
};
$('resetTrendRange').onclick=()=>{selectedTrendDay=null;trendRangeDraft=false;trendRange=null;$('trendRangeStatus').textContent='Following the selected view.';render();};

function calculatePortion(){
  const per100=$('per100').value,portion=$('calcPortion').value;
  const value=Number(per100)/100*Number(portion);
  $('calcResult').value=per100.trim()!==''&&portion.trim()!==''&&Number(per100)>=0&&Number(portion)>=0&&Number.isFinite(value)?String(Number(value.toFixed(6))):'';
}
$('per100').oninput=calculatePortion;
$('calcPortion').oninput=calculatePortion;
function convertCalculatorWeight(source){
  const fields={convertLbs:1,convertKg:LB,convertStone:14};
  const input=$(source).value,pounds=Number(input)*fields[source];
  for(const [key,factor] of Object.entries(fields)){
    if(key===source)continue;
    $(key).value=input.trim()!==''&&Number(input)>=0&&Number.isFinite(pounds)?String(Number((pounds/factor).toFixed(6))):'';
  }
}
for(const key of ['convertLbs','convertKg','convertStone'])$(key).oninput=()=>convertCalculatorWeight(key);


$('foodForm').onsubmit=async e=>{
  e.preventDefault();if(busy||!validDate($('date').value))return;
  const regularId=$('editRegularId').value;
  const edit=$('editId').value,old=state.foods.find(f=>f.id===edit);
  if(regularId&&!state.favourites.some(f=>f.id===regularId)){notify('This regular was removed on another device. Cancel the edit to add it again.');return;}
  if(edit&&!old){notify('This food was removed on another device. Cancel the edit to add it again.');return;}
  const food={id:edit||id(),date:old?old.date:$('date').value,title:$('title').value.trim(),portion:$('portion').value.trim(),calories:Number($('calories').value),protein:$('protein').value.trim()===''?0:Number($('protein').value),...Object.fromEntries(MACROS.map(([key])=>[key,Number($(key).value)]))};
  if(!nutrition(food))return;const next=structuredClone(state);
  if(regularId){const {date,...regular}=food;regular.id=regularId;next.favourites=next.favourites.map(f=>f.id===regularId?regular:f);if(await save(next,'Regular food updated.'))resetFood();return;}
  if(edit)next.foods=next.foods.map(f=>f.id===edit?food:f);else next.foods.push(food);
  if($('saveFav').checked){const {date,...fav}=food;fav.id=id();next.favourites.push(fav);}
  if(await save(next,edit?'Food updated.':'Food added.'))resetFood();
};
function resetFood(){$('foodForm').reset();for(const [key] of MACROS)$(key).value='';$('foodMacros').open=false;$('editId').value='';$('editRegularId').value='';$('saveFav').disabled=false;$('addFood').textContent='Add food';$('cancelEdit').hidden=true;updateSyncButton();}
$('cancelEdit').onclick=resetFood;
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||busy)return;
  if(b.dataset.calendarDay){if(!validDate(b.dataset.calendarDay))return;$('date').value=b.dataset.calendarDay;$('date').onchange();if($('date').value===b.dataset.calendarDay)$('journalCalendar').close();else renderJournalCalendar();return;}
  if(b.dataset.trendDay){if(!validDate(b.dataset.trendDay))return;selectedTrendDay=b.dataset.trendDay;render();return;}
  if(b.dataset.view){selectedTrendDay=null;trendRangeDraft=false;trendRange=null;view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();return;}
  if(!loaded)return;
  const next=structuredClone(state);
  if(b.dataset.quick){const f=state.favourites.find(f=>f.id===b.dataset.quick);if(!f||!validDate($('date').value))return;next.foods.push({...f,id:id(),date:$('date').value});await save(next,'Usual portion added.');}
  if(b.dataset.unfav){next.favourites=next.favourites.filter(f=>f.id!==b.dataset.unfav);await save(next,'Regular food removed.');}
  if(b.dataset.delete){next.foods=next.foods.filter(f=>f.id!==b.dataset.delete);if(await save(next,'Food removed.')&&$('editId').value===b.dataset.delete)resetFood();}
  if(b.dataset.editRegular){const f=state.favourites.find(f=>f.id===b.dataset.editRegular);if(!f)return;resetFood();$('editRegularId').value=f.id;for(const key of ['title','portion','calories','protein',...MACROS.map(([key])=>key)])$(key).value=String(f[key]??'');$('saveFav').checked=false;$('saveFav').disabled=true;$('addFood').textContent='Save regular';$('cancelEdit').hidden=false;$('foodEntry').open=true;$('title').focus();notify('Editing your saved regular. Existing food entries will keep their recorded values.');}
  if(b.dataset.edit){const f=state.foods.find(f=>f.id===b.dataset.edit);if(!f)return;resetFood();$('editId').value=f.id;for(const k of ['title','portion','calories','protein',...MACROS.map(([key])=>key)])$(k).value=String(f[k]??'');$('foodMacros').open=false;$('addFood').textContent='Save changes';$('cancelEdit').hidden=false;$('foodEntry').open=true;$('title').focus();}
});

$('protein').onclick=()=>{$('foodMacros').open=true;};
$('rangeForm').onsubmit=e=>{
  e.preventDefault();const start=$('rangeStart').value,end=$('rangeEnd').value;
  if(!validDate(start)||!validDate(end)||start>end){$('rangeStatus').textContent='Choose valid dates with From on or before To.';return;}
  if((Date.parse(end+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000>3660){$('rangeStatus').textContent='Choose a range of up to 10 years.';return;}
  customRange=[start,end];$('rangeStatus').textContent='Showing '+start+' to '+end+' (inclusive).';render();
};
$('date').onchange=()=>{
  if(!validDate($('date').value))return;
  if(notesDirty&&!confirm('Discard your unsaved note before switching dates?')){$('date').value=activeJournalDate;return;}
  followsToday=$('date').value===deviceToday();$('followToday').hidden=followsToday;
  trendRangeDraft=false;trendRange=null;activeJournalDate=$('date').value;notesDirty=false;resetFood();weightDirty=false;$('weightForm').reset();render();
};
function moveJournalDay(offset){
  const day=new Date((validDate($('date').value)?$('date').value:activeJournalDate)+'T12:00:00');
  if(view==='month'){
    const originalDay=day.getDate();day.setDate(1);day.setMonth(day.getMonth()+offset);
    const end=new Date(day);end.setMonth(end.getMonth()+1);end.setDate(0);day.setDate(Math.min(originalDay,end.getDate()));
  }else day.setDate(day.getDate()+offset*(view==='week'?7:1));
  const next=localDate(day);if(!validDate(next))return;
  $('date').value=next;$('date').onchange();
}
$('previousDay').onclick=()=>moveJournalDay(-1);
$('nextDay').onclick=()=>moveJournalDay(1);
$('dayNotes').oninput=()=>{
  notesDirty=true;$('noteCount').textContent=fmt($('dayNotes').value.length)+' / 5,000';$('noteStatus').textContent='Unsaved changes. Select Save notes to sync them.';
};
$('notesForm').onsubmit=async e=>{
  e.preventDefault();if(busy||!validDate($('date').value))return;
  const date=$('date').value,text=$('dayNotes').value;
  if(text.length>5000){$('noteStatus').textContent='Keep your note within 5,000 characters.';return;}
  const next=structuredClone(state);next.notes={...(next.notes||{})};
  if(text)next.notes[date]=text;else delete next.notes[date];
  if(await save(next,'Daily notes saved.')){notesDirty=false;syncNoteForm();$('noteStatus').textContent=text?'Saved for '+date+'.':'Note cleared for '+date+'.';}
  else $('noteStatus').textContent='Your note was not saved. Your draft is still here; check the sync message and try again.';
};
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
  next.notes={...(local.notes||{}),...(remote.notes||{})};
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
  epoch++;busy=false;loaded=false;unsaved=null;cloud.setUser(user);$('regularSearch').value='';
  state=emptyJournal();resetFood();notesDirty=false;activeJournalDate=$('date').value;weightDirty=false;$('weightForm').reset();render();journalAccess();
  $('signedOut').hidden=Boolean(user);$('signedIn').hidden=!user;
  $('accountEmail').textContent=user?.email||'';
  $('authStatus').textContent='';$('passwordStatus').textContent='';
  for(const key of ['loginPassword','newPassword','confirmPassword'])$(key).value='';
  $('passwordSetup').open=false;$('resolveOffline').hidden=true;notify('');
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
    if(cloud.cache?.pending){notify(cloud.cache.conflicts?.length?'Saved locally. Review the sync conflict below before syncing.':'Saved on this device. Sync will retry when connected.');return;}
    if(hasUnsaved)notify('Latest saved entries loaded. Your previous change has not been saved; review it and try saving again.');
    else if(hasDraft)notify('Saved entries are synced. Finish adding your food, saving your weigh-in or saving your notes to sync the form entries too.');
    else notify('All saved entries are synced. Open Nourish with the same account on your other devices.');
  }
}
document.addEventListener('input',updateSyncButton);
document.addEventListener('change',updateSyncButton);
$('syncNow').onclick=syncFromTop;
$('refreshCloud').onclick=syncFromTop;
function reloadPage(){
  if(busy){notify('Wait for your current save or sync to finish before refreshing.');return false;}
  if((dirty()||unsaved)&&!confirm('Reload the page and discard unsaved entries?'))return;
  location.reload();return true;
}
$('refreshPage').onclick=reloadPage;

let pullStart=null,pullReady=false;
function clearPull(){pullStart=null;pullReady=false;$('pullRefresh').hidden=true;}
document.addEventListener('touchstart',e=>{
  clearPull();
  if(e.touches.length!==1||window.scrollY>0||busy)return;
  if(e.target.closest('input,textarea,select,button,a,summary,form,dialog,#favourites,.dayFoods,.tableWrap,#chart'))return;
  pullStart={x:e.touches[0].clientX,y:e.touches[0].clientY};
},{passive:true});
document.addEventListener('touchmove',e=>{
  if(!pullStart)return;
  if(e.touches.length!==1||window.scrollY>0){clearPull();return;}
  const dy=e.touches[0].clientY-pullStart.y,dx=Math.abs(e.touches[0].clientX-pullStart.x);
  if(dx>Math.max(15,Math.abs(dy))||dy<0){clearPull();return;}
  if(!e.cancelable){clearPull();return;}
  e.preventDefault();if(dy<12)return;pullReady=dy>=90;
  $('pullRefresh').hidden=false;
  $('pullRefresh').textContent=pullReady?'↓ Release to refresh':'↓ Pull down to refresh';
},{passive:false});
document.addEventListener('touchend',()=>{const refresh=pullReady;clearPull();if(refresh)reloadPage();},{passive:true});
document.addEventListener('touchcancel',clearPull,{passive:true});
async function initialise(){
  journalAccess();render();
  try{
    const config=window.NOURISH_CONFIG;
    if(!window.supabase||!config?.url||!config?.publishableKey)throw Error('The cloud connection could not start. Reload the app to try again.');
    cloud=new (globalThis.OfflineJournalCloud||JournalCloud)(window.supabase.createClient(config.url,config.publishableKey),validate);
    cloud.client.auth.onAuthStateChange((event,session)=>{setTimeout(()=>activate(session).catch(()=>notify('Unable to load this account. Please sign in again.')),0);});
    await activate(await cloud.session());
    updateEmailButton();setInterval(updateEmailButton,1000);
    setInterval(()=>{if(document.visibilityState==='visible')refreshCloud();},15000);
    window.addEventListener('focus',()=>{checkLocalDate();refreshCloud();});
    window.addEventListener('online',()=>refreshCloud());
    setInterval(checkLocalDate,30000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){checkLocalDate();refreshCloud();}});
  }catch(error){setSyncStatus('Connection unavailable');$('authStatus').textContent=error.message;}
}
function checkLocalDate(){
  const today=deviceToday();if(!today)return;
  if(followsToday&&today!==lastDeviceDay&&!dirty()&&!busy){
    $('date').value=today;activeJournalDate=today;notesDirty=false;weightDirty=false;render();lastDeviceDay=today;
  }else if(!followsToday)lastDeviceDay=today;
}
$('followToday').onclick=()=>{const today=deviceToday();if(!today){notify('Device date unavailable. Choose your journal date manually.');return;}$('date').value=today;$('date').onchange();};
$('resolveOffline').onclick=async()=>{
  if(!cloud?.resolveOffline||busy)return;
  if(!confirm('The same entries changed on this device and in the cloud. Keep this device’s versions for conflicting entries? Other cloud changes will be preserved. Choose Cancel to keep both copies unchanged; export a backup before reviewing.'))return;
  setBusy(true);try{const row=await cloud.resolveOffline();state=validate(row.document);render();$('resolveOffline').hidden=!row.offlineConflict;setSyncStatus(row.pending?'Saved on this device · Waiting to sync':'Saved to cloud');notify(row.pending?'Still saved locally; sync will retry.':'Offline entries synced.');}catch(error){notify(error.message);}finally{setBusy(false);}
};
if(typeof navigator!=='undefined'&&navigator.serviceWorker){
  navigator.serviceWorker.register('sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{$('offlineReady').textContent='Offline access ready on this device. Saved changes sync when you reopen the app online.';}).catch(()=>{$('offlineReady').textContent='Offline page loading unavailable. Keep this page open to use it offline.';});
}
initialise();
