// Service Worker — Insta Manager Scheduler
// Roda em background mesmo com a aba fechada (enquanto o navegador estiver aberto)

const CACHE = "insta-sw-v1";
const TICK_INTERVAL = 15000; // 15 segundos

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
  startTicker();
});

// ─── Ticker ─────────────────────────────────────────────────────────────────

let tickerInterval = null;

function startTicker() {
  if (tickerInterval) return;
  tickerInterval = setInterval(tick, TICK_INTERVAL);
  tick(); // roda imediatamente ao ativar
}

async function tick() {
  // Lê a fila do IndexedDB (compartilhado com o front)
  const queue = await readQueue();
  const now = Date.now();
  const due = queue.filter((item) => item.scheduledAt <= now && item.status === "pending");

  if (due.length === 0) return;

  for (const item of due) {
    await runItem(item, queue);
  }
}

async function runItem(item, queue) {
  // Marca como running
  await updateItem(item.id, { status: "running" });
  notifyClients({ type: "QUEUE_UPDATE" });

  try {
    // Descobre a origem para montar a URL da API
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    const origin = clients[0]?.url
      ? new URL(clients[0].url).origin
      : self.location.origin;

    const res = await fetch(`${origin}/api/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accounts: item.accounts,
        media_url: item.mediaUrl,
        media_type: item.mediaType,
        post_type: item.postType,
        captions: item.captions || {},
        default_caption: item.caption || "",
        delay_seconds: 0,
      }),
    });

    const data = await res.json();
    const results = data.results || [];
    const successCount = results.filter((r) => r.success).length;

    // Salva no histórico
    await appendHistory({
      id: Date.now(),
      post_type: item.postType,
      media_url: item.mediaUrl,
      media_type: item.mediaType,
      default_caption: item.caption || "",
      delay_seconds: 0,
      results,
      created_at: new Date().toISOString(),
      from_scheduler: true,
    });

    if (item.loop) {
      const next = item.scheduledAt + 24 * 60 * 60 * 1000;
      await updateItem(item.id, {
        status: "pending",
        scheduledAt: next,
        runCount: (item.runCount || 0) + 1,
        lastResults: results,
      });
    } else {
      await updateItem(item.id, { status: "done", results });
    }

    // Notificação push (se permitido)
    if (self.registration.showNotification && successCount > 0) {
      self.registration.showNotification("Insta Manager", {
        body: `✅ Post publicado em ${successCount}/${results.length} conta(s): ${truncate(item.mediaUrl, 40)}`,
        icon: "/favicon.ico",
        tag: `published-${item.id}`,
      });
    }
  } catch (err) {
    await updateItem(item.id, { status: "error", error: err.message });

    if (self.registration.showNotification) {
      self.registration.showNotification("Insta Manager — Erro", {
        body: `❌ Falha ao publicar: ${err.message}`,
        icon: "/favicon.ico",
        tag: `error-${item.id}`,
      });
    }
  }

  notifyClients({ type: "QUEUE_UPDATE" });
}

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("insta_manager", 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("history")) {
        db.createObjectStore("history", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readonly");
    const req = tx.objectStore("queue").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function updateItem(id, patch) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readwrite");
    const store = tx.objectStore("queue");
    const req = store.get(id);
    req.onsuccess = () => {
      if (!req.result) return resolve();
      store.put({ ...req.result, ...patch });
      tx.oncomplete = resolve;
      tx.onerror = reject;
    };
    req.onerror = reject;
  });
}

async function appendHistory(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").put(entry);
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

// ─── Comunicação com o front ─────────────────────────────────────────────────

function notifyClients(msg) {
  self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
    clients.forEach((c) => c.postMessage(msg));
  });
}

// Mensagens recebidas do front
self.addEventListener("message", (e) => {
  if (e.data?.type === "PING") {
    e.source?.postMessage({ type: "PONG" });
  }
  if (e.data?.type === "FORCE_TICK") {
    tick();
  }
});

function truncate(str, n) {
  return str?.length > n ? str.slice(0, n) + "…" : str;
}
