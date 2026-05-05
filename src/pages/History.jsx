import { useHistory } from "../App.jsx";

const STATUS_BADGE = {
  true: "badge-success",
  false: "badge-danger",
};

const TYPE_LABEL = { FEED: "Feed", REEL: "Reel", STORY: "Story" };

export default function History() {
  const { history, clearHistory } = useHistory();

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Histórico</div>
        {history.length > 0 && (
          <button
            className="btn btn-danger btn-sm"
            onClick={() => confirm("Limpar todo o histórico?") && clearHistory()}
          >
            Limpar tudo
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <div className="empty-title">Nenhuma publicação ainda</div>
          <div style={{ fontSize: 13 }}>As publicações feitas em "Novo post" aparecerão aqui.</div>
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
                {/* Header */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                  {/* Thumb */}
                  <div style={{
                    width: 54, height: 54, borderRadius: 8, overflow: "hidden",
                    background: "var(--bg3)", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {entry.media_type === "IMAGE" ? (
                      <img
                        src={entry.media_url}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => { e.target.style.display = "none"; }}
                      />
                    ) : (
                      <span style={{ fontSize: 22 }}>▶</span>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <span className="badge badge-gray">{TYPE_LABEL[entry.post_type] || entry.post_type}</span>
                      <span className={`badge ${allOk ? "badge-success" : allFail ? "badge-danger" : "badge-warning"}`}>
                        {successCount}/{total} publicadas
                      </span>
                    </div>
                    {entry.default_caption && (
                      <div style={{
                        fontSize: 13, color: "var(--muted)", overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 480,
                      }}>
                        {entry.default_caption}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                      {new Date(entry.created_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                </div>

                {/* Resultados por conta */}
                {entry.results?.length > 0 && (
                  <div style={{
                    borderTop: "1px solid var(--border)", paddingTop: 10,
                    display: "flex", flexDirection: "column", gap: 6,
                  }}>
                    {entry.results.map((r) => (
                      <div key={r.account_id} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "7px 10px", borderRadius: 7, background: "var(--bg3)",
                      }}>
                        <span style={{ flex: 1, fontSize: 13 }}>@{r.username}</span>
                        {r.success ? (
                          <span className="badge badge-success">✓ Publicado</span>
                        ) : (
                          <>
                            <span className="badge badge-danger">✗ Falhou</span>
                            {r.error && (
                              <span style={{
                                fontSize: 11, color: "var(--danger)",
                                maxWidth: 260, overflow: "hidden",
                                textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }} title={r.error}>
                                {r.error}
                              </span>
                            )}
                          </>
                        )}
                        {r.published_at && (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>
                            {new Date(r.published_at).toLocaleTimeString("pt-BR")}
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
