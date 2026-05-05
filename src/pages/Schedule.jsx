import { useState, useEffect, useCallback } from "react";
import { useAccounts, useHistory } from "../App.jsx";
import MediaPreview from "../MediaPreview.jsx";
import { dbGetAll, dbPut, dbPutMany, dbDelete, dbClear } from "../useDB.js";

const POST_TYPES = [
  { value: "FEED",  label: "Feed",  desc: "Foto ou vídeo" },
  { value: "REEL",  label: "Reel",  desc: "Foto ou vídeo curto" },
  { value: "STORY", label: "Story", desc: "Desaparece em 24h" },
];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomDelay(minMin, maxMin) {
  return randomBetween(minMin, maxMin) * 60 + randomBetween(0, 59);
}

// ─── Hook de fila — IndexedDB + escuta do SW ─────────────────────────────────
function useScheduler(addEntry) {
  const [queue, setQueue] = useState([]);

  const reload = useCallback(async () => {
    const all = await dbGetAll("queue");
    all.sort((a, b) => a.scheduledAt - b.scheduledAt);
    setQueue(all);
  }, []);

  // Carrega inicial + escuta atualizações do SW
  useEffect(() => {
    reload();
    const handler = () => reload();
    window.addEventListener("sw:queue-update", handler);
    return () => window.removeEventListener("sw:queue-update", handler);
  }, []);

  // Tick local — fallback caso SW não esteja disponível
  useEffect(() => {
    const tick = async () => {
      const all = await dbGetAll("queue");
      const now = Date.now();
      const due = all.filter((x) => x.scheduledAt <= now && x.status === "pending");
      if (due.length === 0) return;

      // Verifica se SW está ativo
      const swActive = navigator.serviceWorker?.controller != null;
      if (swActive) return; // SW cuida disso

      for (const item of due) {
        await dbPut("queue", { ...item, status: "running" });
        setQueue((prev) => prev.map((x) => x.id === item.id ? { ...x, status: "running" } : x));

        try {
          const res = await fetch("/api/publish", {
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

          await addEntry({ id: Date.now(), post_type: item.postType, media_url: item.mediaUrl, media_type: item.mediaType, default_caption: item.caption, delay_seconds: 0, results, created_at: new Date().toISOString() });

          if (item.loop) {
            const next = item.scheduledAt + 24 * 60 * 60 * 1000;
            await dbPut("queue", { ...item, status: "pending", scheduledAt: next, runCount: (item.runCount || 0) + 1, lastResults: results });
          } else {
            await dbPut("queue", { ...item, status: "done", results });
          }
        } catch (err) {
          await dbPut("queue", { ...item, status: "error", error: err.message });
        }
      }
      reload();
    };

    const interval = setInterval(tick, 15000);
    tick();
    return () => clearInterval(interval);
  }, []);

  const addBatch = async (batch) => {
    await dbPutMany("queue", batch);
    reload();
  };

  const removeItem = async (id) => {
    await dbDelete("queue", id);
    setQueue((prev) => prev.filter((x) => x.id !== id));
  };

  const clearQueue = async () => {
    await dbClear("queue");
    setQueue([]);
  };

  return { queue, addBatch, removeItem, clearQueue, reload };
}

// ─── Componente principal ────────────────────────────────────────────────────
export default function Schedule() {
  const { accounts } = useAccounts();
  const { addEntry } = useHistory();
  const { queue, addBatch, removeItem, clearQueue } = useScheduler(addEntry);

  const [postType, setPostType]   = useState("FEED");
  const [mediaType, setMediaType] = useState("IMAGE");
  const [caption, setCaption]     = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [loop, setLoop]           = useState(false);

  const [urlList, setUrlList]     = useState([{ id: 1, url: "" }]);
  const [previewIdx, setPreviewIdx] = useState(0); // qual URL está em preview

  const [startTime, setStartTime] = useState(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() + 5, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [intervalMin, setIntervalMin] = useState(10);
  const [intervalMax, setIntervalMax] = useState(20);

  const [showRepeat, setShowRepeat]       = useState(false);
  const [repeatSelected, setRepeatSelected] = useState([]);

  const toggleAccount = (id) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll = () => setSelectedIds(accounts.map((a) => a.id));
  const clearAll  = () => setSelectedIds([]);

  const addUrl    = () => setUrlList((p) => [...p, { id: Date.now(), url: "" }]);
  const removeUrl = (id) => setUrlList((p) => p.filter((x) => x.id !== id));
  const setUrl    = (id, val) => setUrlList((p) => p.map((x) => x.id === id ? { ...x, url: val } : x));

  const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));
  const activePreviewUrl = urlList[previewIdx]?.url || "";

  const schedule = async () => {
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

    await addBatch(batches);
    setUrlList([{ id: 1, url: "" }]);
    setPreviewIdx(0);

    // Avisar o SW para fazer um tick imediato
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "FORCE_TICK" });
    }

    alert(`${batches.length} post(s) agendado(s)!`);
  };

  const scheduleRepeat = async () => {
    if (repeatSelected.length === 0) return alert("Selecione ao menos um post para repetir");
    const base = new Date(startTime).getTime();
    const batches = [];
    let cursor = base;

    repeatSelected.forEach((id, i) => {
      const src = queue.find((x) => x.id === id);
      if (!src) return;
      if (i > 0) cursor += randomDelay(intervalMin, intervalMax) * 1000;
      batches.push({
        id: `${Date.now()}-rep-${i}`,
        scheduledAt: cursor,
        status: "pending",
        postType: src.postType,
        mediaType: src.mediaType,
        mediaUrl: src.mediaUrl,
        caption: src.caption || caption,
        captions: {},
        accounts: selectedAccounts.length > 0 ? selectedAccounts : (src.accounts || []),
        loop,
        runCount: 0,
      });
    });

    await addBatch(batches);
    setShowRepeat(false);
    setRepeatSelected([]);
    alert(`${batches.length} post(s) reagendado(s)!`);
  };

  const statusColor = { pending: "var(--accent-light)", running: "var(--warning)", done: "var(--success)", error: "var(--danger)" };
  const statusLabel = { pending: "Aguardando", running: "Publicando…", done: "Publicado", error: "Erro" };

  const pendingQueue = queue.filter((x) => x.status === "pending" || x.status === "running");
  const doneQueue    = queue.filter((x) => x.status === "done" || x.status === "error");
  const repeatablePosts = queue.filter((x) => x.status === "done" || x.status === "pending");

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Agendamentos</div>
        {queue.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={() => confirm("Limpar toda a fila?") && clearQueue()}>
            Limpar fila
          </button>
        )}
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

          {/* Tipo de mídia */}
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

          {/* URLs com preview */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>URLs das mídias ({urlList.length})</div>
              <button className="btn btn-ghost btn-sm" onClick={addUrl}>+ Adicionar URL</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {urlList.map((item, i) => (
                <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)", width: 20, flexShrink: 0, textAlign: "right" }}>{i + 1}.</span>
                  <input
                    type="url"
                    placeholder="https://files.catbox.moe/xxxxxx.jpg"
                    value={item.url}
                    onChange={(e) => setUrl(item.id, e.target.value)}
                    onFocus={() => setPreviewIdx(i)}
                    style={{ flex: 1, borderColor: previewIdx === i && item.url ? "var(--accent)" : undefined }}
                  />
                  {urlList.length > 1 && (
                    <button onClick={() => removeUrl(item.id)} style={{ background: "none", color: "var(--danger)", fontSize: 16, padding: "0 4px", flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
            </div>

            {/* Preview da URL selecionada */}
            <MediaPreview
              url={activePreviewUrl}
              mediaType={mediaType}
              onTypeDetected={(t) => setMediaType(t)}
            />

            {urlList.length > 1 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
                Clique em uma URL para ver o preview. Cada URL vira um post separado.
              </div>
            )}
            {urlList.length === 1 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: activePreviewUrl ? 8 : 10 }}>
                Cada URL vira um post separado, publicados em sequência com o intervalo configurado.
              </div>
            )}
          </div>

          {/* Legenda */}
          {(postType === "FEED" || postType === "REEL") && (
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <label style={{ margin: 0 }}>Legenda (usada em todos os posts)</label>
                <span style={{ fontSize: 11, color: caption.length > 2100 ? "var(--danger)" : "var(--muted)" }}>{caption.length}/2200</span>
              </div>
              <textarea
                placeholder="Escreva a legenda... #hashtags"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                style={{ minHeight: 80 }}
                maxLength={2200}
              />
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
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", color: "var(--text)", fontSize: 13 }}>
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

        {/* Coluna direita */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Contas */}
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
