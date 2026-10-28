const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const handlers={},entries=new Map(),origin='https://example.invalid',scope=origin+'/nourish/';let offline=false;
const key=input=>new URL(typeof input==='string'?input:input.url,scope).href;
const cache={addAll:async urls=>{for(const url of urls){const pathname=new URL(url,scope).pathname.slice('/nourish/'.length)||'index.html';assert.ok(fs.existsSync(__dirname+'/dist/'+pathname));entries.set(key(url),new Response(fs.readFileSync(__dirname+'/dist/'+pathname)));}},match:async input=>entries.get(key(input))?.clone(),put:async(input,response)=>{entries.set(key(input),response);}};
const context={URL,Error,Promise,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:async request=>{if(offline)throw Error('Offline');return new Response('network');},self:{location:{origin},registration:{scope},clients:{claim:async()=>{}},addEventListener:(name,fn)=>handlers[name]=fn}};
vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/dist/sw.js','utf8'),context);
async function main(){
 let promise;handlers.install({waitUntil:p=>promise=p});await promise;assert.ok(entries.has(scope+'index.html'));assert.ok([...entries.keys()].some(url=>url.includes('offline.js?v=')));
 offline=true;let responsePromise;const event={request:{url:scope,method:'GET',mode:'navigate'},respondWith:p=>responsePromise=p,waitUntil(){}};handlers.fetch(event);const html=await(await responsePromise).text();assert.match(html,/offline.js\?v=/);assert.match(html,/id="journal"/);
 const script=[...entries.keys()].find(url=>url.includes('app.js?v='));handlers.fetch({...event,request:{url:script,method:'GET',mode:'cors'}});assert.match(await(await responsePromise).text(),/checkLocalDate/);
 responsePromise=null;handlers.fetch({...event,request:{url:'https://private.supabase.co/rest/v1/nourish_journals',method:'GET'}});assert.equal(responsePromise,null);
 handlers.fetch({...event,request:{url:scope+'anything',method:'POST'}});assert.equal(responsePromise,null);
 console.log('Passed: complete offline shell assets, offline navigation and versioned scripts, exclusion of private API requests and writes.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
