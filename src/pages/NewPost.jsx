import { useState } from "react";
import { useAccounts, useHistory } from "../App.jsx";

const POST_TYPES = [
  { value: "FEED",  label: "Feed",  icon: "⊞", desc: "Foto ou vídeo no perfil" },
  { value: "REEL",  label: "Reel",  icon: "▶", desc: "Vídeo curto vertical" },
  { value: "STORY", label: "Story", icon: "◎", desc: "Desaparece em 24h" },
];

export default function NewPost() {
  const { accounts } = useAccounts();
  const { addEntry } = useHistory();

  const [postType, setPostType]               = useState("FEED");
  const [mediaUrl, setMediaUrl]               = useState("");
  const [mediaType, setMediaType]             = useState("IMAGE");
  const [defaultCaption, setDefaultCaption]   = useState("");
  const [customCaptions, setCustomCaptions]   = useState({});
  const [useCustomCaption, setUseCustomCaption] = useState({});
  const [selectedIds, setSelectedIds]         = useState([]);
  const [delayMin, setDelayMin]               = useState(30);
  const [delayMax, setDelayMax]               = useState(60);
  const [loading, setLoading]                 = useState(false);
  const [progress, setProgress]               = useState(null);

  // Reel força VIDEO
  const effectiveMediaType = postType === "REEL" ? "VIDEO" : mediaType;
  const showCaptions = postType === "FEED" || postType === "REEL";

  const toggleAccount = (id) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll = () => setSelectedIds(accounts.map((a) => a.id));
  const clearAll  = () => setSelectedIds([]);

  const toggleCustom = (id) => {
    setUseCustomCaption((p) => ({ ...p, [id]: !p[id] }));
    if (!useCustomCaption[id]) setCustomCaptions((p) => ({ ...p, [id]: defaultCaption }));
  };

  const randomDelay = () => {
    const min = Math.min(delayMin, delayMax);
    const max = Math.max(delayMin, delayMax);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  const buildCaptions = () => {
    const result = {};
    for (const id of selectedIds)
      result[id] = useCustomCaption[id] ? (customCaptions[id] ?? defaultCaption) : defaultCaption;
    return result;
  };

  const submit = async () => {
    if (!mediaUrl.trim()) return alert("Cole a URL da mídia");
    if (selectedIds.length === 0) return alert("Selecione ao menos uma conta");

    const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));
    const delay = selectedAccounts.length > 1 ? randomDelay() : 0;

    setLoading(true);
    setProgress({ current: 0, total: selectedAccounts.length, results: [] });

    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accounts: selectedAccounts,
        media_url: mediaUrl,
        media_type: effectiveMediaType,
        post_type: postType,
        captions: buildCaptions(),
        default_caption: defaultCaption,
        delay_seconds: delay,
      }),
    });

    const data = await res.json();
    const results = data.results || [];

    addEntry({
      id: Date.now(), post_type: postType,
      media_url: mediaUrl, media_type: effectiveMediaType,
      default_caption: defaultCaption, delay_seconds: delay,
      results, created_at: new Date().toISOString(),
    });
    setProgress({ current: results.length, total: selectedAccounts.length, results, delay });
    setLoading(false);
  };

  const reset = () => {
    setProgress(null); setMediaUrl(""); setDefaultCaption("");
    setCustomCaptions({}); setUseCustomCaption({}); setSelectedIds([]);
  };

  const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));
  const successCount = progress?.results?.filter((r) => r.success).length ?? 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Publicar agora</div>
          <div className="page-subtitle">Publique em múltiplas contas simultaneamente</div>
        </div>
      </div>

      {/* Resultado */}
      {progress && !loading && (
        <div className="card card-highlight" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Resultado da publicação</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                {successCount}/{progress.total} publicadas com sucesso
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={reset}>+ Novo post</button>
          </div>

          <div className="progress-bar" style={{ marginBottom: 16 }}>
            <div className="progress-fill" style={{ width: `${(successCount / progress.total) * 100}%`, background: successCount === progress.total ? "var(--success)" : "var(--accent)" }} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {progress.results.map((r) => (
              <div key={r.account_id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 8, background: "var(--bg3)",
                border: `1px solid ${r.success ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)"}`,
              }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: r.success ? "var(--success-bg)" : "var(--danger-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>
                  {r.success ? "✓" : "✕"}
                </div>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>@{r.username}</span>
                {r.success
                  ? <span className="badge badge-success">Publicado</span>
                  : <>
                      <span className="badge badge-danger">Falhou</span>
                      {r.error && <span style={{ fontSize: 11, color: "var(--danger)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.error}>{r.error}</span>}
                    </>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card" style={{ marginBottom: 20, textAlign: "center", padding: "40px 32px" }}>
          <div className="spinner" style={{ width: 32, height: 32, margin: "0 auto 16px" }} />
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Publicando...</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Aguarde — publicando em {selectedIds.length} conta(s).
          </div>
        </div>
      )}

      {!progress && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 18, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Tipo de post */}
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>Tipo de post</div>
              <div style={{ display: "flex", gap: 8 }}>
                {POST_TYPES.map((t) => (
                  <button key={t.value} onClick={() => setPostType(t.value)} className={`type-btn ${postType === t.value ? "active" : ""}`}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{t.icon}</div>
                    <div className="type-label">{t.label}</div>
                    <div className="type-desc">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Mídia */}
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>Mídia</div>
              <div className="form-row">
                <label>URL da mídia</label>
                <input type="url" placeholder="https://files.catbox.moe/xxxxxx.jpg" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>Use Catbox.moe, Cloudinary, S3 ou qualquer URL pública</div>
              </div>

              {postType !== "REEL" && (
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>Tipo de mídia</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[{ v: "IMAGE", l: "🖼️  Imagem" }, { v: "VIDEO", l: "🎬  Vídeo" }].map((t) => (
                      <button key={t.v} onClick={() => setMediaType(t.v)} style={{
                        flex: 1, padding: "9px", borderRadius: 8, border: "1px solid",
                        borderColor: mediaType === t.v ? "var(--accent)" : "var(--border)",
                        background: mediaType === t.v ? "var(--accent-glow)" : "var(--bg3)",
                        color: mediaType === t.v ? "var(--accent-light)" : "var(--muted)",
                        fontSize: 13, fontWeight: mediaType === t.v ? 600 : 400,
                        transition: "all 0.12s",
                      }}>
                        {t.l}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {postType === "REEL" && (
                <div style={{ padding: "8px 12px", background: "var(--bg3)", borderRadius: 8, fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>▶</span> Reel sempre usa <strong style={{ color: "var(--accent-light)" }}>Vídeo</strong>
                </div>
              )}
            </div>

            {/* Legenda */}
            {showCaptions && (
              <div className="card">
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>Legenda</div>
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>Legenda padrão</label>
                  <textarea
                    placeholder="Escreva a legenda... #hashtags"
                    value={defaultCaption}
                    onChange={(e) => setDefaultCaption(e.target.value)}
                    style={{ minHeight: 90 }}
                  />
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, textAlign: "right" }}>{defaultCaption.length} / 2.200</div>
                </div>
              </div>
            )}

            {/* Legendas por conta */}
            {showCaptions && selectedAccounts.length > 1 && (
              <div className="card">
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>
                  Legendas personalizadas <span style={{ color: "var(--muted)", fontWeight: 400, textTransform: "none" }}>— opcional</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {selectedAccounts.map((acc) => (
                    <div key={acc.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        {acc.profile_picture
                          ? <img src={acc.profile_picture} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }} />
                          : <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,var(--accent),var(--accent-light))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 700 }}>{acc.username?.[0]?.toUpperCase()}</div>}
                        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>@{acc.username}</span>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", margin: 0 }}>
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>Personalizar</span>
                          <label className="toggle">
                            <input type="checkbox" checked={!!useCustomCaption[acc.id]} onChange={() => toggleCustom(acc.id)} />
                            <span className="toggle-slider" />
                          </label>
                        </label>
                      </div>
                      {useCustomCaption[acc.id] && (
                        <textarea
                          placeholder={`Legenda para @${acc.username}...`}
                          value={customCaptions[acc.id] ?? defaultCaption}
                          onChange={(e) => setCustomCaptions((p) => ({ ...p, [acc.id]: e.target.value }))}
                          style={{ minHeight: 70, fontSize: 13 }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Delay */}
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>
                Delay entre postagens
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>Mínimo (segundos)</label>
                  <input type="number" min="0" max="3600" value={delayMin} onChange={(e) => setDelayMin(Math.max(0, parseInt(e.target.value) || 0))} />
                </div>
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>Máximo (segundos)</label>
                  <input type="number" min="0" max="3600" value={delayMax} onChange={(e) => setDelayMax(Math.max(delayMin, parseInt(e.target.value) || delayMin))} />
                </div>
              </div>
              <div style={{ padding: "9px 12px", background: "var(--bg3)", borderRadius: 8, fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                <span>⏱</span>
                {selectedAccounts.length <= 1
                  ? "Selecione mais de 1 conta para usar delay"
                  : `Entre cada conta: ${delayMin}~${delayMax}s aleatório`}
              </div>
            </div>

            <button
              className="btn btn-primary"
              style={{ alignSelf: "flex-start", padding: "12px 32px", fontSize: 14, borderRadius: 10 }}
              onClick={submit}
              disabled={loading || !mediaUrl.trim() || selectedIds.length === 0}
            >
              {loading ? <><span className="spinner" /> Publicando...</> : `↑ Publicar em ${selectedIds.length || 0} conta(s)`}
            </button>
          </div>

          {/* Seleção de contas */}
          <div className="card" style={{ position: "sticky", top: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                Contas <span style={{ color: "var(--muted)", fontWeight: 400 }}>{selectedIds.length}/{accounts.length}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-ghost btn-xs" onClick={selectAll}>Todas</button>
                <button className="btn btn-ghost btn-xs" onClick={clearAll}>Limpar</button>
              </div>
            </div>

            {accounts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted)", fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📱</div>
                Nenhuma conta conectada
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {accounts.map((acc) => {
                  const sel = selectedIds.includes(acc.id);
                  return (
                    <button key={acc.id} onClick={() => toggleAccount(acc.id)} className={`account-btn ${sel ? "selected" : ""}`}>
                      {acc.profile_picture
                        ? <img src={acc.profile_picture} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,var(--accent),var(--accent-light))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontWeight: 700, flexShrink: 0 }}>{acc.username?.[0]?.toUpperCase()}</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="acc-name" style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{acc.username}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{acc.account_type || "BUSINESS"}</div>
                      </div>
                      <div style={{
                        width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                        border: `1.5px solid ${sel ? "var(--accent)" : "var(--border2)"}`,
                        background: sel ? "var(--accent)" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, color: "#fff",
                      }}>
                        {sel && "✓"}
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
