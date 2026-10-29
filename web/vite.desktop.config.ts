import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
const web = fileURLToPath(new URL('.', import.meta.url));
const offlineShell: Plugin = {
  name: 'desktop-offline-shell',
  generateBundle(_, bundle) {
    const files = [
      './',
      './THIRD-PARTY-LICENSES.txt',
      './index.html',
      ...Object.keys(bundle)
        .filter((p) => p.startsWith('assets/'))
        .map((p) => './' + p),
    ];
    // Cache only this static desktop shell, never server routes or interview data.
    const version = createHash('sha256')
      .update(files.join('|'))
      .digest('hex')
      .slice(0, 16);
    const cache = 'meetfolio-desktop-' + version;
    const inventory = new Map<string, { name: string; version: string; license: unknown }>();
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== 'chunk') continue;
      for (const id of Object.keys(chunk.modules)) {
        const normalized = id.replace(/\\/g, '/').replace(/^\0/, '').split('?')[0];
        const marker = normalized.lastIndexOf('/node_modules/');
        if (marker < 0) continue;
        const suffix = normalized.slice(marker + 14).split('/');
        const name = suffix[0].startsWith('@') ? suffix.slice(0, 2).join('/') : suffix[0];
        try {
          const manifest = JSON.parse(readFileSync(normalized.slice(0, marker + 14) + name + '/package.json', 'utf8'));
          inventory.set(name + '@' + manifest.version, { name, version: manifest.version, license: manifest.license ?? 'SEE LICENSE' });
        } catch { /* Virtual build modules are not npm runtime packages. */ }
      }
    }
    this.emitFile({ type: 'asset', fileName: 'module-inventory.json', source: JSON.stringify([...inventory.values()].sort((a, b) => a.name.localeCompare(b.name)), null, 2) });
    this.emitFile({ type: 'asset', fileName: 'pcm-worklet.js' , source: readFileSync(`${web}public/pcm-worklet.js`, 'utf8') });
    this.emitFile({
      type: 'asset',
      fileName: 'sw.js',
      source: `const CACHE=${JSON.stringify(cache)};const FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('meetfolio-desktop-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/ws/'))return;if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(cache=>cache.match('./index.html',{ignoreVary:true}))));return;}if(FILES.some(p=>new URL(p,self.registration.scope).href===event.request.url))event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request,{ignoreVary:true})).then(cached=>cached||fetch(event.request)));});`,
    });
  },
};
export default defineConfig({
  root: `${web}desktop`,
  plugins: [react(), offlineShell],
  publicDir: `${web}desktop/public`,
  resolve: { alias: { '/src': `${web}src` } },
  build: { outDir: `${web}dist-desktop`, emptyOutDir: true, target: 'es2022' },
  preview: { host: '127.0.0.1', port: 4175, strictPort: true },
});
