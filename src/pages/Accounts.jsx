import { useAccounts } from "../App.jsx";

export default function Accounts() {
  const { accounts, removeAccount } = useAccounts();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Contas conectadas</div>
          <div className="page-subtitle">{accounts.length} conta(s) vinculada(s)</div>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📱</div>
          <div className="empty-title">Nenhuma conta conectada</div>
          <div className="empty-desc">Clique em "+ Conectar conta" na barra lateral para começar.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {accounts.map((acc) => (
            <div key={acc.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 0, padding: 0, overflow: "hidden" }}>
              {/* Header colorido */}
              <div style={{ height: 56, background: "linear-gradient(135deg, #1a1245 0%, #2d1b69 100%)", position: "relative" }} />

              {/* Avatar */}
              <div style={{ padding: "0 18px", marginTop: -28, marginBottom: 12 }}>
                {acc.profile_picture ? (
                  <img
                    src={acc.profile_picture}
                    alt={acc.username}
                    style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "3px solid var(--bg2)" }}
                    onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
                  />
                ) : null}
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "linear-gradient(135deg, var(--accent), var(--accent-light))",
                  border: "3px solid var(--bg2)",
                  display: acc.profile_picture ? "none" : "flex",
                  alignItems: "center", justifyContent: "center",
                  fontSize: 22, fontWeight: 700, color: "#fff",
                }}>
                  {acc.username?.[0]?.toUpperCase() || "?"}
                </div>
              </div>

              {/* Info */}
              <div style={{ padding: "0 18px 18px", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>@{acc.username}</div>
                  {acc.name && acc.name !== acc.username && (
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>{acc.name}</div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span className="badge badge-info">{acc.account_type || "BUSINESS"}</span>
                  <span className="badge badge-gray">
                    {acc.followers_count ? `${Number(acc.followers_count).toLocaleString("pt-BR")} seguidores` : "Conta conectada"}
                  </span>
                </div>

                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  Conectada em {new Date(acc.connected_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                </div>

                <button
                  className="btn btn-danger btn-sm"
                  style={{ marginTop: "auto", alignSelf: "flex-start" }}
                  onClick={() => confirm(`Remover @${acc.username}?`) && removeAccount(acc.id)}
                >
                  Desconectar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
