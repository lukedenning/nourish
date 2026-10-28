'use strict';
// Account-scoped cloud storage with optimistic concurrency. No journal cache.
class JournalCloud {
  constructor(client) { this.client=client; this.user=null; this.revision=0; }
  async session() {
    const {data,error}=await this.client.auth.getSession();
    if(error) throw error;
    this.setUser(data.session?.user || null);
    return data.session;
  }
  setUser(user) { if(this.user?.id!==user?.id)this.revision=0; this.user=user; }
  async load() {
    if(!this.user) throw Error('Sign in to load your journal.');
    const userId=this.user.id;
    const {data,error}=await this.client.from('nourish_journals')
      .select('document,revision').eq('user_id',userId).maybeSingle();
    if(error) throw error;
    if(this.user?.id!==userId) throw Error('Your account changed. Please try again.');
    return data || {document:{version:1,foods:[],favourites:[],weights:[]},revision:0};
  }
  accept(row) { this.revision=row.revision; }
  async save(document) {
    if(!this.user)throw Error('Sign in before saving.');
    const userId=this.user.id;
    const {data,error}=await this.client.rpc('save_nourish_journal',{
      next_document:document,expected_revision:this.revision
    });
    if(error){if(error.message?.includes('journal_conflict')){const conflict=Error('This journal changed on another device.');conflict.conflict=true;throw conflict;}throw error;}
    if(this.user?.id!==userId)throw Error('Your account changed. Please reload.');
    this.accept(data);
    return data;
  }
}
globalThis.JournalCloud=JournalCloud;
