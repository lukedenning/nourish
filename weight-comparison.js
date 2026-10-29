'use strict';
// Independent, labelled scales share a real date axis; missing records are never zero-filled.
function weightCalorieChartMarkup(weights,calories,start,end){
  const ws=weights.filter(w=>w.date>=start&&w.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
  const cs=calories.filter(c=>c.date>=start&&c.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
  if(!cs.length)return weightChartMarkup(ws,start,end);
  const dates=[...ws,...cs].map(point=>point.date).sort(),first=dates[0],last=dates.at(-1);
  const width=700,height=280,left=66,right=72,top=30,bottom=42,plotWidth=width-left-right,plotHeight=height-top-bottom;
  const day=date=>Date.parse(date+'T12:00:00Z')/86400000;
  const x=date=>left+(first===last?.5:(day(date)-day(first))/(day(last)-day(first)))*plotWidth;
  function scale(values,padding){const min=Math.min(...values),max=Math.max(...values),extra=Math.max((max-min)*.15,padding);return {low:Math.max(0,min-extra),high:max+extra};}
  const weightScale=ws.length?scale(ws.map(w=>w.kg*LB),1):{low:0,high:1};
  const calorieScale=scale(cs.map(c=>c.calories),100);
  const y=(value,scale)=>top+(scale.high-value)/(scale.high-scale.low)*plotHeight;
  const ticks=Array.from({length:5},(_,index)=>{
    const fraction=index/4,yy=top+plotHeight*(1-fraction),lbs=weightScale.low+(weightScale.high-weightScale.low)*fraction,kcal=calorieScale.low+(calorieScale.high-calorieScale.low)*fraction;
    return `<line x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}" class="weightGrid"/>${ws.length?`<text class="weightAxisLabel" x="${left-9}" y="${yy+4}" text-anchor="end">${fmt(lbs)}</text>`:''}<text class="calorieAxisLabel" x="${width-right+9}" y="${yy+4}">${fmt(kcal)}</text>`;
  }).join('');
  const labels=[first,...(day(last)-day(first)>3?[new Date((day(first)+Math.floor((day(last)-day(first))/2))*86400000).toISOString().slice(0,10)]:[]),last].filter((date,index,all)=>all.indexOf(date)===index);
  const dateLabels=labels.map(date=>`<text x="${x(date)}" y="${height-13}" text-anchor="middle">${esc(new Date(date+'T12:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short'}))}</text>`).join('');
  const path=(points,value,scale)=>points.map((point,index)=>`${index?'L':'M'} ${x(point.date)} ${y(value(point),scale)}`).join(' ');
  const weightLine=ws.length?`<path class="weightLine" d="${path(ws,w=>w.kg*LB,weightScale)}"/>${ws.map(w=>`<circle class="weightDot" cx="${x(w.date)}" cy="${y(w.kg*LB,weightScale)}" r="4"><title>${w.date}: ${weightText(w.kg)}</title></circle>`).join('')}`:'';
  const calorieLine=`<path class="calorieLine" d="${path(cs,c=>c.calories,calorieScale)}"/>${cs.map(c=>`<circle class="calorieDot" cx="${x(c.date)}" cy="${y(c.calories,calorieScale)}" r="3"><title>${c.date}: ${fmt(c.calories)} kcal</title></circle>`).join('')}`;
  return `<svg class="weightSvg comparisonSvg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="comparisonTitle comparisonDesc"><title id="comparisonTitle">Weight and calories from ${first} to ${last}</title><desc id="comparisonDesc">${ws.length} weigh-ins and ${cs.length} days with logged food. Orange weight uses the left pounds scale; green calories use the right kcal scale. Independent scales show trends, not equivalent amounts. Dates align; lines connect recorded days without treating missing days as zero. Empty dates at the range edges are trimmed. Exact values are available in the table.</desc><text class="weightAxisLabel" x="${left-9}" y="14" text-anchor="end">lbs</text><text class="calorieAxisLabel" x="${width-right+9}" y="14">kcal</text>${ticks}${dateLabels}${calorieLine}${weightLine}</svg>`;
}
