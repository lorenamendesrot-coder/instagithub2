import { useState } from "react";
import { useAccounts, useHistory } from "../App.jsx";

const POST_TYPES = [
  { value: "FEED",  label: "Feed",  desc: "Foto ou vídeo no perfil" },
  { value: "REEL",  label: "Reel",  desc: "Foto ou vídeo curto" },
  { value: "STORY", label: "Story", desc: "Desaparece em 24h" },
];

export default function NewPost() {
  const { accounts } = useAccounts();
  const { addEntry } = useHistory();

  const [postType, setPostType]         = useState("FEED");
  const [mediaUrl, setMediaUrl]         = useState("");
  const [mediaType, setMediaType]       = useState("IMAGE");
  const [defaultCaption, setDefaultCaption] = useState("");
  const [customCaptions, setCustomCaptions] = useState({});
  const [useCustomCaption, setUseCustomCaption] = useState({});
  const [selectedIds, setSelectedIds]   = useState([]);
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [loading, setLoading]           = useState(false);
  const [progress, setProgress]         = useState(null);

  const showCaptions = postType === "FEED" || postType === "REEL";

  const toggleAccount = (id) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll = () => setSelectedIds(accounts.map((a) => a.id));
  const clearAll  = () => setSelectedIds([]);

  const setCustom    = (id, val) => setCustomCaptions((p) => ({ ...p, [id]: val }));
  const toggleCustom = (id) => {
    setUseCustomCaption((p) => ({ ...p, [id]: !p[id] }));
    if (!useCustomCaption[id]) setCustomCaptions((p) => ({ ...p, [id]: defaultCaption }));
  };

  const buildCaptions = () => {
    const result = {};
    for (const id of selectedIds)
      result[id] = useCustomCaption[id] ? (customCaptions[id] ?? defaultCaption) : defaultCaption;
    return result;
  };

  const submit = async () => {
    if (!mediaUrl.trim()) return alert("Cole a URL da mídia (Catbox, etc.)");
    if (selectedIds.length === 0) return alert("Selecione ao menos uma conta");

    const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));
    setLoading(true);
    setProgress({ current: 0, total: selectedAccounts.length, results: [] });

    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accounts: selectedAccounts,
        media_url: mediaUrl,
        media_type: mediaType,
        post_type: postType,
        captions: buildCaptions(),
        default_caption: defaultCaption,
        delay_seconds: delaySeconds,
      }),
    });

    const data = await res.json();
    const results = data.results || [];

    addEntry({ id: Date.now(), post_type: postType, media_url: mediaUrl, media_type: mediaType, default_caption: defaultCaption, delay_seconds: delaySeconds, results, created_at: new Date().toISOString() });
    setProgress({ current: results.length, total: selectedAccounts.length, results });
    setLoading(false);
  };

  const reset = () => { setProgress(null); setMediaUrl(""); setDefaultCaption(""); setCustomCaptions({}); setUseCustomCaption({}); setSelectedIds([]); };

  const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));
  const totalDelay = selectedAccounts.length > 1 ? (selectedAccounts.length - 1) * delaySeconds : 0;

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Novo post</div>
      </div>

      {progress && !loading && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontWeight: 500 }}>Resultado da publicação</div>
            <button className="btn btn-ghost btn-sm" onClick={reset}>Novo post</button>
          </div>
          {progress.results.map((r) => (
            <div key={r.account_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ flex: 1, fontSize: 13 }}>@{r.username}</span>
              {r.success ? <span className="badge badge-success">Publicado</span> : <span className="badge badge-danger" title={r.error}>Falhou</span>}
              {r.error && <span style={{ fontSize: 11, color: "var(--danger)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.error}</span>}
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="card" style={{ marginBottom: 20, textAlign: "center", padding: 32 }}>
          <div className="spinner" style={{ width: 28, height: 28, margin: "0 auto 14px" }} />
          <div style={{ fontWeight: 500, marginBottom: 6 }}>Publicando...</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {delaySeconds > 0 ? `Aguarde — há um delay de ${delaySeconds}s entre cada conta.` : "Publicando em todas as contas."}
          </div>
        </div>
      )}

      {!progress && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Tipo */}
            <div className="card">
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

            {/* Mídia */}
            <div className="card">
              <div className="form-row">
                <label>URL da mídia (Catbox, Cloudinary, etc.)</label>
                <input type="url" placeholder="https://files.catbox.moe/xxxxxx.jpg" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Tipo de mídia</label>
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
            </div>

            {/* Legenda */}
            {showCaptions && (
              <div className="card">
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>Legenda padrão</label>
                  <textarea placeholder="Escreva a legenda... #hashtags" value={defaultCaption} onChange={(e) => setDefaultCaption(e.target.value)} style={{ minHeight: 90 }} />
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{defaultCaption.length} caracteres</div>
                </div>
              </div>
            )}

            {/* Legendas individuais */}
            {showCaptions && selectedAccounts.length > 0 && (
              <div className="card">
                <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 14 }}>
                  Legenda por conta <span style={{ color: "var(--muted)", fontWeight: 400 }}>— ative para personalizar</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {selectedAccounts.map((acc) => (
                    <div key={acc.id}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        {acc.profile_picture ? <img src={acc.profile_picture} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }} /> : <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--bg3)" }} />}
                        <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>@{acc.username}</span>
                        <label style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--muted)" }}>
                          <input type="checkbox" checked={!!useCustomCaption[acc.id]} onChange={() => toggleCustom(acc.id)} style={{ width: "auto", cursor: "pointer" }} />
                          Personalizar
                        </label>
                      </div>
                      {useCustomCaption[acc.id] && (
                        <textarea placeholder={`Legenda para @${acc.username}...`} value={customCaptions[acc.id] ?? defaultCaption} onChange={(e) => setCustom(acc.id, e.target.value)} style={{ minHeight: 72, fontSize: 13 }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Delay */}
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label>Delay entre postagens (segundos)</label>
                  <input type="number" min="0" max="3600" value={delaySeconds} onChange={(e) => setDelaySeconds(Math.max(0, parseInt(e.target.value) || 0))} style={{ maxWidth: 120 }} />
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", paddingTop: 18 }}>
                  {delaySeconds === 0 ? "Sem delay — publica tudo ao mesmo tempo" : selectedAccounts.length > 1 ? `Tempo total: ~${Math.ceil(totalDelay / 60) > 0 ? `${Math.ceil(totalDelay / 60)} min` : `${totalDelay}s`}` : `${delaySeconds}s entre cada conta`}
                </div>
              </div>
            </div>

            <button className="btn btn-primary" style={{ alignSelf: "flex-start", padding: "11px 28px", fontSize: 14 }} onClick={submit} disabled={loading || !mediaUrl || selectedIds.length === 0}>
              {loading ? <><span className="spinner" /> Publicando...</> : `Publicar em ${selectedIds.length} conta(s)`}
            </button>
          </div>

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
              <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted)", fontSize: 13 }}>Nenhuma conta conectada</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {accounts.map((acc) => {
                  const sel = selectedIds.includes(acc.id);
                  return (
                    <button key={acc.id} onClick={() => toggleAccount(acc.id)} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8, border: "1px solid",
                      borderColor: sel ? "var(--accent)" : "var(--border)", background: sel ? "#7c5cfc12" : "var(--bg3)", textAlign: "left", width: "100%", transition: "all 0.12s",
                    }}>
                      {acc.profile_picture ? <img src={acc.profile_picture} alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} /> : <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--bg2)", flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: sel ? "var(--accent-light)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{acc.username}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{acc.account_type}</div>
                      </div>
                      <div style={{ width: 17, height: 17, borderRadius: "50%", flexShrink: 0, border: `1.5px solid ${sel ? "var(--accent)" : "var(--border)"}`, background: sel ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {sel && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
