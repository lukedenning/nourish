'use strict';
// Three-way merge: independent edits and deletions merge; overlapping edits need review.
function mergeOfflineJournal(base,local,remote){
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),conflicts=[];
  const result=structuredClone(remote);
  function choose(b,l,r,label){
    if(equal(l,b))return r;
    if(equal(r,b)||equal(l,r))return l;
    conflicts.push(label);return l;
  }
  for(const [key,id] of [['foods','id'],['favourites','id'],['weights','date']]){
    const maps=[base,local,remote].map(doc=>new Map((doc[key]||[]).map(row=>[row[id],row])));
    result[key]=[];
    for(const value of new Set(maps.flatMap(map=>[...map.keys()]))){
      const row=choose(...maps.map(map=>map.get(value)),key+': '+value);
      if(row!==undefined)result[key].push(structuredClone(row));
    }
  }
  result.notes={};
  for(const date of new Set([base,local,remote].flatMap(doc=>Object.keys(doc.notes||{})))){
    const note=choose(base.notes?.[date],local.notes?.[date],remote.notes?.[date],'note: '+date);
    if(note!==undefined)result.notes[date]=note;
  }
  return {document:result,conflicts};
}
class OfflineJournalCloud extends JournalCloud {
  constructor(client,validateDocument,storage=localStorage){
    super(client);this.validateDocument=validateDocument;this.storage=storage;this.cache=null;this.cacheWarning='';
  }
  key(){return 'nourish-offline-v1-'+this.user.id;}
  read(){
    const raw=this.storage.getItem(this.key());if(!raw)return null;
    const cache=JSON.parse(raw);
    if(cache.userId!==this.user.id||!Number.isSafeInteger(cache.base?.revision)||cache.base.revision<0)throw Error('Invalid local journal');
    this.validateDocument(cache.document);this.validateDocument(cache.base.document);return cache;
  }
  write(cache,required=false){
    try{this.storage.setItem(this.key(),JSON.stringify(cache));this.cacheWarning='';}
    catch(error){this.cacheWarning='Local storage unavailable. ';if(required){const failure=Error('This device could not save locally. Free storage or allow site storage, then try again. Your draft is still here.');failure.localStorage=true;throw failure;}}
    this.cache=cache;
  }
  setUser(user){
    super.setUser(user);this.cache=null;
    if(user){
      try{this.cache=this.read();this.storage.setItem('nourish-offline-account',JSON.stringify({id:user.id,email:user.email}));}catch{this.cacheWarning='Could not read the local journal. ';}
    }else{try{this.storage.removeItem('nourish-offline-account');}catch{}}
  }
  async session(){
    let remembered=null;try{remembered=JSON.parse(this.storage.getItem('nourish-offline-account')||'null');}catch{}
    let session,error;
    try{session=await super.session();}catch(caught){error=caught;}
    if(!session?.user&&typeof navigator!=='undefined'&&navigator.onLine===false&&remembered?.id){
      this.setUser(remembered);if(this.cache)return {user:remembered};
    }
    if(error)throw error;return session;
  }
  async locked(fn){
    if(!this.user)throw Error('Sign in before accessing your journal.');
    const userId=this.user.id;
    const run=async()=>{if(this.user?.id!==userId)throw Error('Your account changed.');return fn(userId);};
    if(typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request(this.key(),run);
    return run();
  }
  row(cache=this.cache){return {document:structuredClone(cache.document),revision:cache.base.revision,pending:cache.pending,offlineConflict:Boolean(cache.conflicts?.length),cacheWarning:this.cacheWarning};}
  async load(){return this.locked(userId=>this.loadAndSync(userId));}
  async loadAndSync(userId,resolve=false){
    this.cache=this.read()||this.cache;
    if(typeof navigator!=='undefined'&&navigator.onLine===false&&this.cache)return this.row();
    for(let attempt=0;attempt<3;attempt++){
      let remote;
      try{remote=await super.load();this.validateDocument(remote.document);if(!Number.isSafeInteger(remote.revision)||remote.revision<0)throw Error('Invalid cloud revision');}
      catch(error){if(this.user?.id!==userId)throw error;if(this.cache)return this.row();throw error;}
      if(this.user?.id!==userId)throw Error('Your account changed.');
      if(!this.cache?.pending){
        super.accept(remote);this.write({userId,base:remote,document:remote.document,pending:false});return this.row();
      }
      const merged=mergeOfflineJournal(this.cache.base.document,this.cache.document,remote.document);
      this.validateDocument(merged.document);
      if(merged.conflicts.length&&!resolve){
        this.write({...this.cache,conflicts:merged.conflicts},true);return this.row();
      }
      // Save the merged draft durably before the network request. CAS retries rebase on the latest row.
      this.write({...this.cache,base:remote,conflicts:[],document:merged.document},true);
      super.accept(remote);
      try{
        const saved=await super.save(merged.document);
        if(this.user?.id!==userId)throw Error('Your account changed.');
        this.write({userId,base:saved,document:saved.document,pending:false});return this.row();
      }catch(error){
        if(this.user?.id!==userId)throw error;
        if(error.conflict)continue;
        return this.row();
      }
    }
    return this.row();
  }
  async save(document){return this.locked(async userId=>{
    this.validateDocument(document);
    const stored=this.read()||this.cache;
    if(!stored)throw Error('Load your journal online once before saving offline.');
    // Another tab may have saved since this tab last rendered. Never replace its edits silently.
    if(this.cache&&JSON.stringify(stored.document)!==JSON.stringify(this.cache.document)){
      const combined=mergeOfflineJournal(this.cache.document,document,stored.document);
      if(combined.conflicts.length){const error=Error('Another tab changed this entry.');error.conflict=true;throw error;}
      document=combined.document;
    }
    this.write({...stored,userId,document:structuredClone(document),pending:true},true);
    return this.loadAndSync(userId);
  });}
  async resolveOffline(){return this.locked(userId=>this.loadAndSync(userId,true));}
}
globalThis.mergeOfflineJournal=mergeOfflineJournal;
globalThis.OfflineJournalCloud=OfflineJournalCloud;
