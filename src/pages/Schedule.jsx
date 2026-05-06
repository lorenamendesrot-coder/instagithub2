import { useState, useEffect, useCallback } from "react";
import { useAccounts, useHistory } from "../App.jsx";
import MediaPreview from "../MediaPreview.jsx";
import { dbGetAll, dbPut, dbPutMany, dbDelete, dbClear } from "../useDB.js";

const POST_TYPES = [
  { value: "FEED",  label: "Feed",  desc: "Foto ou vídeo", icon: "🖼" },
  { value: "REEL",  label: "Reel",  desc: "Vídeo curto",   icon: "🎬" },
  { value: "STORY", label: "Story", desc: "24 horas",      icon: "⭕" },
];

// Data atual + N minutos, formato datetime-local
function nowPlus(minutes = 1) {
  const d = new Date(Date.now() + minutes * 60000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Hook de fila IndexedDB — tick local SEMPRE ativo, SW é bônus
function useScheduler(addEntry) {
  const [queue, setQueue] = useState([]);
  const runningRef = { current: new Set() };

  const reload = useCallback(async () => {
    const all = await dbGetAll("queue");
    all.sort((a, b) => a.scheduledAt - b.scheduledAt);
    setQueue(all);
  }, []);

  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener("sw:queue-update", h);
    return () => window.removeEventListener("sw:queue-update", h);
  }, []);

  // Tick local — roda SEMPRE a cada 10s, independente do SW
  useEffect(() => {
    const tick = async () => {
      const all = await dbGetAll("queue");
      const now = Date.now();
      const due = all.filter((x) => x.scheduledAt <= now && x.status === "pending");
      if (!due.length) return;

      for (const item of due) {
        if (runningRef.current.has(item.id)) continue;
        runningRef.current.add(item.id);

        await dbPut("queue", { ...item, status: "running" });
        reload();

        try {
          const res = await fetch("/.netlify/functions/publish", {
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

          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const results = data.results || [];

          await addEntry({
            id: Date.now(),
            post_type: item.postType,
            media_url: item.mediaUrl,
            media_type: item.mediaType,
            default_caption: item.caption,
            results,
            created_at: new Date().toISOString(),
            from_scheduler: true,
          });

          if (item.loop) {
            await dbPut("queue", { ...item, status: "pending", scheduledAt: item.scheduledAt + 86400000, runCount: (item.runCount || 0) + 1 });
          } else {
            await dbPut("queue", { ...item, status: "done", results });
          }
        } catch (err) {
          await dbPut("queue", { ...item, status: "error", error: err.message });
        }

        runningRef.current.delete(item.id);
        reload();
      }
    };

    const iv = setInterval(tick, 10000);
    tick();
    return () => clearInterval(iv);
  }, [addEntry]);

  const addBatch   = async (b) => { await dbPutMany("queue", b); reload(); };
  const removeItem = async (id) => { await dbDelete("queue", id); setQueue((p) => p.filter((x) => x.id !== id)); };
  const clearQueue = async () => { await dbClear("queue"); setQueue([]); };
  return { queue, addBatch, removeItem, clearQueue, reload };
}

// ─── Componente principal ────────────────────────────────────────────────────
export default function Schedule() {
  const { accounts } = useAccounts();
  const { addEntry }  = useHistory();
  const { queue, addBatch, removeItem, clearQueue } = useScheduler(addEntry);

  const [postType,    setPostType]    = useState("FEED");
  const [mediaType,   setMediaType]   = useState("IMAGE");
  const [caption,     setCaption]     = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [loop,        setLoop]        = useState(false);
  const [urlList,     setUrlList]     = useState([{ id: 1, url: "" }]);
  const [previewIdx,  setPreviewIdx]  = useState(0);
  const [startTime,   setStartTime]   = useState(nowPlus(1));
  // Intervalo padrão: 30s ~ 1min (0.5 ~ 1 minuto)
  const [intervalMin, setIntervalMin] = useState(0.5); // em minutos
  const [intervalMax, setIntervalMax] = useState(1);
  const [showRepeat,  setShowRepeat]  = useState(false);
  const [repeatSel,   setRepeatSel]   = useState([]);
  const [metrics,     setMetrics]     = useState({}); // { [media_id]: { likes, comments, ... } }
  const [fetchingMet, setFetchingMet] = useState(false);

  const toggleAcc = (id) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll = () => setSelectedIds(accounts.map((a) => a.id));
  const clearAll  = () => setSelectedIds([]);

  const addUrl    = () => setUrlList((p) => [...p, { id: Date.now(), url: "" }]);
  const removeUrl = (id) => setUrlList((p) => p.filter((x) => x.id !== id));
  const setUrl    = (id, v) => setUrlList((p) => p.map((x) => x.id === id ? { ...x, url: v } : x));

  const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));
  const activeUrl = urlList[previewIdx]?.url || "";
  const validUrls = urlList.map((x) => x.url.trim()).filter(Boolean);

  // Resetar startTime sempre que abrir a página (sempre horário atual + 1min)
  useEffect(() => { setStartTime(nowPlus(1)); }, []);

  const schedule = async () => {
    if (!validUrls.length)   return alert("Adicione ao menos uma URL de mídia");
    if (!selectedIds.length) return alert("Selecione ao menos uma conta");

    const base = new Date(startTime).getTime();
    const batches = [];
    let cursor = base;

    validUrls.forEach((url, i) => {
      if (i > 0) {
        // Intervalo em segundos com jitter
        const minSec = Math.round(intervalMin * 60);
        const maxSec = Math.round(intervalMax * 60);
        const delay  = randomBetween(minSec, maxSec) + randomBetween(0, 30);
        cursor += delay * 1000;
      }
      batches.push({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        scheduledAt: cursor,
        status: "pending",
        postType, mediaType, mediaUrl: url, caption, captions: {},
        accounts: selectedAccounts, loop, runCount: 0,
      });
    });

    await addBatch(batches);
    setUrlList([{ id: 1, url: "" }]);
    setPreviewIdx(0);
    setStartTime(nowPlus(1));
    if (navigator.serviceWorker?.controller)
      navigator.serviceWorker.controller.postMessage({ type: "FORCE_TICK" });
    alert(`✅ ${batches.length} post(s) agendado(s)!`);
  };

  // Buscar métricas da Meta API para posts publicados
  const fetchMetrics = async () => {
    setFetchingMet(true);
    const doneItems = queue.filter((x) => x.status === "done" && x.results?.some((r) => r.success && r.media_id));
    const newMetrics = { ...metrics };

    for (const item of doneItems) {
      for (const result of (item.results || [])) {
        if (!result.success || !result.media_id) continue;
        // Encontrar o token da conta correspondente
        const acc = accounts.find((a) => a.id === result.account_id || item.accounts?.find((ia) => ia.username === result.username)?.id === a.id);
        if (!acc?.access_token) continue;
        if (newMetrics[result.media_id]) continue; // já buscou

        try {
          const res = await fetch(
            `https://graph.facebook.com/v19.0/${result.media_id}/insights?metric=impressions,reach,likes_count,comments_count,shares&access_token=${acc.access_token}`
          );
          const data = await res.json();
          if (!data.error) {
            const m = {};
            (data.data || []).forEach((d) => { m[d.name] = d.values?.[0]?.value ?? d.value ?? 0; });
            newMetrics[result.media_id] = m;
          }
        } catch (_) {}
      }
    }
    setMetrics(newMetrics);
    setFetchingMet(false);
  };

  const scheduleRepeat = async () => {
    if (!repeatSel.length) return alert("Selecione posts para repetir");
    const base = new Date(startTime).getTime();
    const batches = [];
    let cursor = base;

    repeatSel.forEach((id, i) => {
      const src = queue.find((x) => x.id === id);
      if (!src) return;
      if (i > 0) {
        const minSec = Math.round(intervalMin * 60);
        const maxSec = Math.round(intervalMax * 60);
        cursor += (randomBetween(minSec, maxSec) + randomBetween(0, 30)) * 1000;
      }
      batches.push({
        id: `${Date.now()}-rep-${i}-${Math.random().toString(36).slice(2)}`,
        scheduledAt: cursor, status: "pending",
        postType: src.postType, mediaType: src.mediaType, mediaUrl: src.mediaUrl,
        caption: src.caption || caption, captions: {},
        accounts: selectedAccounts.length ? selectedAccounts : (src.accounts || []),
        loop, runCount: 0,
      });
    });

    await addBatch(batches);
    setShowRepeat(false);
    setRepeatSel([]);
    setStartTime(nowPlus(1));
    alert(`✅ ${batches.length} post(s) reagendado(s)!`);
  };

  const pendingQueue  = queue.filter((x) => x.status === "pending" || x.status === "running");
  const doneQueue     = queue.filter((x) => x.status === "done" || x.status === "error");
  const repeatablePosts = queue.filter((x) => x.status === "done");

  // Ordenar posts do dia por engajamento para sugestão de loop
  const postsWithMetrics = repeatablePosts.map((item) => {
    const mediaIds = (item.results || []).filter((r) => r.success && r.media_id).map((r) => r.media_id);
    const score = mediaIds.reduce((acc, mid) => {
      const m = metrics[mid] || {};
      return acc + (m.likes_count || 0) * 2 + (m.comments_count || 0) * 4 + (m.shares || 0) * 3 + (m.impressions || 0) * 0.01;
    }, 0);
    return { ...item, score };
  }).sort((a, b) => b.score - a.score);

  const STATUS_COLOR = { pending: "var(--accent2)", running: "var(--warning)", done: "var(--success)", error: "var(--danger)" };
  const STATUS_LABEL = { pending: "Aguardando", running: "Publicando…", done: "Publicado", error: "Erro" };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Agendamentos</div>
          <div className="page-subtitle">Agende posts com intervalo aleatório humanizado</div>
        </div>
        {queue.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={() => confirm("Limpar toda a fila?") && clearQueue()}>
            Limpar fila
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "start" }}>
        {/* ── Coluna esquerda ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Tipo de post */}
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>Tipo de post</div>
            <div style={{ display: "flex", gap: 8 }}>
              {POST_TYPES.map((t) => (
                <button key={t.value} onClick={() => setPostType(t.value)}
                  className={`type-btn ${postType === t.value ? "active" : ""}`}>
                  <span style={{ fontSize: 18, display: "block", marginBottom: 4 }}>{t.icon}</span>
                  <span className="type-label">{t.label}</span>
                  <span className="type-desc" style={{ color: postType === t.value ? "var(--accent3)" : "var(--muted)" }}>{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tipo de mídia */}
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Tipo de mídia</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[{ v: "IMAGE", l: "🖼 Imagem" }, { v: "VIDEO", l: "🎬 Vídeo" }].map(({ v, l }) => (
                <button key={v} onClick={() => setMediaType(v)}
                  className={`type-btn ${mediaType === v ? "active" : ""}`}
                  style={{ padding: "10px" }}>
                  <span style={{ fontSize: 13, fontWeight: mediaType === v ? 600 : 400 }}>{l}</span>
                </button>
              ))}
            </div>
          </div>

          {/* URLs */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>URLs das mídias ({urlList.length})</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Cada URL = 1 post, publicados em sequência</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={addUrl}>+ Adicionar URL</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {urlList.map((item, i) => (
                <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)", width: 22, flexShrink: 0, textAlign: "right", fontWeight: 600 }}>{i + 1}</span>
                  <input
                    type="url"
                    placeholder="https://files.catbox.moe/xxxxxx.jpg"
                    value={item.url}
                    onChange={(e) => setUrl(item.id, e.target.value)}
                    onFocus={() => setPreviewIdx(i)}
                    style={{ borderColor: previewIdx === i && item.url ? "var(--accent)" : undefined }}
                  />
                  {urlList.length > 1 && (
                    <button onClick={() => removeUrl(item.id)}
                      style={{ background: "none", color: "var(--muted)", fontSize: 18, padding: "0 4px", flexShrink: 0, lineHeight: 1 }}>×</button>
                  )}
                </div>
              ))}
            </div>
            <MediaPreview url={activeUrl} mediaType={mediaType} onTypeDetected={setMediaType} />
          </div>

          {/* Legenda */}
          {(postType === "FEED" || postType === "REEL") && (
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Legenda</div>
                <span style={{ fontSize: 11, color: caption.length > 2100 ? "var(--danger)" : "var(--muted)" }}>{caption.length}/2200</span>
              </div>
              <textarea
                placeholder="Escreva a legenda... #hashtags"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={2200}
                style={{ minHeight: 90 }}
              />
            </div>
          )}

          {/* Agendamento */}
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 16 }}>⏰ Agendamento</div>
            <div className="form-row">
              <label>Horário do primeiro post</label>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                min={nowPlus(0)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Intervalo mínimo (min)</label>
                <input type="number" min="0.1" max="1440" step="0.1" value={intervalMin}
                  onChange={(e) => setIntervalMin(Math.max(0.1, parseFloat(e.target.value) || 0.1))} />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Intervalo máximo (min)</label>
                <input type="number" min="0.1" max="1440" step="0.1" value={intervalMax}
                  onChange={(e) => setIntervalMax(Math.max(intervalMin, parseFloat(e.target.value) || intervalMin))} />
              </div>
            </div>
            <div style={{ padding: "10px 14px", background: "var(--bg3)", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "var(--muted)", border: "1px solid var(--border)" }}>
              Entre cada post: <strong style={{ color: "var(--text2)" }}>{intervalMin}~{intervalMax} min</strong> + até 30s aleatórios
              {validUrls.length > 1 && (
                <> · Tempo total estimado: <strong style={{ color: "var(--text2)" }}>~{Math.round((validUrls.length - 1) * ((intervalMin + intervalMax) / 2))} min</strong></>
              )}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", color: "var(--text2)", fontSize: 13, fontWeight: 400, textTransform: "none", letterSpacing: "normal", marginBottom: 0 }}>
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} style={{ width: "auto", cursor: "pointer", accentColor: "var(--accent)" }} />
              <div>
                <div style={{ fontWeight: 500 }}>🔁 Loop diário</div>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>Repetir os mesmos posts todo dia no mesmo horário</div>
              </div>
            </label>
          </div>

          {/* Botões */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ padding: "12px 28px" }} onClick={schedule}
              disabled={!validUrls.length || !selectedIds.length}>
              Agendar {validUrls.length} post(s) em {selectedIds.length} conta(s)
            </button>
            {repeatablePosts.length > 0 && (
              <button className="btn btn-ghost" onClick={() => { setShowRepeat(true); fetchMetrics(); }}>
                ↩ Repetir posts do dia
              </button>
            )}
          </div>

          {/* Modal loop inteligente */}
          {showRepeat && (
            <div className="card" style={{ border: "1px solid var(--accent)", background: "var(--bg2)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>↩ Repetir posts no próximo dia</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {fetchingMet ? "Buscando métricas da API..." : "Selecione os posts que quer repetir amanhã"}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowRepeat(false)}>Fechar</button>
              </div>
              {fetchingMet && <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 0", color: "var(--muted)", fontSize: 13 }}><div className="spinner" /> Buscando métricas...</div>}
              {!fetchingMet && (
                <>
                  {Object.keys(metrics).length > 0 && (
                    <div style={{ padding: "10px 14px", background: "rgba(124,92,252,0.08)", borderRadius: 8, marginBottom: 14, fontSize: 12, color: "var(--accent3)", border: "1px solid rgba(124,92,252,0.2)" }}>
                      ✨ Posts ordenados por engajamento (curtidas × 2 + comentários × 4 + compartilhamentos × 3)
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                    {postsWithMetrics.map((item, idx) => {
                      const sel = repeatSel.includes(item.id);
                      const mediaIds = (item.results || []).filter((r) => r.success && r.media_id).map((r) => r.media_id);
                      const m = mediaIds.reduce((acc, mid) => {
                        const mm = metrics[mid] || {};
                        return { likes: (acc.likes || 0) + (mm.likes_count || 0), comments: (acc.comments || 0) + (mm.comments_count || 0), shares: (acc.shares || 0) + (mm.shares || 0), reach: (acc.reach || 0) + (mm.reach || 0) };
                      }, {});
                      return (
                        <button key={item.id} onClick={() => setRepeatSel((p) => sel ? p.filter((x) => x !== item.id) : [...p, item.id])}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 8, border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`, background: sel ? "rgba(124,92,252,0.1)" : "var(--bg3)", textAlign: "left", width: "100%", cursor: "pointer" }}>
                          {idx === 0 && Object.keys(metrics).length > 0 && <span style={{ fontSize: 14 }}>🏆</span>}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.postType} · {item.mediaUrl?.split("/").pop() || item.mediaUrl}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, display: "flex", gap: 12 }}>
                              <span>📅 {new Date(item.scheduledAt).toLocaleString("pt-BR")}</span>
                              {m.likes > 0 && <span>❤️ {m.likes}</span>}
                              {m.comments > 0 && <span>💬 {m.comments}</span>}
                              {m.shares > 0 && <span>↗️ {m.shares}</span>}
                              {m.reach > 0 && <span>👁 {m.reach}</span>}
                              {item.score > 0 && <span style={{ color: "var(--accent3)" }}>Score: {Math.round(item.score)}</span>}
                            </div>
                          </div>
                          <div className="acc-check" style={{ border: `1.5px solid ${sel ? "var(--accent)" : "var(--border2)"}`, background: sel ? "var(--accent)" : "transparent" }}>
                            {sel && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button className="btn btn-primary" onClick={scheduleRepeat} disabled={!repeatSel.length}>
                      Agendar {repeatSel.length} post(s) para amanhã
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setRepeatSel(postsWithMetrics.slice(0, 3).map((x) => x.id))}>
                      Top 3
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setRepeatSel(postsWithMetrics.map((x) => x.id))}>
                      Todos
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Coluna direita ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Seleção de contas */}
          <div className="card" style={{ position: "sticky", top: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Contas <span style={{ color: "var(--accent3)" }}>{selectedIds.length}/{accounts.length}</span>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <button className="btn btn-ghost btn-xs" onClick={selectAll}>Todas</button>
                <button className="btn btn-ghost btn-xs" onClick={clearAll}>Limpar</button>
              </div>
            </div>
            {accounts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)", fontSize: 13 }}>Nenhuma conta conectada</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {accounts.map((acc) => {
                  const sel = selectedIds.includes(acc.id);
                  return (
                    <button key={acc.id} onClick={() => toggleAcc(acc.id)} className={`acc-pill ${sel ? "selected" : ""}`}>
                      {acc.profile_picture ? (
                        <img src={acc.profile_picture} alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                          onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }} />
                      ) : null}
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), #9b4dfc)", display: acc.profile_picture ? "none" : "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                        {(acc.username || "?")[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: sel ? "var(--accent3)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{acc.username}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>{acc.account_type}</div>
                      </div>
                      <div className="acc-check">
                        {sel && <span style={{ color: "#fff", fontSize: 9 }}>✓</span>}
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
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>
                Fila ativa ({pendingQueue.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingQueue.map((item) => (
                  <div key={item.id} className={`queue-item ${item.status}`}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <span className={`${item.status === "running" ? "pulse" : ""}`}
                        style={{ fontSize: 8, color: STATUS_COLOR[item.status], lineHeight: 1 }}>⬤</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: STATUS_COLOR[item.status] }}>{STATUS_LABEL[item.status]}</span>
                      {item.loop && <span className="badge badge-purple" style={{ fontSize: 10, padding: "1px 7px" }}>LOOP</span>}
                      <span className="badge badge-gray" style={{ marginLeft: "auto", fontSize: 10 }}>{item.postType}</span>
                      <button onClick={() => removeItem(item.id)} style={{ background: "none", color: "var(--muted)", fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>
                      {item.mediaUrl?.split("/").pop() || item.mediaUrl}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text2)" }}>
                      🕐 {new Date(item.scheduledAt).toLocaleString("pt-BR")}
                    </div>
                    {item.accounts?.length > 0 && (
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.accounts.map((a) => `@${a.username}`).join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Concluídos recentes */}
          {doneQueue.length > 0 && (
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
                Concluídos ({doneQueue.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {doneQueue.slice(0, 8).map((item) => (
                  <div key={item.id} className={`queue-item ${item.status}`} style={{ padding: "8px 11px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 8, color: STATUS_COLOR[item.status] }}>⬤</span>
                      <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text2)" }}>
                        {item.mediaUrl?.split("/").pop() || item.mediaUrl}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>{item.postType}</span>
                      <button onClick={() => removeItem(item.id)} style={{ background: "none", color: "var(--muted)", fontSize: 14, padding: 0 }}>×</button>
                    </div>
                    {item.status === "error" && (
                      <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 3 }}>{item.error}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {queue.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)", fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>◷</div>
              Nenhum post agendado ainda
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
