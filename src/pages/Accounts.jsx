import { useAccounts } from "../App.jsx";

export default function Accounts() {
  const { accounts, removeAccount } = useAccounts();

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Contas conectadas</div>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{accounts.length} conta(s)</span>
      </div>

      {accounts.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📱</div>
          <div className="empty-title">Nenhuma conta conectada</div>
          <div style={{ fontSize: 13 }}>Clique em "+ Conectar conta" para começar.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {accounts.map((acc) => (
            <div key={acc.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {acc.profile_picture ? (
                  <img src={acc.profile_picture} alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border)" }} />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--bg3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>👤</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    @{acc.username}
                  </div>
                  <span className="badge badge-info" style={{ marginTop: 3 }}>{acc.account_type}</span>
                </div>
              </div>

              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                Conectada em {new Date(acc.connected_at).toLocaleDateString("pt-BR")}
              </div>

              <button className="btn btn-danger btn-sm" onClick={() => removeAccount(acc.id)}>
                Remover
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
