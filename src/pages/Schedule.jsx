import { useState, useEffect, useRef } from "react";
import { useAccounts, useHistory } from "../App.jsx";

const POST_TYPES = [
  { value: "FEED",  label: "Feed",  icon: "⊞" },
  { value: "REEL",  label: "Reel",  icon: "▶" },
  { value: "STORY", label: "Story", icon: "◎" },
];

function getDefaultStartTime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 1, 0, 0);
  return d.toISOString().slice(0, 16);
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function useScheduler(addEntry) {
  const [queue, setQueue] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ig_queue") || "[]"); } catch { return []; }
  });
  const timerRef = useRef(null);

  const saveQueue = (q) => { localStorage.setItem("ig_queue", JSON.stringify(q)); setQueue(q); };
  const addBatch = (batch) => { const q = JSON.parse(localStorage.getItem("ig_queue") || "[]"); saveQueue([...q, ...batch]); };
  const removeItem = (id) => { const q = JSON.parse(localStorage.getItem("ig_queue") || "[]"); saveQueue(q.filter((x) => x.id !== id)); };
  const clearQueue = () => saveQueue([]);

  useEffect(() => {
    const tick = async () => {
      const q = JSON.parse(localStorage.getItem("ig_queue") || "[]");
      const now = Date.now();
      const due = q.filter((item) => item.scheduledAt <= now && item.status === "pending");

      for (const item of due) {
        const running = JSON.parse(localStorage.getItem("ig_queue") || "[]");
        saveQueue(running.map((x) => x.id === item.id ? { ...x, status: "running" } : x));

        try {
          const res = await fetch("/api/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accounts: item.accounts, media_url: item.mediaUrl,
              media_type: item.mediaType, post_type: item.postType,
              captions: item.captions, default_caption: item.caption,
              delay_seconds: 0,
            }),
          });
          const data = await res.json();
          const results = data.results || [];
          addEntry({ id: Date.now(), post_type: item.postType, media_url: item.mediaUrl, media_type: item.mediaType, default_caption: item.caption, delay_seconds: 0, results, created_at: new Date().toISOString() });

          const afterPost = JSON.parse(localStorage.getItem("ig_queue") || "[]");
          if (item.loop) {
            const next = item.scheduledAt + 24 * 60 * 60 * 1000;
            saveQueue(afterPost.map((x) => x.id === item.id ? { ...x, status: "pending", scheduledAt: next, runCount: (x.runCount || 0) + 1, lastResults: results } : x));
          } else {
            saveQueue(afterPost.map((x) => x.id === item.id ? { ...x, status: "done", results } : x));
          }
        } catch (err) {
          const afterErr = JSON.parse(localStorage.getItem("ig_queue") || "[]");
          saveQueue(afterErr.map((x) => x.id === item.id ? { ...x, status: "error", error: err.message } : x));
        }
      }
      setQueue([...JSON.parse(localStorage.getItem("ig_queue") || "[]")]);
    };

    timerRef.current = setInterval(tick, 10000);
    tick();
    return () => clearInterval(timerRef.current);
  }, []);

  return { queue, addBatch, removeItem, clearQueue };
}

const STATUS_COLOR = { pending: "var(--accent-light)", running: "var(--warning)", done: "var(--success)", error: "var(--danger)" };
const STATUS_LABEL = { pending: "Aguardando", running: "Publicando…", done: "Publicado", error: "Erro" };
const STATUS_BADGE = { pending: "badge-info", running: "badge-warning", done: "badge-success", error: "badge-danger" };

export default function Schedule() {
  const { accounts } = useAccounts();
  const { addEntry } = useHistory();
  const { queue, addBatch, removeItem, clearQueue } = useScheduler(addEntry);

  const [postType, setPostType]       = useState("FEED");
  const [mediaType, setMediaType]     = useState("IMAGE");
  const [caption, setCaption]         = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [loop, setLoop]               = useState(false);
  const [urlList, setUrlList]         = useState([{ id: 1, url: "" }]);
  const [startTime, setStartTime]     = useState(getDefaultStartTime);
  const [intervalMin, setIntervalMin] = useState(30);
  const [intervalMax, setIntervalMax] = useState(60);

  // Loop inteligente — buscar métricas
  const [showLoopPanel, setShowLoopPanel]     = useState(false);
  const [loopDate, setLoopDate]               = useState(() => new Date().toISOString().slice(0, 10));
  const [loopStartTime, setLoopStartTime]     = useState(getDefaultStartTime);
  const [loopFetching, setLoopFetching]       = useState(false);
  const [loopSuggestions, setLoopSuggestions] = useState([]);
  const [loopSelected, setLoopSelected]       = useState([]);
  const [loopAccIds, setLoopAccIds]           = useState([]);

  const effectiveMediaType = postType === "REEL" ? "VIDEO" : mediaType;

  const toggleAccount   = (id) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const toggleLoopAcc   = (id) => setLoopAccIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll       = () => setSelectedIds(accounts.map((a) => a.id));
  const clearAll        = () => setSelectedIds([]);
  const addUrl          = () => setUrlList((p) => [...p, { id: Date.now(), url: "" }]);
  const removeUrl       = (id) => setUrlList((p) => p.filter((x) => x.id !== id));
  const setUrl          = (id, val) => setUrlList((p) => p.map((x) => x.id === id ? { ...x, url: val } : x));

  const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));
  const loopAccounts     = accounts.filter((a) => loopAccIds.includes(a.id));

  const schedule = () => {
    const urls = urlList.map((x) => x.url.trim()).filter(Boolean);
    if (urls.length === 0) return alert("Adicione ao menos uma URL de mídia");
    if (selectedIds.length === 0) return alert("Selecione ao menos uma conta");

    const base = new Date(startTime).getTime();
    const batches = [];
    let cursor = base;

    urls.forEach((url, i) => {
      if (i > 0) cursor += randomBetween(intervalMin, intervalMax) * 1000;
      batches.push({
        id: `${Date.now()}-${i}`,
        scheduledAt: cursor, status: "pending",
        postType, mediaType: effectiveMediaType, mediaUrl: url, caption,
        captions: {}, accounts: selectedAccounts, loop, runCount: 0,
      });
    });

    addBatch(batches);
    setUrlList([{ id: 1, url: "" }]);
    alert(`✓ ${batches.length} post(s) agendado(s)!`);
  };

  // Busca métricas de posts do histórico para o loop inteligente
  const fetchLoopSuggestions = async () => {
    setLoopFetching(true);
    setLoopSuggestions([]);

    const accsToUse = loopAccIds.length > 0 ? accounts.filter((a) => loopAccIds.includes(a.id)) : accounts;

    const GRAPH = "https://graph.facebook.com/v19.0";
    const results = [];

    for (const acc of accsToUse) {
      try {
        const since = Math.floor(new Date(loopDate + "T00:00:00").getTime() / 1000);
        const until = Math.floor(new Date(loopDate + "T23:59:59").getTime() / 1000);

        const res = await fetch(
          `${GRAPH}/${acc.id}/media?fields=id,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count&since=${since}&until=${until}&access_token=${acc.access_token}`
        );
        const data = await res.json();
        const media = data.data || [];

        for (const m of media) {
          // Busca insights
          try {
            const insRes = await fetch(
              `${GRAPH}/${m.id}/insights?metric=impressions,reach,shares&access_token=${acc.access_token}`
            );
            const insData = await insRes.json();
            const ins = {};
            for (const item of insData.data || []) ins[item.name] = item.values?.[0]?.value || 0;

            const engagement = (m.like_count || 0) + (m.comments_count || 0) * 2 + (ins.shares || 0) * 3;
            results.push({
              id: m.id, account: acc, media_type: m.media_type,
              media_url: m.media_url || m.thumbnail_url || "",
              timestamp: m.timestamp, likes: m.like_count || 0,
              comments: m.comments_count || 0, shares: ins.shares || 0,
              impressions: ins.impressions || 0, reach: ins.reach || 0,
              engagement, username: acc.username,
            });
          } catch {
            results.push({
              id: m.id, account: acc, media_type: m.media_type,
              media_url: m.media_url || m.thumbnail_url || "",
              timestamp: m.timestamp, likes: m.like_count || 0,
              comments: m.comments_count || 0, shares: 0,
              impressions: 0, reach: 0, engagement: (m.like_count || 0) + (m.comments_count || 0) * 2,
              username: acc.username,
            });
          }
        }
      } catch {}
    }

    results.sort((a, b) => b.engagement - a.engagement);
    setLoopSuggestions(results);
    setLoopFetching(false);
  };

  const scheduleLoop = () => {
    const selected = loopSuggestions.filter((s) => loopSelected.includes(s.id));
    if (selected.length === 0) return alert("Selecione ao menos um post");

    const accsToPost = loopAccounts.length > 0 ? loopAccounts : accounts;
    const base = new Date(loopStartTime).getTime();
    const batches = [];
    let cursor = base;

    selected.forEach((post, i) => {
      if (i > 0) cursor += randomBetween(intervalMin, intervalMax) * 1000;
      const pt = post.media_type === "VIDEO" ? "REEL" : "FEED";
      batches.push({
        id: `loop-${Date.now()}-${i}`,
        scheduledAt: cursor, status: "pending",
        postType: pt, mediaType: post.media_type,
        mediaUrl: post.media_url, caption: "",
        captions: {}, accounts: accsToPost,
        loop: false, runCount: 0,
        loopSource: true,
      });
    });

    addBatch(batches);
    setShowLoopPanel(false);
    setLoopSelected([]);
    alert(`✓ ${batches.length} post(s) do loop agendado(s)!`);
  };

  const pendingQueue = queue.filter((x) => x.status === "pending" || x.status === "running");
  const doneQueue    = queue.filter((x) => x.status === "done" || x.status === "error");

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Agendamentos</div>
          <div className="page-subtitle">Agende posts com intervalo aleatório para parecer humano</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-success" onClick={() => setShowLoopPanel(true)}>
            🔁 Loop inteligente
          </button>
          {queue.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => confirm("Limpar toda a fila?") && clearQueue()}>
              Limpar fila
            </button>
          )}
        </div>
      </div>

      {/* ── Loop inteligente panel ── */}
      {showLoopPanel && (
        <div className="card card-highlight" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>🔁 Loop inteligente</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Busca posts com mais engajamento de um dia e reagenda para amanhã</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowLoopPanel(false); setLoopSuggestions([]); setLoopSelected([]); }}>✕ Fechar</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Data dos posts</label>
              <input type="date" value={loopDate} onChange={(e) => setLoopDate(e.target.value)} />
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Publicar amanhã às</label>
              <input type="datetime-local" value={loopStartTime} onChange={(e) => setLoopStartTime(e.target.value)} />
            </div>
            <div>
              <label>Contas para buscar métricas</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                {accounts.map((acc) => (
                  <button key={acc.id} onClick={() => toggleLoopAcc(acc.id)} style={{
                    padding: "4px 10px", borderRadius: 20, border: "1px solid", fontSize: 12, transition: "all 0.12s",
                    borderColor: loopAccIds.includes(acc.id) ? "var(--accent)" : "var(--border)",
                    background: loopAccIds.includes(acc.id) ? "var(--accent-glow)" : "var(--bg3)",
                    color: loopAccIds.includes(acc.id) ? "var(--accent-light)" : "var(--muted)",
                  }}>@{acc.username}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Vazio = busca em todas</div>
            </div>
          </div>

          <button className="btn btn-primary" onClick={fetchLoopSuggestions} disabled={loopFetching} style={{ marginBottom: 16 }}>
            {loopFetching ? <><span className="spinner" /> Buscando métricas...</> : "🔍 Buscar posts de hoje"}
          </button>

          {loopSuggestions.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                {loopSuggestions.length} posts encontrados — ordenados por engajamento. Selecione os que quer repetir:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                {loopSuggestions.map((post) => {
                  const sel = loopSelected.includes(post.id);
                  return (
                    <button key={post.id} onClick={() => setLoopSelected((p) => sel ? p.filter((x) => x !== post.id) : [...p, post.id])} style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                      borderRadius: 9, border: "1px solid", textAlign: "left", width: "100%", transition: "all 0.12s",
                      borderColor: sel ? "var(--accent)" : "var(--border)",
                      background: sel ? "var(--accent-glow)" : "var(--bg3)",
                    }}>
                      {/* Thumb */}
                      <div style={{ width: 44, height: 44, borderRadius: 7, overflow: "hidden", background: "var(--bg4)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {post.media_url ? (
                          <img src={post.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => e.target.style.display = "none"} />
                        ) : <span style={{ fontSize: 20 }}>▶</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 3 }}>@{post.username} · {new Date(post.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
                        <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
                          <span>❤️ {post.likes}</span>
                          <span>💬 {post.comments}</span>
                          <span>↗ {post.shares}</span>
                          <span style={{ color: "var(--accent-light)", fontWeight: 600 }}>⚡ {post.engagement} eng</span>
                        </div>
                      </div>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, border: `1.5px solid ${sel ? "var(--accent)" : "var(--border2)"}`, background: sel ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11 }}>
                        {sel && "✓"}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button className="btn btn-primary" onClick={scheduleLoop} disabled={loopSelected.length === 0}>
                  ↑ Agendar {loopSelected.length} post(s) selecionado(s)
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setLoopSelected(loopSuggestions.map((s) => s.id))}>Selecionar todos</button>
              </div>
            </>
          )}

          {loopSuggestions.length === 0 && !loopFetching && (
            <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)", fontSize: 13 }}>
              Clique em "Buscar posts de hoje" para ver sugestões
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 18, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Tipo */}
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>Tipo de post</div>
            <div style={{ display: "flex", gap: 8 }}>
              {POST_TYPES.map((t) => (
                <button key={t.value} onClick={() => setPostType(t.value)} className={`type-btn ${postType === t.value ? "active" : ""}`}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{t.icon}</div>
                  <div className="type-label">{t.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Mídia tipo */}
          {postType !== "REEL" && (
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Tipo de mídia</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[{ v: "IMAGE", l: "🖼️  Imagem" }, { v: "VIDEO", l: "🎬  Vídeo" }].map((t) => (
                  <button key={t.v} onClick={() => setMediaType(t.v)} style={{
                    flex: 1, padding: "9px", borderRadius: 8, border: "1px solid", fontSize: 13, fontWeight: mediaType === t.v ? 600 : 400, transition: "all 0.12s",
                    borderColor: mediaType === t.v ? "var(--accent)" : "var(--border)",
                    background: mediaType === t.v ? "var(--accent-glow)" : "var(--bg3)",
                    color: mediaType === t.v ? "var(--accent-light)" : "var(--muted)",
                  }}>{t.l}</button>
                ))}
              </div>
            </div>
          )}

          {/* URLs */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>URLs das mídias ({urlList.length})</div>
              <button className="btn btn-ghost btn-xs" onClick={addUrl}>+ Adicionar</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {urlList.map((item, i) => (
                <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--muted)", width: 18, flexShrink: 0, textAlign: "right" }}>{i + 1}</span>
                  <input type="url" placeholder="https://files.catbox.moe/xxxxxx.mp4" value={item.url} onChange={(e) => setUrl(item.id, e.target.value)} style={{ flex: 1 }} />
                  {urlList.length > 1 && (
                    <button onClick={() => removeUrl(item.id)} style={{ background: "none", color: "var(--muted)", fontSize: 18, padding: "0 4px", flexShrink: 0, lineHeight: 1 }}>×</button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>Cada URL = 1 post separado publicado em sequência</div>
          </div>

          {/* Legenda */}
          {(postType === "FEED" || postType === "REEL") && (
            <div className="card">
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Legenda</label>
                <textarea placeholder="Escreva a legenda... #hashtags" value={caption} onChange={(e) => setCaption(e.target.value)} style={{ minHeight: 80 }} />
              </div>
            </div>
          )}

          {/* Agendamento */}
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>⏰ Agendamento</div>

            <div className="form-row">
              <label>Primeiro post em</label>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Padrão: agora + 1 minuto</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Intervalo mínimo (s)</label>
                <input type="number" min="1" max="86400" value={intervalMin} onChange={(e) => setIntervalMin(Math.max(1, parseInt(e.target.value) || 1))} />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Intervalo máximo (s)</label>
                <input type="number" min="1" max="86400" value={intervalMax} onChange={(e) => setIntervalMax(Math.max(intervalMin, parseInt(e.target.value) || intervalMin))} />
              </div>
            </div>

            <div style={{ padding: "10px 14px", background: "var(--bg3)", borderRadius: 8, fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
              ⚡ Entre cada post: <strong style={{ color: "var(--text2)" }}>{intervalMin}~{intervalMax} segundos</strong> aleatório (parecer humano)
            </div>

            {/* Loop */}
            <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "10px 14px", background: "var(--bg3)", borderRadius: 8, margin: 0 }}>
              <label className="toggle">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: loop ? "var(--accent-light)" : "var(--text2)" }}>🔁 Loop diário</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Repetir automaticamente todo dia no mesmo horário</div>
              </div>
            </label>
          </div>

          <button className="btn btn-primary" style={{ alignSelf: "flex-start", padding: "12px 32px", fontSize: 14, borderRadius: 10 }} onClick={schedule}>
            ◷ Agendar {urlList.filter((x) => x.url.trim()).length} post(s)
          </button>
        </div>

        {/* Coluna direita */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Contas */}
          <div className="card" style={{ position: "sticky", top: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Contas <span style={{ color: "var(--muted)", fontWeight: 400 }}>{selectedIds.length}/{accounts.length}</span></div>
              <div style={{ display: "flex", gap: 5 }}>
                <button className="btn btn-ghost btn-xs" onClick={selectAll}>Todas</button>
                <button className="btn btn-ghost btn-xs" onClick={clearAll}>×</button>
              </div>
            </div>
            {accounts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)", fontSize: 13 }}>Nenhuma conta conectada</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {accounts.map((acc) => {
                  const sel = selectedIds.includes(acc.id);
                  return (
                    <button key={acc.id} onClick={() => toggleAccount(acc.id)} className={`account-btn ${sel ? "selected" : ""}`}>
                      {acc.profile_picture
                        ? <img src={acc.profile_picture} alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,var(--accent),var(--accent-light))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff", fontWeight: 700, flexShrink: 0 }}>{acc.username?.[0]?.toUpperCase()}</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="acc-name" style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{acc.username}</div>
                      </div>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, border: `1.5px solid ${sel ? "var(--accent)" : "var(--border2)"}`, background: sel ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9 }}>
                        {sel && "✓"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Fila ativa */}
          {pendingQueue.length > 0 && (
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>Fila ativa ({pendingQueue.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {pendingQueue.map((item) => (
                  <div key={item.id} style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 12px", border: `1px solid ${item.status === "running" ? "rgba(251,191,36,0.3)" : "var(--border)"}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                      <span className={`badge ${STATUS_BADGE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                      {item.loop && <span style={{ fontSize: 10, color: "var(--success)", background: "var(--success-bg)", padding: "1px 7px", borderRadius: 10, border: "1px solid rgba(52,211,153,0.2)" }}>LOOP</span>}
                      {item.loopSource && <span style={{ fontSize: 10, color: "var(--accent-light)", background: "var(--accent-glow)", padding: "1px 7px", borderRadius: 10 }}>LOOP INTELIGENTE</span>}
                      <span className="badge badge-gray" style={{ marginLeft: "auto" }}>{item.postType}</span>
                      <button onClick={() => removeItem(item.id)} style={{ background: "none", color: "var(--muted)", fontSize: 15, padding: 0, lineHeight: 1 }}>×</button>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>{item.mediaUrl}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      🕐 {new Date(item.scheduledAt).toLocaleString("pt-BR")}
                      {item.runCount > 0 && <span style={{ marginLeft: 6, color: "var(--accent-light)" }}>({item.runCount}ª vez)</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Concluídos */}
          {doneQueue.length > 0 && (
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Concluídos ({doneQueue.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {doneQueue.slice(0, 8).map((item) => (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", background: "var(--bg3)", borderRadius: 7 }}>
                    <span style={{ fontSize: 10, color: STATUS_COLOR[item.status] }}>●</span>
                    <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)" }}>{item.mediaUrl}</span>
                    <button onClick={() => removeItem(item.id)} style={{ background: "none", color: "var(--muted)", fontSize: 13, padding: 0 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {queue.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--muted)", fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>◷</div>
              Nenhum post agendado ainda
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
