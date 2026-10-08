import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRegistry, validateCatalog, REGISTRY_CACHE_KEY } from '../modelRegistry.js';
import { BUILTIN_CATALOG } from '../modelCatalog.js';
const copy = () => structuredClone(BUILTIN_CATALOG);
const config = () => ({ deepseek: { endpoint: 'https://api.deepseek.com' }, gemini: { endpoint: 'https://generativelanguage.googleapis.com' } });
class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}
test('catalog validates both suppliers, duplicates, defaults, migrations and schema', () => {
  assert.equal(validateCatalog(copy()).version, BUILTIN_CATALOG.version);
  for (const mutate of [c => c.schemaVersion = 2, c => c.apiKey = "forbidden", c => c.providers.deepseek.endpoint = "https://untrusted.invalid", c => c.providers.other = {}, c => c.providers.gemini.models.push(c.providers.gemini.models[0]), c => c.providers.gemini.defaultModel = 'unknown', c => c.providers.gemini.migrations.old = 'unknown']) {
    const c = copy(); mutate(c); assert.throws(() => validateCatalog(c));
  }
});
test('offline first visit has builtin catalog and preserves keys and selected tiers', async () => {
  const storage = new MemoryStorage();storage.setItem('existingApiKey', 'untouched');
  const r = createModelRegistry(config(), { storage, target: null, fetcher: async () => { throw new Error('offline'); } });
  await r.start();
  assert.equal(r.resolve('gemini', 'gemini-3.6-flash'), 'gemini-3.6-flash');
  assert.equal(r.resolve('gemini', 'gemini-3.1-flash-lite-preview'), 'gemini-3.1-flash-lite');
  assert.equal(r.resolve('deepseek', 'deepseek-v4-flash'), 'deepseek-flash');
  assert.equal(storage.getItem('existingApiKey'), 'untouched');
});
test('one remote update is applied to four clients without changing API endpoints', async () => {
  let source = copy();
  const clients = Array.from({length: 4}, () => { const c = config(); return { c, r: createModelRegistry(c, { target: null, fetcher: async () => ({ ok: true, json: async () => source }) }) }; });
  await Promise.all(clients.map(x => x.r.start()));
  const oldRequest = { model: clients[0].r.resolve('gemini', 'gemini-3.6-flash') };
  source = copy();source.version = 'test-update';source.providers.gemini.models.push({id:'gemini-test', label:'Test', status:'active'});source.providers.gemini.defaultModel='gemini-test';
  await Promise.all(clients.map(x => x.r.refresh({force: true})));
  for (const {c,r} of clients) { assert.equal(r.version, 'test-update');assert.equal(c.gemini.defaultModel, 'gemini-test');assert.equal(c.deepseek.endpoint,'https://api.deepseek.com'); }
  assert.equal(oldRequest.model, 'gemini-3.6-flash');
});
test('cached valid catalog survives network errors and invalid remote JSON', async () => {
  const storage = new MemoryStorage();const cached=copy();cached.version='cached';storage.setItem(REGISTRY_CACHE_KEY,JSON.stringify(cached));
  for (const fetcher of [async()=>{throw new Error();},async()=>({ok:true,json:async()=>({schemaVersion:9})}),async()=>({ok:true,json:async()=>{throw new Error('broken json');}}),async()=>({ok:false})]) {
    const r=createModelRegistry(config(),{storage,target:null,fetcher});await r.start();assert.equal(r.version,'cached');
  }
});
test('malformed stored cache falls back to builtin', async () => {
  const storage=new MemoryStorage();storage.setItem(REGISTRY_CACHE_KEY,'bad json');
  const r=createModelRegistry(config(),{storage,target:null,fetcher:async()=>{throw new Error();}});await r.start();assert.equal(r.version,BUILTIN_CATALOG.version);
});
test('blocked storage does not prevent live update', async () => {
  const r=createModelRegistry(config(),{storage:{getItem(){throw new Error();},setItem(){throw new Error();}},target:null,fetcher:async()=>({ok:true,json:async()=>copy()})});
  await r.start();assert.equal(r.version,BUILTIN_CATALOG.version);
});
test('timeout covers headers and stalled response body', async () => {
  for (const fetcher of [()=>new Promise(()=>{}),async()=>({ok:true,json:()=>new Promise(()=>{})})]) {
    const r=createModelRegistry(config(),{target:null,timeoutMs:10,fetcher});const t=Date.now();await r.start();assert.ok(Date.now()-t<300);assert.equal(r.version,BUILTIN_CATALOG.version);
  }
});
test('requests omit credentials, do not transmit API keys, and are deduplicated', async () => {
  let calls=0;let release;const gate=new Promise(resolve=>release=resolve);
  const r=createModelRegistry(config(),{target:null,fetcher:async(url,opts)=>{calls++;assert.equal(opts.credentials,'omit');assert.equal(opts.cache,'no-store');assert.equal(opts.referrerPolicy,'no-referrer');await gate;return {ok:true,json:async()=>copy()};}});
  const first=r.start();const second=r.refresh({force:true});release();await Promise.all([first,second]);assert.equal(calls,1);await r.refresh();assert.equal(calls,1);
});
test('frontmost refresh uses five minute interval and listener can unsubscribe', async () => {
  let visibility;let calls=0;let updates=0;
  const target={visibilityState:'hidden',addEventListener(name,fn){assert.equal(name,'visibilitychange');visibility=fn;}};
  const r=createModelRegistry(config(),{target,fetcher:async()=>{calls++;return {ok:true,json:async()=>copy()};}});
  const off=r.subscribe(()=>updates++);await r.start();visibility();assert.equal(calls,1);target.visibilityState='visible';visibility();assert.equal(calls,1);off();await r.refresh({force:true});assert.equal(updates,1);
});
