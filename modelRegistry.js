import { BUILTIN_CATALOG } from './modelCatalog.js';
export const REGISTRY_URL = 'https://ai-model-registry.pages.dev/models.json';
export const REGISTRY_CACHE_KEY = 'aiModelRegistry.catalog.v1';
export const REGISTRY_INTERVAL_MS = 300000;
const PROVIDERS = ['deepseek', 'gemini'];
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value);

export function validateCatalog(input) {
  if (input && Object.keys(input).some(key => !['schemaVersion', 'version', 'providers'].includes(key))) throw new Error('Unexpected catalog fields');
  if (!input || input.schemaVersion !== 1 || !identifier(input.version)) throw new Error('Unsupported model catalog');
  if (Object.keys(input.providers || {}).some(id => !PROVIDERS.includes(id))) throw new Error('Unknown provider');
  const providers = {};
  for (const id of PROVIDERS) {
    const source = input.providers?.[id];
    if (!source || !Array.isArray(source.models) || !source.models.length || source.models.length > 100) throw new Error('Invalid provider');
    if (Object.keys(source).some(key => !['models', 'defaultModel', 'migrations'].includes(key))) throw new Error('Unexpected provider fields');
    const models = source.models.map(item => {
      if (item && Object.keys(item).some(key => !['id', 'label', 'status'].includes(key))) throw new Error('Unexpected model fields');
      if (!item || !['active', 'retired'].includes(item.status) || !identifier(item.id) || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 160) throw new Error('Invalid model');
      return { id: item.id, label: item.label, status: item.status === 'retired' ? 'retired' : 'active' };
    });
    const ids = models.map(item => item.id);
    const active = models.filter(item => item.status === 'active').map(item => item.id);
    if (new Set(ids).size !== ids.length || !active.includes(source.defaultModel)) throw new Error('Invalid default');
    const migrations = {};
    for (const [oldId, nextId] of Object.entries(source.migrations || {})) {
      if (!identifier(oldId) || !active.includes(nextId) || active.includes(oldId)) throw new Error('Invalid migration');
      migrations[oldId] = nextId;
    }
    providers[id] = { models, defaultModel: source.defaultModel, migrations };
  }
  return { schemaVersion: 1, version: input.version, providers };
}

export function createModelRegistry(config, { onApply = () => {}, fetcher = (...args) => globalThis.fetch(...args), storage, timeoutMs = 3000, target = globalThis.document } = {}) {
  const getStorage = () => { try { return storage || globalThis.localStorage; } catch { return null; } };
  const listeners = new Set();
  const notices = new Set();
  let catalog = null;
  let pending = null;
  let started = false;
  let lastCheck = 0;
  const apply = (input, save) => {
    const next = validateCatalog(input);
    for (const id of PROVIDERS) {
      const source = next.providers[id];
      config[id].models = source.models.filter(item => item.status === 'active').map(item => item.id);
      config[id].modelLabels = Object.fromEntries(source.models.map(item => [item.id, item.label]));
      config[id].defaultModel = source.defaultModel;
    }
    catalog = next;
    if (save) { try { getStorage()?.setItem(REGISTRY_CACHE_KEY, JSON.stringify(next)); } catch { /* optional cache */ } }
    onApply(next);
    for (const listener of listeners) listener(next);
    return next;
  };
  const notify = (oldId, nextId) => {
    if (!target?.body || notices.has(oldId + ':' + nextId)) return;
    notices.add(oldId + ':' + nextId);
    let notice = target.getElementById('ai-model-migration-notice');
    if (!notice) {
      notice = target.createElement('div');
      notice.id = 'ai-model-migration-notice';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:10000;padding:12px 16px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#334155;font:14px/1.5 system-ui;box-shadow:0 4px 20px #0001';
      target.body.append(notice);
    }
    notice.replaceChildren(target.createTextNode(`模型 ${oldId} 已迁移为 ${nextId}。 `));
    const close = target.createElement('button');
    close.type = 'button'; close.textContent = '知道了';
    close.onclick = () => notice.remove();
    notice.append(close);
  };
  const resolve = (provider, model) => {
    const id = PROVIDERS.includes(provider) ? provider : 'deepseek';
    if (config[id].models.includes(model)) return model;
    const next = catalog?.providers[id].migrations[model];
    if (next) { globalThis.queueMicrotask(() => notify(model, next)); return next; }
    // Do not silently replace a user's unsupported selection with a paid default.
    // Preserve it as a visible legacy option; the provider can reject it until selected manually.
    if (identifier(model) && model.startsWith(id + '-')) {
      if (!config[id].models.includes(model)) config[id].models.push(model);
      config[id].modelLabels ||= {};
      config[id].modelLabels[model] = `${model}（请确认可用性）`;
      return model;
    }
    return config[id].defaultModel;
  };
  const refresh = ({ force = false } = {}) => {
    if (pending) return pending;
    if (!force && Date.now() - lastCheck < REGISTRY_INTERVAL_MS) return Promise.resolve(catalog);
    lastCheck = Date.now();
    pending = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Model catalog timeout')); }, timeoutMs);
        });
        const request = (async () => {
          const response = await fetcher(REGISTRY_URL, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
          if (!response.ok) throw new Error('Model catalog unavailable');
          return await response.json();
        })();
        return apply(await Promise.race([request, timeout]), true);
      } catch { return catalog; }
      finally { clearTimeout(timer); pending = null; }
    })();
    return pending;
  };
  apply(BUILTIN_CATALOG, false);
  return {
    resolve,
    refresh,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get version() { return catalog?.version || 'builtin'; },
    async start() {
      if (!started) {
        started = true;
        try { const cached = getStorage()?.getItem(REGISTRY_CACHE_KEY); if (cached) apply(JSON.parse(cached), false); } catch { /* invalid cache ignored */ }
        target?.addEventListener('visibilitychange', () => { if (target.visibilityState === 'visible') void refresh(); });
      }
      return refresh({ force: true });
    }
  };
}
