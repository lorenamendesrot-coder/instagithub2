import { useState } from "react";
import { useAccounts } from "../App.jsx";
import Modal from "../Modal.jsx";

// ── Modal de edição de perfil ─────────────────────────────────────────────────
function EditProfileModal({ acc, onClose, onSaved }) {
  const [tab, setTab]           = useState("bio");
  const [bio, setBio]           = useState(acc.biography || "");
  const [website, setWebsite]   = useState(acc.website || "");
  const [photoUrl, setPhotoUrl] = useState("");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);

  const saveProfile = async () => {
    setLoading(true); setResult(null);
    try {
      const res = await fetch("/api/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagram_id: acc.id, access_token: acc.access_token, biography: bio, website }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ type: "success", msg: "Bio e link atualizados!" });
        onSaved({ ...acc, biography: bio, website });
      } else {
        setResult({ type: "error", msg: data.error || "Erro ao atualizar." });
      }
    } catch (e) { setResult({ type: "error", msg: e.message }); }
    setLoading(false);
  };

  const savePhoto = async () => {
    if (!photoUrl.trim()) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetch("/api/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagram_id: acc.id, access_token: acc.access_token, profile_picture_url: photoUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ type: "success", msg: "Foto atualizada! Pode levar alguns minutos para aparecer." });
        onSaved({ ...acc, profile_picture: photoUrl });
        setPhotoUrl("");
      } else {
        setResult({ type: "error", msg: data.error || "Erro ao atualizar foto." });
      }
    } catch (e) { setResult({ type: "error", msg: e.message }); }
    setLoading(false);
  };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        background: "var(--bg2)", border: "1px solid var(--border2)",
        borderRadius: 16, width: "100%", maxWidth: 460,
        boxShadow: "0 24px 64px rgba(0,0,0,0.7)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            {acc.profile_picture && (
              <img src={acc.profile_picture} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border2)", display: "block" }}
                onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }} />
            )}
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,var(--accent),#9b4dfc)", display: acc.profile_picture ? "none" : "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#fff", fontWeight: 700 }}>
              {(acc.username || "?")[0].toUpperCase()}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>@{acc.username}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Editar perfil</div>
          </div>
          <button onClick={onClose} style={{ background: "none", color: "var(--muted)", fontSize: 22, padding: "0 4px", lineHeight: 1 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          {[{ id: "bio", label: "📝 Bio & Link" }, { id: "photo", label: "📷 Foto de perfil" }].map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setResult(null); }} style={{
              flex: 1, padding: "11px", fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? "var(--accent-light)" : "var(--muted)",
              background: "none",
              borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
              transition: "all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ padding: 20 }}>

          {/* ── Tab Bio & Link ── */}
          {tab === "bio" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label>Bio</label>
                <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Escreva sua bio..." style={{ minHeight: 88 }} maxLength={150} />
                <div style={{ fontSize: 11, color: bio.length > 130 ? "var(--warning)" : "var(--muted)", textAlign: "right", marginTop: 4 }}>{bio.length}/150</div>
              </div>
              <div>
                <label>Link da bio</label>
                <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://seusite.com.br" />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Aparece como link clicável no perfil</div>
              </div>
              <div style={{ padding: "9px 12px", background: "rgba(245,158,11,0.07)", borderRadius: 8, fontSize: 12, color: "var(--warning)", borderLeft: "3px solid var(--warning)", lineHeight: 1.6 }}>
                ⚠️ Requer permissão <strong>instagram_manage_profile</strong> aprovada no App Meta.
              </div>
              {result && (
                <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, background: result.type === "success" ? "var(--success-bg)" : "rgba(239,68,68,0.08)", color: result.type === "success" ? "var(--success)" : "var(--danger)", border: `1px solid ${result.type === "success" ? "rgba(52,211,153,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                  {result.type === "success" ? "✓ " : "✕ "}{result.msg}
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveProfile} disabled={loading}>
                  {loading ? <><span className="spinner" /> Salvando...</> : "Salvar"}
                </button>
                <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              </div>
            </div>
          )}

          {/* ── Tab Foto ── */}
          {tab === "photo" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Foto atual */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, background: "var(--bg3)", borderRadius: 10 }}>
                <div style={{ position: "relative" }}>
                  {acc.profile_picture && (
                    <img src={acc.profile_picture} alt="" style={{ width: 58, height: 58, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border2)", display: "block" }}
                      onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }} />
                  )}
                  <div style={{ width: 58, height: 58, borderRadius: "50%", background: "linear-gradient(135deg,var(--accent),#9b4dfc)", display: acc.profile_picture ? "none" : "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: "#fff", fontWeight: 700 }}>
                    {(acc.username || "?")[0].toUpperCase()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Foto atual</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>@{acc.username}</div>
                </div>
              </div>

              <div>
                <label>URL da nova foto</label>
                <input type="url" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://files.catbox.moe/foto.jpg" />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>JPG ou PNG público — Catbox, Imgur, Cloudinary, etc.</div>
              </div>

              {photoUrl && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--bg3)", borderRadius: 9, border: "1px solid var(--accent)" }}>
                  <img src={photoUrl} alt="preview" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--accent)", flexShrink: 0 }} onError={(e) => { e.target.style.opacity = "0.3"; }} />
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Prévia da nova foto</div>
                </div>
              )}

              <div style={{ padding: "9px 12px", background: "rgba(245,158,11,0.07)", borderRadius: 8, fontSize: 12, color: "var(--warning)", borderLeft: "3px solid var(--warning)", lineHeight: 1.6 }}>
                ⚠️ Requer permissão <strong>instagram_manage_profile</strong> aprovada no App Meta.
              </div>

              {result && (
                <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, background: result.type === "success" ? "var(--success-bg)" : "rgba(239,68,68,0.08)", color: result.type === "success" ? "var(--success)" : "var(--danger)", border: `1px solid ${result.type === "success" ? "rgba(52,211,153,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                  {result.type === "success" ? "✓ " : "✕ "}{result.msg}
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={savePhoto} disabled={loading || !photoUrl.trim()}>
                  {loading ? <><span className="spinner" /> Atualizando...</> : "Atualizar foto"}
                </button>
                <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Accounts() {
  const { accounts, removeAccount, clearAllAccounts, loading, reloadAccounts } = useAccounts();
  const [confirmModal, setConfirmModal] = useState(null);
  const [editingAcc, setEditingAcc]     = useState(null);

  const APP_ID   = import.meta.env.VITE_META_APP_ID;
  const REDIRECT = encodeURIComponent(window.location.origin + "/api/auth-callback");
  const SCOPE    = "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_read_engagement,pages_show_list,pages_manage_posts,business_management,pages_manage_metadata";
  const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${REDIRECT}&scope=${SCOPE}&response_type=code`;

  const Avatar = ({ acc, size = 52 }) => {
    const initials = (acc.username || "?")[0].toUpperCase();
    const gradients = [
      "linear-gradient(135deg, #7c5cfc, #e040fb)",
      "linear-gradient(135deg, #f59e0b, #ef4444)",
      "linear-gradient(135deg, #22c55e, #38bdf8)",
      "linear-gradient(135deg, #f97316, #ec4899)",
    ];
    const grad = gradients[acc.username?.charCodeAt(0) % gradients.length] || gradients[0];
    return (
      <div style={{ position: "relative", flexShrink: 0 }}>
        {acc.profile_picture && (
          <img src={acc.profile_picture} alt={acc.username}
            style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border2)", display: "block" }}
            onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }} />
        )}
        <div style={{ width: size, height: size, borderRadius: "50%", background: grad, display: acc.profile_picture ? "none" : "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, color: "#fff", border: "2px solid var(--border2)" }}>
          {initials}
        </div>
        <div style={{ position: "absolute", bottom: 1, right: 1, width: 12, height: 12, borderRadius: "50%", background: "var(--success)", border: "2px solid var(--bg2)" }} />
      </div>
    );
  };

  const handleConfirm = async () => {
    if (!confirmModal) return;
    if (confirmModal.type === "remove") await removeAccount(confirmModal.id);
    if (confirmModal.type === "clear")  await clearAllAccounts();
    setConfirmModal(null);
  };

  const handleSaved = (updated) => {
    // Atualiza a conta no IndexedDB via reloadAccounts (useAccounts já persiste)
    const { dbPut } = require?.("../useDB.js") || {};
    // Força reload das contas do IndexedDB
    reloadAccounts();
    setEditingAcc(null);
  };

  if (loading) return (
    <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
      <div className="spinner" style={{ width: 28, height: 28 }} />
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Contas conectadas</div>
          <div className="page-subtitle">{accounts.length} conta(s) vinculada(s) via Meta API</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {accounts.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmModal({ type: "clear" })}>
              Remover todas
            </button>
          )}
          <a href={oauthUrl} className="btn btn-primary">+ Adicionar conta</a>
        </div>
      </div>

      {/* Modal de edição */}
      {editingAcc && (
        <EditProfileModal
          acc={editingAcc}
          onClose={() => setEditingAcc(null)}
          onSaved={handleSaved}
        />
      )}

      {accounts.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📱</div>
          <div className="empty-title">Nenhuma conta conectada</div>
          <div style={{ fontSize: 13, marginBottom: 24, color: "var(--muted)" }}>Conecte contas Instagram Business ou Creator.</div>
          <a href={oauthUrl} className="btn btn-primary">+ Conectar primeira conta</a>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {accounts.map((acc) => (
              <div key={acc.id} className="card card-hover" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                  <Avatar acc={acc} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{acc.username || "—"}</div>
                    <span className="badge badge-purple" style={{ marginTop: 4 }}>{acc.account_type || "BUSINESS"}</span>
                  </div>
                </div>

                {/* Bio e link se existirem */}
                {acc.biography && (
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.55, wordBreak: "break-word" }}>
                    {acc.biography}
                  </div>
                )}
                {acc.website && (
                  <a href={acc.website} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent-light)", display: "flex", alignItems: "center", gap: 5 }}>
                    🔗 {acc.website.replace(/^https?:\/\//, "")}
                  </a>
                )}

                <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div>🗓 Conectada em {new Date(acc.connected_at || Date.now()).toLocaleDateString("pt-BR")}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    🔒 Token: <span className="badge badge-success" style={{ fontSize: 10 }}>Armazenado com segurança</span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => setEditingAcc(acc)}
                  >
                    ✏️ Editar perfil
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setConfirmModal({ type: "remove", id: acc.id, username: acc.username })}
                  >
                    Desconectar
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 20, padding: "12px 16px", background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border)", fontSize: 12, color: "var(--muted)" }}>
            💡 Foto não aparecendo? As URLs de foto da Meta expiram. Reconecte a conta para atualizar.
          </div>
        </>
      )}

      <Modal
        open={!!confirmModal}
        title={confirmModal?.type === "clear" ? "Remover todas as contas?" : `Desconectar @${confirmModal?.username}?`}
        message={
          confirmModal?.type === "clear"
            ? "Todas as contas e tokens serão removidos do dispositivo. Você precisará reconectar."
            : "A conta será removida do Insta Manager. Você poderá reconectá-la quando quiser."
        }
        confirmLabel={confirmModal?.type === "clear" ? "Remover todas" : "Desconectar"}
        confirmDanger
        onConfirm={handleConfirm}
        onCancel={() => setConfirmModal(null)}
      />
    </div>
  );
}
