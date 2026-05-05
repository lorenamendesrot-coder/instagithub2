import { useHistory } from "../App.jsx";

const TYPE_LABEL = { FEED: "Feed", REEL: "Reel", STORY: "Story" };

export default function History() {
  const { history, clearHistory } = useHistory();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Histórico</div>
          <div className="page-subtitle">{history.length} publicação(ões) registrada(s)</div>
        </div>
        {history.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={() => confirm("Limpar todo o histórico?") && clearHistory()}>
            Limpar tudo
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <div className="empty-title">Nenhuma publicação ainda</div>
          <div className="empty-desc">As publicações feitas em "Publicar" ou "Agendar" aparecerão aqui.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {history.map((entry) => {
            const successCount = entry.results?.filter((r) => r.success).length ?? 0;
            const total = entry.results?.length ?? 0;
            const allOk = successCount === total;
            const allFail = successCount === 0;

            return (
              <div key={entry.id} className="card">
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: successCount > 0 ? 14 : 0 }}>
                  {/* Thumb */}
                  <div style={{ width: 56, height: 56, borderRadius: 9, overflow: "hidden", background: "var(--bg3)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)" }}>
                    {entry.media_type === "IMAGE" ? (
                      <img src={entry.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.display = "none"; }} />
                    ) : (
                      <span style={{ fontSize: 24 }}>▶</span>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, flexWrap: "wrap" }}>
                      <span className="badge badge-gray">{TYPE_LABEL[entry.post_type] || entry.post_type}</span>
                      <span className={`badge ${allOk ? "badge-success" : allFail ? "badge-danger" : "badge-warning"}`}>
                        {successCount}/{total} publicadas
                      </span>
                      {entry.media_type && (
                        <span className="badge badge-gray">{entry.media_type}</span>
                      )}
                    </div>

                    {entry.default_caption && (
                      <div style={{ fontSize: 13, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 500, marginBottom: 4 }}>
                        {entry.default_caption}
                      </div>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        {new Date(entry.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {/* Barra de progresso inline */}
                      <div style={{ flex: 1, maxWidth: 120, height: 3, background: "var(--bg4)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 3, background: allOk ? "var(--success)" : allFail ? "var(--danger)" : "var(--warning)", width: `${total > 0 ? (successCount / total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </div>
                </div>

                {entry.results?.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                    {entry.results.map((r) => (
                      <div key={r.account_id} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 10px", borderRadius: 7,
                        background: r.success ? "rgba(52,211,153,0.05)" : "rgba(248,113,113,0.05)",
                        border: `1px solid ${r.success ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)"}`,
                      }}>
                        <span style={{ fontSize: 12, color: r.success ? "var(--success)" : "var(--danger)", flexShrink: 0 }}>
                          {r.success ? "✓" : "✕"}
                        </span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>@{r.username}</span>
                        {r.success
                          ? <span className="badge badge-success">Publicado</span>
                          : <>
                              <span className="badge badge-danger">Falhou</span>
                              {r.error && <span style={{ fontSize: 11, color: "var(--danger)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.error}>{r.error}</span>}
                            </>}
                        {r.published_at && (
                          <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
                            {new Date(r.published_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
