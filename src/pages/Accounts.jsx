import { useAccounts } from "../App.jsx";

export default function Accounts() {
  const { accounts, removeAccount } = useAccounts();
  const APP_ID  = import.meta.env.VITE_META_APP_ID;
  const REDIRECT = encodeURIComponent(window.location.origin + "/api/auth-callback");
  const SCOPE   = "instagram_basic,instagram_content_publish,pages_read_engagement,pages_show_list,business_management";
  const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${REDIRECT}&scope=${SCOPE}&response_type=code`;

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
          <img
            src={acc.profile_picture}
            alt={acc.username}
            style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border2)", display: "block" }}
            onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
          />
        )}
        <div style={{
          width: size, height: size, borderRadius: "50%", background: grad,
          display: acc.profile_picture ? "none" : "flex",
          alignItems: "center", justifyContent: "center",
          fontSize: size * 0.38, fontWeight: 700, color: "#fff",
          border: "2px solid var(--border2)",
        }}>{initials}</div>
        <div style={{ position: "absolute", bottom: 1, right: 1, width: 12, height: 12, borderRadius: "50%", background: "var(--success)", border: "2px solid var(--bg2)" }} />
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Contas conectadas</div>
          <div className="page-subtitle">{accounts.length} conta(s) vinculada(s) via Meta API</div>
        </div>
        <a href={oauthUrl} className="btn btn-primary">+ Adicionar conta</a>
      </div>

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
              <div key={acc.id} className="card card-hover" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                  <Avatar acc={acc} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{acc.username || "—"}</div>
                    <span className="badge badge-purple" style={{ marginTop: 4 }}>{acc.account_type || "BUSINESS"}</span>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 5 }}>
                  <div>🗓 Conectada em {new Date(acc.connected_at || Date.now()).toLocaleDateString("pt-BR")}</div>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🔑 ID: {acc.id}</div>
                </div>
                <button className="btn btn-danger btn-sm" style={{ marginTop: "auto" }}
                  onClick={() => { if (confirm(`Remover @${acc.username}?`)) removeAccount(acc.id); }}>
                  Desconectar
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20, padding: "12px 16px", background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border)", fontSize: 12, color: "var(--muted)" }}>
            💡 Foto não aparecendo? As URLs de foto da Meta expiram. Reconecte a conta para atualizar.
          </div>
        </>
      )}
    </div>
  );
}
