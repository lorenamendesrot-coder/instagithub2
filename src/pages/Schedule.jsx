import { useState, useEffect, useCallback, useRef } from "react";
import { useAccounts, useHistory } from "../App.jsx";
import MediaPreview from "../MediaPreview.jsx";
import Modal from "../Modal.jsx";
import { dbGetAll, dbPut, dbPutMany, dbDelete, dbClear } from "../useDB.js";

const POST_TYPES = [
  { value: "FEED",  label: "Feed",  desc: "Foto ou vídeo", icon: "🖼" },
  { value: "REEL",  label: "Reel",  desc: "Vídeo curto",   icon: "🎬" },
  { value: "STORY", label: "Story", desc: "24 horas",      icon: "⭕" },
];

// Data atual + N minutos, formato datetime-local, preservando fuso horário local
function nowPlus(minutes = 1) {
  const d = new Date(Date.now() + minutes * 60000);
  d.setSeconds(0, 0);
  // Usa offset local para garantir que o datetime-local seja no fuso do usuário
  const offset = d.getTimezoneOffset() * 60000;
  const local  = new Date(d.getTime() - offset);
  return local.toISOString().slice(0, 16);
}

// Converte datetime-local para timestamp UTC correto (respeita fuso)
function localToTimestamp(localStr) {
  // new Date(localStr) interpreta sem fuso — precisamos adicionar o offset
  const d = new Date(localStr);
  return d.getTime();
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Hook do scheduler — runningRef CORRETO com useRef
function useScheduler(addEntry) {
  const [queue, setQueue] = useState([]);
  const runningRef = useRef(new Set()); // FIX: useRef em vez de objeto simples

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

  // Tick local — roda sempre a cada 10s
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
  const updateItem = async (item) => { await dbPut("queue", item); reload(); };
  const removeItem = async (id) => { await dbDelete("queue", id); setQueue((p) => p.filter((x) => x.id !== id)); };
  const clearQueue = async () => { await dbClear("queue"); setQueue([]); };
  return { queue, addBatch, updateItem, removeItem, clearQueue, reload };
}

export default function Schedule() {
  const { accounts } = useAccounts();
  const { addEntry }  = useHistory();
  const { queue, addBatch, updateItem, removeItem, clearQueue } = useScheduler(addEntry);

  const [postType,    setPostType]    = useState("FEED");
  const [mediaType,   setMediaType]   = useState("IMAGE");
  const [caption,     setCaption]     = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [urlList,     setUrlList]     = useState([{ id: 1, url: "" }]);
  const [previewIdx,  setPreviewIdx]  = useState(0);
  const [startTime,   setStartTime]   = useState(nowPlus(1));
  const [intervalMin, setIntervalMin] = useState(0.5);
  const [intervalMax, setIntervalMax] = useState(1);
  const [loop,        setLoop]        = useState(false);

  // Modal de edição
  const [editModal,  setEditModal]   = useState(null); // item da fila sendo editado
  const [editTime,   setEditTime]    = useState("");
  const [editCaption,setEditCaption] = useState("");

  // Modal de confirmação
  const [confirmModal, setConfirmModal] = useState(null);

  const toggleAcc = (id) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll = () => setSelectedIds(accounts.map((a) => a.id));
  const clearAll  = () => setSelectedIds([]);

  const addUrl    = () => setUrlList((p) => [...p, { id: Date.now(), url: "" }]);
  const removeUrl = (id) => setUrlList((p) => p.filter((x) => x.id !== id));
  const setUrl    = (id, v) => setUrlList((p) => p.map((x) => x.id === id ? { ...x, url: v } : x));

  const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));
  const activeUrl = urlList[previewIdx]?.url || "";
  const validUrls = urlList.map((x) => x.url.trim()).filter(Boolean);

  useEffect(() => { setStartTime(nowPlus(1)); }, []);

  const schedule = async () => {
    if (!validUrls.length)    return alert("Adicione ao menos uma URL de mídia");
    if (!selectedIds.length)  return alert("Selecione ao menos uma conta");
    if (!startTime)           return alert("Defina o horário de início");

    const startTs = localToTimestamp(startTime);
    if (startTs <= Date.now()) return alert("O horário precisa ser no futuro");

    const items = [];
    let ts = startTs;

    for (let u = 0; u < validUrls.length; u++) {
      if (u > 0) {
        const delayMin = Math.round(intervalMin * 60000);
        const delayMax = Math.round(intervalMax * 60000);
        ts += randomBetween(delayMin, delayMax);
      }
      items.push({
        id: Date.now() + u,
        postType, mediaType, mediaUrl: validUrls[u],
        caption, accounts: selectedAccounts,
        scheduledAt: ts,
        status: "pending",
        loop,
        runCount: 0,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, // salva fuso
        createdAt: new Date().toISOString(),
      });
    }

    await addBatch(items);
    setUrlList([{ id: 1, url: "" }]);
    setCaption("");
    setSelectedIds([]);
  };

  const openEdit = (item) => {
    setEditModal(item);
    // Converter timestamp de volta para datetime-local
    const d = new Date(item.scheduledAt);
    const offset = d.getTimezoneOffset() * 60000;
    const local = new Date(d.getTime() - offset);
    setEditTime(local.toISOString().slice(0, 16));
    setEditCaption(item.caption || "");
  };

  const saveEdit = async () => {
    if (!editModal) return;
    const newTs = localToTimestamp(editTime);
    await updateItem({ ...editModal, scheduledAt: newTs, caption: editCaption, status: "pending" });
    setEditModal(null);
  };

  const STATUS_INFO = {
    pending: { label: "Agendado", color: "var(--info)",    bg: "rgba(56,189,248,0.1)"  },
    running: { label: "Rodando",  color: "var(--warning)", bg: "rgba(245,158,11,0.1)"  },
    done:    { label: "Feito",    color: "var(--success)", bg: "rgba(34,197,94,0.08)"   },
    error:   { label: "Erro",     color: "var(--danger)",  bg: "rgba(239,68,68,0.08)"  },
  };

  const pendingCount = queue.filter((q) => q.status === "pending").length;
  const doneCount    = queue.filter((q) => q.status === "done").length;
  const errorCount   = queue.filter((q) => q.status === "error").length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Agendamentos</div>
          <div className="page-subtitle">
            {pendingCount} pendente(s) · {doneCount} feito(s) · {errorCount > 0 && <span style={{ color: "var(--danger)" }}>{errorCount} erro(s)</span>}
          </div>
        </div>
        {queue.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmModal({ type: "clearQueue" })}>
            Limpar fila
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }} className="schedule-grid">

        {/* ── Formulário ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Tipo de post */}
          <div className="card">
            <div style={{ marginBottom: 12, fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Tipo de post</div>
            <div style={{ display: "flex", gap: 8 }}>
              {POST_TYPES.map((t) => (
                <button key={t.value} onClick={() => setPostType(t.value)} style={{
                  flex: 1, padding: "10px 6px", borderRadius: 8, border: "1px solid",
                  borderColor: postType === t.value ? "var(--accent)" : "var(--border)",
                  background: postType === t.value ? "#7c5cfc18" : "var(--bg3)",
                  color: postType === t.value ? "var(--accent-light)" : "var(--muted)",
                  textAlign: "center", transition: "all 0.12s",
                }}>
                  <div style={{ fontSize: 16 }}>{t.icon}</div>
                  <div style={{ fontWeight: 500, fontSize: 12 }}>{t.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* URLs */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>URLs de mídia</div>
              <button className="btn btn-ghost btn-xs" onClick={addUrl}>+ Adicionar</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {urlList.map((item, idx) => (
                <div key={item.id}>
                  <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 18, textAlign: "right" }}>{idx + 1}.</span>
                    <input
                      type="url"
                      placeholder="https://files.catbox.moe/..."
                      value={item.url}
                      onChange={(e) => setUrl(item.id, e.target.value)}
                      onFocus={() => setPreviewIdx(idx)}
                      style={{ flex: 1, fontSize: 12, padding: "8px 10px" }}
                    />
                    {urlList.length > 1 && (
                      <button className="btn btn-ghost btn-xs" onClick={() => removeUrl(item.id)} style={{ color: "var(--danger)", flexShrink: 0 }}>✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {activeUrl && (
              <div style={{ marginTop: 12 }}>
                <MediaPreview url={activeUrl} mediaType={mediaType} onTypeDetected={setMediaType} />
              </div>
            )}
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              {["IMAGE", "VIDEO"].map((t) => (
                <button key={t} onClick={() => setMediaType(t)} style={{
                  flex: 1, padding: "7px", borderRadius: 8, border: "1px solid",
                  borderColor: mediaType === t ? "var(--accent)" : "var(--border)",
                  background: mediaType === t ? "#7c5cfc18" : "var(--bg3)",
                  color: mediaType === t ? "var(--accent-light)" : "var(--muted)",
                  fontSize: 12, fontWeight: mediaType === t ? 500 : 400,
                }}>
                  {t === "IMAGE" ? "🖼 Imagem" : "🎬 Vídeo"}
                </button>
              ))}
            </div>
          </div>

          {/* Legenda */}
          {(postType === "FEED" || postType === "REEL") && (
            <div className="card">
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Legenda</label>
                <textarea
                  placeholder="Escreva a legenda... #hashtags"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  style={{ minHeight: 80, fontSize: 13 }}
                  maxLength={2200}
                />
              </div>
            </div>
          )}

          {/* Horário e intervalo */}
          <div className="card">
            <div className="form-row">
              <label>Início do agendamento</label>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                Fuso local: {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </div>
            </div>

            {urlList.length > 1 && (
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Intervalo entre URLs (minutos)</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="number" min="0.1" max="1440" step="0.1" value={intervalMin}
                    onChange={(e) => setIntervalMin(parseFloat(e.target.value) || 0.5)}
                    style={{ maxWidth: 90, fontSize: 13 }} />
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>até</span>
                  <input type="number" min="0.1" max="1440" step="0.1" value={intervalMax}
                    onChange={(e) => setIntervalMax(parseFloat(e.target.value) || 1)}
                    style={{ maxWidth: 90, fontSize: 13 }} />
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>min</span>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} style={{ width: "auto" }} />
                <span style={{ fontSize: 13, color: "var(--text2)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                  Repetir diariamente (loop 24h)
                </span>
              </label>
            </div>
          </div>

          {/* Contas */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Contas <span style={{ color: "var(--text2)" }}>({selectedIds.length}/{accounts.length})</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-ghost btn-xs" onClick={selectAll}>Todas</button>
                <button className="btn btn-ghost btn-xs" onClick={clearAll}>Limpar</button>
              </div>
            </div>
            {accounts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "14px 0", color: "var(--muted)", fontSize: 12 }}>Nenhuma conta conectada</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {accounts.map((acc) => {
                  const sel = selectedIds.includes(acc.id);
                  return (
                    <button key={acc.id} onClick={() => toggleAcc(acc.id)} style={{
                      display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 8, border: "1px solid",
                      borderColor: sel ? "var(--accent)" : "var(--border)", background: sel ? "#7c5cfc12" : "var(--bg3)", textAlign: "left", width: "100%", transition: "all 0.12s",
                    }}>
                      {acc.profile_picture
                        ? <img src={acc.profile_picture} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--bg2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--muted)" }}>
                            {(acc.username || "?")[0].toUpperCase()}
                          </div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: sel ? "var(--accent-light)" : "var(--text)" }}>@{acc.username}</div>
                      </div>
                      <div style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${sel ? "var(--accent)" : "var(--border)"}`, background: sel ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {sel && <span style={{ color: "#fff", fontSize: 9 }}>✓</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button className="btn btn-primary" onClick={schedule} disabled={!validUrls.length || !selectedIds.length}>
            Agendar {validUrls.length > 1 ? `${validUrls.length} posts` : "post"}
          </button>
        </div>

        {/* ── Fila ── */}
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
            Fila de agendamentos
            {pendingCount > 0 && <span className="badge badge-info">{pendingCount} pendente(s)</span>}
          </div>

          {queue.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "36px 20px", color: "var(--muted)" }}>
              <div style={{ fontSize: 30, marginBottom: 12 }}>◷</div>
              <div style={{ fontWeight: 500, color: "var(--text2)", marginBottom: 6 }}>Fila vazia</div>
              <div style={{ fontSize: 12 }}>Agendamentos aparecem aqui em tempo real.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {queue.map((item) => {
                const info = STATUS_INFO[item.status] || STATUS_INFO.pending;
                const scheduledDate = new Date(item.scheduledAt);
                const isPast = item.scheduledAt < Date.now();

                return (
                  <div key={item.id} className={`queue-item ${item.status}`} style={{ background: info.bg, border: `1px solid ${info.color}30` }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: info.color, background: `${info.color}20`, padding: "2px 8px", borderRadius: 20 }}>
                            {item.status === "running" ? "⟳ " : ""}{info.label}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>
                            {item.postType} · {item.mediaType}
                          </span>
                          {item.loop && <span className="badge badge-purple" style={{ fontSize: 10 }}>loop</span>}
                          {item.runCount > 0 && <span style={{ fontSize: 10, color: "var(--muted)" }}>×{item.runCount}</span>}
                        </div>

                        <div style={{ fontSize: 12, color: isPast && item.status === "pending" ? "var(--warning)" : "var(--text2)", marginBottom: 5 }}>
                          🕐 {scheduledDate.toLocaleString("pt-BR")}
                          {isPast && item.status === "pending" && " (atrasado)"}
                        </div>

                        {item.timezone && (
                          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
                            Fuso: {item.timezone}
                          </div>
                        )}

                        <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.mediaUrl}
                        </div>

                        {item.caption && (
                          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            "{item.caption}"
                          </div>
                        )}

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                          {(item.accounts || []).map((a) => (
                            <span key={a.id} style={{ fontSize: 10, color: "var(--muted)", background: "var(--bg4)", padding: "2px 7px", borderRadius: 10 }}>
                              @{a.username}
                            </span>
                          ))}
                        </div>

                        {item.error && (
                          <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 5, padding: "3px 8px", background: "rgba(239,68,68,0.06)", borderRadius: 6 }}>
                            ✗ {item.error}
                          </div>
                        )}
                      </div>

                      {/* Ações */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
                        {(item.status === "pending" || item.status === "error") && (
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => openEdit(item)}
                            title="Editar agendamento"
                          >
                            ✎
                          </button>
                        )}
                        <button
                          className="btn btn-ghost btn-xs"
                          style={{ color: "var(--danger)" }}
                          onClick={() => setConfirmModal({ type: "removeItem", id: item.id })}
                          title="Remover da fila"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal de edição */}
      {editModal && (
        <div
          onClick={() => setEditModal(null)}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 16, padding: "28px", width: "100%", maxWidth: 440, boxShadow: "0 24px 80px rgba(0,0,0,0.5)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 18 }}>✎ Editar agendamento</div>
            <div className="form-row">
              <label>Novo horário</label>
              <input type="datetime-local" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Fuso local: {Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
            </div>
            <div className="form-row">
              <label>Legenda</label>
              <textarea value={editCaption} onChange={(e) => setEditCaption(e.target.value)} style={{ minHeight: 80, fontSize: 13 }} />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditModal(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modais de confirmação */}
      <Modal
        open={confirmModal?.type === "clearQueue"}
        title="Limpar fila?"
        message="Todos os agendamentos pendentes serão removidos."
        confirmLabel="Limpar fila"
        confirmDanger
        onConfirm={() => { clearQueue(); setConfirmModal(null); }}
        onCancel={() => setConfirmModal(null)}
      />
      <Modal
        open={confirmModal?.type === "removeItem"}
        title="Remover agendamento?"
        message="Este item será removido da fila de agendamentos."
        confirmLabel="Remover"
        confirmDanger
        onConfirm={() => { removeItem(confirmModal.id); setConfirmModal(null); }}
        onCancel={() => setConfirmModal(null)}
      />

      <style>{`
        @media (max-width: 900px) {
          .schedule-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
