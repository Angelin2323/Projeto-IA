// Service worker do TT Coach: deixa o app funcionar sem internet depois do primeiro acesso.
// Mude VERSAO ao publicar uma nova versão para que os aparelhos atualizem.
const VERSAO = "ttcoach-v1";
const CASCA = [
  "./", "./index.html", "./styles.css", "./manifest.webmanifest",
  "./js/app.js", "./js/features.js", "./js/analyzer.js", "./js/memory.js", "./js/pose.js", "./js/render.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png",
];
// Arquivos grandes do MediaPipe (vendor/, model/) e das CDNs: guardados na primeira vez e reaproveitados.
const EXTERNOS = ["cdn.jsdelivr.net", "storage.googleapis.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

async function guardar(req, resp) {
  if (resp && resp.ok && resp.status === 200) {
    const c = await caches.open(VERSAO);
    await c.put(req, resp.clone());
  }
  return resp;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const mesmaOrigem = url.origin === self.location.origin;
  if (!mesmaOrigem && !EXTERNOS.includes(url.hostname)) return;

  const pesado = !mesmaOrigem || url.pathname.includes("/vendor/") || url.pathname.includes("/model/");
  if (pesado) {
    // primeiro o que já está guardado; se não houver, baixa e guarda
    e.respondWith(caches.match(req).then((c) => c || fetch(req).then((r) => guardar(req, r))));
    return;
  }
  // páginas e scripts do app: mostra o guardado na hora e atualiza em segundo plano
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((guardado) => {
      const rede = fetch(req).then((r) => guardar(req, r)).catch(() => null);
      if (guardado) { e.waitUntil(rede); return guardado; }
      return rede.then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : Response.error()));
    })
  );
});
