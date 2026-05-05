import { useHistory } from "../App.jsx";

const STATUS_BADGE = { published: "badge-success", failed: "badge-danger", success: "badge-success" };
const TYPE_ICON = { FEED: "🖼", REEL: "🎬", STORY: "⭕" };

export default function History() {
  const { history, clearHistory, reloadHistory } = useHistory();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Histórico</div>
          <div className="page-subtitle">{history.length} publicação(ões) registrada(s)</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={reloadHistory}>Atualizar</button>
          {history.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => confirm("Limpar histórico?") && clearHistory()}>
              Limpar
            </button>
          )}
        </div>
      </div>

      {history.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">≡</div>
          <div className="empty-title">Nenhuma publicação ainda</div>
          <div style={{ fontSize: 13 }}>Posts publicados e agendados aparecerão aqui.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {history.map((entry) => {
            const successCount = (entry.results || []).filter((r) => r.success).length;
            const totalCount   = (entry.results || []).length;
            return (
              <div key={entry.id} className="card card-hover">
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  {/* Thumb */}
                  <div style={{ width: 60, height: 60, borderRadius: 10, overflow: "hidden", background: "var(--bg3)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)" }}>
                    {entry.media_type === "IMAGE" ? (
                      <img src={entry.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => { e.target.style.display = "none"; e.target.parentElement.innerHTML = '<span style="font-size:24px">🖼</span>'; }} />
                    ) : (
                      <span style={{ fontSize: 24 }}>🎬</span>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
                      <span style={{ fontSize: 16 }}>{TYPE_ICON[entry.post_type] || "📌"}</span>
                      <span className={`badge ${successCount === totalCount ? "badge-success" : successCount === 0 ? "badge-danger" : "badge-warning"}`}>
                        {successCount}/{totalCount} publicado(s)
                      </span>
                      {entry.from_scheduler && <span className="badge badge-purple">Agendado</span>}
                      <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
                        {new Date(entry.created_at).toLocaleString("pt-BR")}
                      </span>
                    </div>

                    {entry.default_caption && (
                      <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {entry.default_caption}
                      </div>
                    )}

                    {/* Resultados por conta */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(entry.results || []).map((r, i) => (
                        <div key={i} title={r.error || ""} style={{
                          display: "flex", alignItems: "center", gap: 5,
                          padding: "4px 10px", borderRadius: 20,
                          background: r.success ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                          border: `1px solid ${r.success ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                          fontSize: 11, fontWeight: 500,
                          color: r.success ? "var(--success)" : "var(--danger)",
                        }}>
                          <span>{r.success ? "✓" : "✗"}</span>
                          <span>@{r.username}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
