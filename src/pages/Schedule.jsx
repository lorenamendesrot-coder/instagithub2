import { useState, useEffect, useRef } from "react";
import { useAccounts, useHistory } from "../App.jsx";

const POST_TYPES = [
  { value: "FEED",  label: "Feed",  desc: "Foto ou vídeo" },
  { value: "REEL",  label: "Reel",  desc: "Foto ou vídeo curto" },
  { value: "STORY", label: "Story", desc: "Desaparece em 24h" },
];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay(minMin, maxMin) {
  const minutes = randomBetween(minMin, maxMin);
  const seconds = randomBetween(0, 59);
  return minutes * 60 + seconds;
}

function useScheduler(addEntry) {
  const [queue, setQueue] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ig_queue") || "[]"); } catch { return []; }
  });
  const timerRef = useRef(null);

  const saveQueue = (q) => {
    localStorage.setItem("ig_queue", JSON.stringify(q));
    setQueue(q);
  };

  const addBatch = (batch) => {
    const q = JSON.parse(localStorage.getItem("ig_queue") || "[]");
    saveQueue([...q, ...batch]);
  };

  const removeItem = (id) => {
    const q = JSON.parse(localStorage.getItem("ig_queue") || "[]");
    saveQueue(q.filter((x) => x.id !== id));
  };

  const clearQueue = () => saveQueue([]);

  // Tick — verifica a fila a cada 10s
  useEffect(() => {
    const tick = async () => {
      const q = JSON.parse(localStorage.getItem("ig_queue") || "[]");
      const now = Date.now();
      const due = q.filter((item) => item.scheduledAt <= now && item.status === "pending");

      for (const item of due) {
        // Marca como em execução
        const running = JSON.parse(localStorage.getItem("ig_queue") || "[]");
        const updated = running.map((x) => x.id === item.id ? { ...x, status: "running" } : x);
        localStorage.setItem("ig_queue", JSON.stringify(updated));
        setQueue([...updated]);

        try {
          const res = await fetch("/api/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accounts: item.accounts,
              media_url: item.mediaUrl,
              media_type: item.mediaType,
              post_type: item.postType,
              captions: item.captions,
              default_caption: item.caption,
              delay_seconds: 0,
            }),
          });
          const data = await res.json();
          const results = data.results || [];

          addEntry({ id: Date.now(), post_type: item.postType, media_url: item.mediaUrl, media_type: item.mediaType, default_caption: item.caption, delay_seconds: 0, results, created_at: new Date().toISOString() });

          const afterPost = JSON.parse(localStorage.getItem("ig_queue") || "[]");

          if (item.loop) {
            // reagenda para o dia seguinte no mesmo horário
            const next = item.scheduledAt + 24 * 60 * 60 * 1000;
            const looped = afterPost.map((x) => x.id === item.id ? { ...x, status: "pending", scheduledAt: next, runCount: (x.runCount || 0) + 1 } : x);
            localStorage.setItem("ig_queue", JSON.stringify(looped));
            setQueue([...looped]);
          } else {
            const done = afterPost.map((x) => x.id === item.id ? { ...x, status: "done", results } : x);
            localStorage.setItem("ig_queue", JSON.stringify(done));
            setQueue([...done]);
          }
        } catch (err) {
          const afterErr = JSON.parse(localStorage.getItem("ig_queue") || "[]");
          const failed = afterErr.map((x) => x.id === item.id ? { ...x, status: "error", error: err.message } : x);
          localStorage.setItem("ig_queue", JSON.stringify(failed));
          setQueue([...failed]);
        }
      }

      // Re-sync state
      const fresh = JSON.parse(localStorage.getItem("ig_queue") || "[]");
      setQueue([...fresh]);
    };

    timerRef.current = setInterval(tick, 10000);
    tick();
    return () => clearInterval(timerRef.current);
  }, []);

  return { queue, addBatch, removeItem, clearQueue };
}

export default function Schedule() {
  const { accounts } = useAccounts();
  const { addEntry } = useHistory();
  const { queue, addBatch, removeItem, clearQueue } = useScheduler(addEntry);

  // Form state
  const [postType, setPostType]     = useState("FEED");
  const [mediaType, setMediaType]   = useState("IMAGE");
  const [caption, setCaption]       = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [loop, setLoop]             = useState(false);

  // Lote de URLs
  const [urlList, setUrlList]       = useState([{ id: 1, url: "" }]);

  // Agendamento
  const [startTime, setStartTime]   = useState(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() + 5, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [intervalMin, setIntervalMin] = useState(10);
  const [intervalMax, setIntervalMax] = useState(20);

  // Repetir posts anteriores
  const [showRepeat, setShowRepeat]   = useState(false);
  const [repeatSource, setRepeatSource] = useState(null); // item da fila para repetir
  const [repeatSelected, setRepeatSelected] = useState([]);

  const toggleAccount = (id) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll = () => setSelectedIds(accounts.map((a) => a.id));
  const clearAll  = () => setSelectedIds([]);

  const addUrl  = () => setUrlList((p) => [...p, { id: Date.now(), url: "" }]);
  const removeUrl = (id) => setUrlList((p) => p.filter((x) => x.id !== id));
  const setUrl  = (id, val) => setUrlList((p) => p.map((x) => x.id === id ? { ...x, url: val } : x));

  const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));

  const schedule = () => {
    const urls = urlList.map((x) => x.url.trim()).filter(Boolean);
    if (urls.length === 0) return alert("Adicione ao menos uma URL de mídia");
    if (selectedIds.length === 0) return alert("Selecione ao menos uma conta");

    const base = new Date(startTime).getTime();
    const batches = [];
    let cursor = base;

    urls.forEach((url, i) => {
      if (i > 0) cursor += randomDelay(intervalMin, intervalMax) * 1000;
      batches.push({
        id: `${Date.now()}-${i}`,
        scheduledAt: cursor,
        status: "pending",
        postType, mediaType, mediaUrl: url, caption,
        captions: {},
        accounts: selectedAccounts,
        loop,
        runCount: 0,
      });
    });

    addBatch(batches);
    setUrlList([{ id: 1, url: "" }]);
    alert(`${batches.length} post(s) agendado(s)!`);
  };

  const scheduleRepeat = () => {
    if (!repeatSource || repeatSelected.length === 0) return alert("Selecione ao menos um post para repetir");
    const urls = repeatSelected.map((id) => {
      const item = queue.find((x) => x.id === id);
      return item?.mediaUrl;
    }).filter(Boolean);

    const base = new Date(startTime).getTime();
    const batches = [];
    let cursor = base;

    urls.forEach((url, i) => {
      if (i > 0) cursor += randomDelay(intervalMin, intervalMax) * 1000;
      const src = queue.find((x) => x.mediaUrl === url);
      batches.push({
        id: `${Date.now()}-rep-${i}`,
        scheduledAt: cursor,
        status: "pending",
        postType: src?.postType || postType,
        mediaType: src?.mediaType || mediaType,
        mediaUrl: url,
        caption: src?.caption || caption,
        captions: {},
        accounts: selectedAccounts.length > 0 ? selectedAccounts : (src?.accounts || []),
        loop,
        runCount: 0,
      });
    });

    addBatch(batches);
    setShowRepeat(false);
    setRepeatSelected([]);
    alert(`${batches.length} post(s) reagendado(s)!`);
  };

  const statusColor = { pending: "var(--accent-light)", running: "var(--warning)", done: "var(--success)", error: "var(--danger)" };
  const statusLabel = { pending: "Aguardando", running: "Publicando…", done: "Publicado", error: "Erro" };

  const pendingQueue = queue.filter((x) => x.status === "pending" || x.status === "running");
  const doneQueue    = queue.filter((x) => x.status === "done" || x.status === "error");

  // Posts únicos para repetir (de lotes anteriores)
  const repeatablePosts = queue.filter((x) => x.status === "done" || x.status === "pending");

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Agendamentos</div>
        {queue.length > 0 && <button className="btn btn-danger btn-sm" onClick={() => confirm("Limpar toda a fila?") && clearQueue()}>Limpar fila</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Tipo */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Tipo de post</div>
            <div style={{ display: "flex", gap: 8 }}>
              {POST_TYPES.map((t) => (
                <button key={t.value} onClick={() => setPostType(t.value)} style={{
                  flex: 1, padding: "11px 8px", borderRadius: 8, border: "1px solid",
                  borderColor: postType === t.value ? "var(--accent)" : "var(--border)",
                  background: postType === t.value ? "#7c5cfc18" : "var(--bg3)",
                  color: postType === t.value ? "var(--accent-light)" : "var(--muted)",
                  textAlign: "center", transition: "all 0.12s",
                }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{t.label}</div>
                  <div style={{ fontSize: 11, marginTop: 2 }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Mídia type */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Tipo de mídia</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["IMAGE", "VIDEO"].map((t) => (
                <button key={t} onClick={() => setMediaType(t)} style={{
                  flex: 1, padding: "8px", borderRadius: 8, border: "1px solid",
                  borderColor: mediaType === t ? "var(--accent)" : "var(--border)",
                  background: mediaType === t ? "#7c5cfc18" : "var(--bg3)",
                  color: mediaType === t ? "var(--accent-light)" : "var(--muted)",
                  fontSize: 13, fontWeight: mediaType === t ? 500 : 400,
                }}>
                  {t === "IMAGE" ? "🖼 Imagem" : "🎬 Vídeo"}
                </button>
              ))}
            </div>
          </div>

          {/* URLs */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>URLs das mídias ({urlList.length})</div>
              <button className="btn btn-ghost btn-sm" onClick={addUrl}>+ Adicionar URL</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {urlList.map((item, i) => (
                <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)", width: 20, flexShrink: 0, textAlign: "right" }}>{i + 1}.</span>
                  <input type="url" placeholder="https://files.catbox.moe/xxxxxx.jpg" value={item.url} onChange={(e) => setUrl(item.id, e.target.value)} style={{ flex: 1 }} />
                  {urlList.length > 1 && (
                    <button onClick={() => removeUrl(item.id)} style={{ background: "none", color: "var(--danger)", fontSize: 16, padding: "0 4px", flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
              Cada URL vira um post separado, publicados em sequência com o intervalo configurado.
            </div>
          </div>

          {/* Legenda */}
          {(postType === "FEED" || postType === "REEL") && (
            <div className="card">
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Legenda (usada em todos os posts)</label>
                <textarea placeholder="Escreva a legenda... #hashtags" value={caption} onChange={(e) => setCaption(e.target.value)} style={{ minHeight: 80 }} />
              </div>
            </div>
          )}

          {/* Agendamento */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 14 }}>⏰ Agendamento</div>
            <div className="form-row">
              <label>Horário do primeiro post</label>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Intervalo mínimo (min)</label>
                <input type="number" min="1" max="1440" value={intervalMin} onChange={(e) => setIntervalMin(Math.max(1, parseInt(e.target.value) || 1))} />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Intervalo máximo (min)</label>
                <input type="number" min="1" max="1440" value={intervalMax} onChange={(e) => setIntervalMax(Math.max(intervalMin, parseInt(e.target.value) || intervalMin))} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--bg3)", padding: "10px 14px", borderRadius: 8, marginBottom: 14 }}>
              Entre cada post: <strong style={{ color: "var(--text)" }}>{intervalMin}~{intervalMax} minutos</strong> + segundos aleatórios para parecer mais humano.
            </div>

            {/* Loop */}
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", color: "var(--text)", fontSize: 13, marginBottom: 0 }}>
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} style={{ width: "auto", cursor: "pointer" }} />
              <span>🔁 Loop diário — repetir os mesmos posts todo dia no mesmo horário</span>
            </label>
          </div>

          {/* Botões */}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" style={{ padding: "11px 28px", fontSize: 14 }} onClick={schedule}>
              Agendar {urlList.filter((x) => x.url.trim()).length} post(s)
            </button>
            {repeatablePosts.length > 0 && (
              <button className="btn btn-ghost" style={{ padding: "11px 20px", fontSize: 14 }} onClick={() => setShowRepeat(true)}>
                ↩ Repetir posts anteriores
              </button>
            )}
          </div>

          {/* Modal repetir */}
          {showRepeat && (
            <div className="card" style={{ border: "1px solid var(--accent)", background: "var(--bg2)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ fontWeight: 500 }}>Selecione quais posts repetir</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowRepeat(false)}>Fechar</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                {repeatablePosts.map((item) => {
                  const sel = repeatSelected.includes(item.id);
                  return (
                    <button key={item.id} onClick={() => setRepeatSelected((p) => sel ? p.filter((x) => x !== item.id) : [...p, item.id])} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "1px solid",
                      borderColor: sel ? "var(--accent)" : "var(--border)", background: sel ? "#7c5cfc12" : "var(--bg3)", textAlign: "left", width: "100%",
                    }}>
                      <span style={{ fontSize: 11, color: "var(--muted)", width: 50, flexShrink: 0 }}>{item.postType}</span>
                      <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>{item.mediaUrl}</span>
                      <div style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${sel ? "var(--accent)" : "var(--border)"}`, background: sel ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {sel && <span style={{ color: "#fff", fontSize: 9 }}>✓</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
              <button className="btn btn-primary" onClick={scheduleRepeat} disabled={repeatSelected.length === 0}>
                Reagendar {repeatSelected.length} post(s)
              </button>
            </div>
          )}
        </div>

        {/* Coluna direita: contas + fila */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Seleção de contas */}
          <div className="card" style={{ position: "sticky", top: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Contas <span style={{ color: "var(--muted)", fontWeight: 400 }}>{selectedIds.length}/{accounts.length}</span></div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={selectAll}>Todas</button>
                <button className="btn btn-ghost btn-sm" onClick={clearAll}>Limpar</button>
              </div>
            </div>
            {accounts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)", fontSize: 13 }}>Nenhuma conta conectada</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {accounts.map((acc) => {
                  const sel = selectedIds.includes(acc.id);
                  return (
                    <button key={acc.id} onClick={() => toggleAccount(acc.id)} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8, border: "1px solid",
                      borderColor: sel ? "var(--accent)" : "var(--border)", background: sel ? "#7c5cfc12" : "var(--bg3)", textAlign: "left", width: "100%", transition: "all 0.12s",
                    }}>
                      {acc.profile_picture ? <img src={acc.profile_picture} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} /> : <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--bg2)", flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: sel ? "var(--accent-light)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{acc.username}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{acc.account_type}</div>
                      </div>
                      <div style={{ width: 15, height: 15, borderRadius: "50%", flexShrink: 0, border: `1.5px solid ${sel ? "var(--accent)" : "var(--border)"}`, background: sel ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Fila ativa ({pendingQueue.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingQueue.map((item) => (
                  <div key={item.id} style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: statusColor[item.status] }}>● {statusLabel[item.status]}</span>
                      {item.loop && <span style={{ fontSize: 10, color: "var(--accent-light)", background: "#7c5cfc20", padding: "1px 7px", borderRadius: 10 }}>LOOP</span>}
                      <span className="badge badge-gray" style={{ marginLeft: "auto" }}>{item.postType}</span>
                      <button onClick={() => removeItem(item.id)} style={{ background: "none", color: "var(--muted)", fontSize: 14, padding: 0 }}>×</button>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>{item.mediaUrl}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      🕐 {new Date(item.scheduledAt).toLocaleString("pt-BR")}
                      {item.runCount > 0 && <span style={{ marginLeft: 8, color: "var(--accent-light)" }}>({item.runCount}ª execução)</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                      {item.accounts.map((a) => `@${a.username}`).join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Concluídos */}
          {doneQueue.length > 0 && (
            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Concluídos ({doneQueue.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {doneQueue.slice(0, 10).map((item) => (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--bg3)", borderRadius: 7 }}>
                    <span style={{ fontSize: 11, color: statusColor[item.status] }}>●</span>
                    <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)" }}>{item.mediaUrl}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{item.postType}</span>
                    <button onClick={() => removeItem(item.id)} style={{ background: "none", color: "var(--muted)", fontSize: 13, padding: 0 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {queue.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)", fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>◷</div>
              Nenhum post agendado ainda.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
