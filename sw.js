// Service worker do CRIS: guarda os arquivos do app para abrir rápido e sem internet.
// Ao publicar uma nova versão, aumente o número abaixo.
const VERSAO = 'cris-v3';
const ARQUIVOS = [
  './',
  'index.html',
  'css/estilo.css',
  'js/app.js',
  'js/config.js',
  'js/base.js',
  'js/medicamentos.js',
  'js/termo.js',
  'js/vendor/supabase.js',
  'manifest.webmanifest',
  'icons/icone-192.png',
  'icons/icone-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Dados do Supabase sempre vêm da internet (nunca do cache).
  if (url.hostname.endsWith('supabase.co')) return;

  // Arquivos do app: tenta a internet primeiro (pega atualizações) e cai no cache se estiver offline.
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok && (url.origin === location.origin || url.hostname.includes('fonts.g'))) {
          const copia = resp.clone();
          caches.open(VERSAO).then((c) => c.put(e.request, copia));
        }
        return resp;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
