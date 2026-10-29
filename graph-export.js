'use strict';
// Standalone SVG includes its own colours, title, legend and scale explanation before PNG rendering.
function weightGraphImageSvg(svg,options){
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const metrics=[{label:'Weight · lbs',color:'#ff9b3d'},...options.legend];
  const rows=Math.ceil(metrics.length/3),header=58+rows*22,chartHeight=options.chartHeight||280;
  const legend=metrics.map((metric,index)=>`<text x="${24+index%3*225}" y="${56+Math.floor(index/3)*22}" fill="${metric.color}" style="fill:${metric.color};font-size:11px">● ${escape(metric.label)}</text>`).join('');
  const chart=svg.replace(/<svg\b/,'<svg x="0" y="'+header+'" width="700" height="'+chartHeight+'"');
  const note=options.normalized?'Nutrition: each line uses its own 0–100% range; constant values sit at 50%.':'Independent scales; compare trends, not equivalent amounts.';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="${(header+chartHeight+50)*2}" viewBox="0 0 700 ${header+chartHeight+50}"><style>text{font:12px system-ui,sans-serif;fill:#c4b2d2}.weightGrid{stroke:#493456;stroke-width:1}.weightLine{fill:none;stroke:#ff9b3d;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.weightDot{fill:#ff9b3d;stroke:#ff9b3d;stroke-width:2}.calorieLine{fill:none;stroke:#60d394;stroke-width:2.5}.calorieDot{fill:#60d394;stroke:#251a30;stroke-width:1}.weightAxisLabel{fill:#ff9b3d}.calorieAxisLabel{fill:#60d394}</style><rect width="100%" height="100%" fill="#251a30"/><text x="24" y="25" style="fill:#e7eee6;font-size:17px;font-weight:700">Nourish · Weight over time</text><text x="676" y="25" text-anchor="end">${escape(options.start)} – ${escape(options.end)}</text>${legend}${chart}<text x="24" y="${header+chartHeight+23}" style="font-size:11px">${escape(note)}</text><text x="24" y="${header+chartHeight+40}" style="font-size:10px">Dates align. Lines connect logged records; missing days are not zero.</text></svg>`;
}
async function downloadWeightGraphImage(options){
  const element=document.getElementById('weightChart').querySelector('svg');
  if(!element)throw Error('Add records or select a nutrition line before downloading.');
  const clone=element.cloneNode(true);clone.removeAttribute('width');clone.removeAttribute('height');clone.removeAttribute('style');
  const height=Number(clone.getAttribute('viewBox').split(/\s+/)[3]);
  const svg=weightGraphImageSvg(new XMLSerializer().serializeToString(clone),{...options,chartHeight:height});
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('The graph image could not be prepared.'));image.src=url;});
    const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');if(!context)throw Error('Image downloads are unavailable in this browser.');context.drawImage(image,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('The graph image could not be created.');
    const downloadUrl=URL.createObjectURL(blob),link=document.createElement('a');link.href=downloadUrl;link.download=`nourish-weight-${options.start}-to-${options.end}.png`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(downloadUrl),60000);
  }finally{URL.revokeObjectURL(url);}
}
