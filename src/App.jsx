import { Routes, Route, NavLink } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import Accounts from "./pages/Accounts.jsx";
import NewPost from "./pages/NewPost.jsx";
import Schedule from "./pages/Schedule.jsx";
import History from "./pages/History.jsx";
import { dbGetAll, dbPut, dbPutMany, dbDelete, dbClear } from "./useDB.js";

// ─── Accounts — localStorage ─────────────────────────────────────────────────
export const useAccounts = () => {
  const [accounts, setAccounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ig_accounts") || "[]"); } catch { return []; }
  });
  const save = (list) => { localStorage.setItem("ig_accounts", JSON.stringify(list)); setAccounts(list); };
  const addAccounts = (newAccs) => {
    const existing = JSON.parse(localStorage.getItem("ig_accounts") || "[]");
    const merged = [...existing];
    for (const acc of newAccs) {
      const idx = merged.findIndex((a) => a.id === acc.id);
      if (idx >= 0) merged[idx] = { ...merged[idx], ...acc };
      else merged.push(acc);
    }
    save(merged);
  };
  const removeAccount = (id) => save(accounts.filter((a) => a.id !== id));
  return { accounts, addAccounts, removeAccount };
};

// ─── History — IndexedDB ─────────────────────────────────────────────────────
export const useHistory = () => {
  const [history, setHistory] = useState([]);
  const reload = useCallback(async () => {
    const all = await dbGetAll("history");
    all.sort((a, b) => b.id - a.id);
    setHistory(all.slice(0, 300));
  }, []);
  useEffect(() => { reload(); }, []);
  const addEntry = async (entry) => { await dbPut("history", entry); reload(); };
  const clearHistory = async () => { await dbClear("history"); setHistory([]); };
  return { history, addEntry, clearHistory, reloadHistory: reload };
};

// ─── Service Worker ──────────────────────────────────────────────────────────
function registerSW(setStatus) {
  if (!("serviceWorker" in navigator)) return setStatus("unsupported");
  navigator.serviceWorker
    .register("/sw.js", { updateViaCache: "none" })
    .then((reg) => {
      setStatus("active");
      // Forçar atualização do SW se houver nova versão
      reg.update();
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data?.type === "QUEUE_UPDATE")
          window.dispatchEvent(new CustomEvent("sw:queue-update"));
      });
    })
    .catch(() => setStatus("error"));
}

const NAV = [
  { to: "/",          label: "Contas",        icon: "👤" },
  { to: "/novo",      label: "Novo post",     icon: "✦" },
  { to: "/agendar",   label: "Agendamentos",  icon: "◷" },
  { to: "/historico", label: "Histórico",     icon: "≡" },
];

export default function App() {
  const { addAccounts, accounts } = useAccounts();
  const [toast, setToast] = useState(null);
  const [swStatus, setSwStatus] = useState("loading");

  useEffect(() => { registerSW(setSwStatus); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("accounts");
    const error   = params.get("error");
    window.history.replaceState({}, "", window.location.pathname);

    if (encoded) {
      try {
        const accs = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
        addAccounts(accs);
        showToast("success", `${accs.length} conta(s) conectada(s)!`);
      } catch {
        showToast("error", "Erro ao importar contas.");
      }
    }
    if (error) showToast("error", decodeURIComponent(error));
  }, []);

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  const APP_ID  = import.meta.env.VITE_META_APP_ID;
  const REDIRECT = encodeURIComponent(window.location.origin + "/api/auth-callback");
  const SCOPE   = "instagram_basic,instagram_content_publish,pages_read_engagement,pages_show_list,business_management";
  const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${REDIRECT}&scope=${SCOPE}&response_type=code`;

  const swInfo = {
    active:      { color: "#22c55e", label: "●", title: "Scheduler ativo" },
    error:       { color: "#ef4444", label: "●", title: "Erro no scheduler" },
    unsupported: { color: "#f59e0b", label: "●", title: "SW não suportado" },
    loading:     { color: "#666678", label: "●", title: "Iniciando..." },
  }[swStatus] || { color: "#666678", label: "●" };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* ── Sidebar ── */}
      <aside style={{
        width: 230, background: "var(--bg2)",
        borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column",
        padding: "0", flexShrink: 0,
        position: "sticky", top: 0, height: "100vh",
      }}>
        {/* Logo */}
        <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "linear-gradient(135deg, var(--accent), #9b4dfc)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, flexShrink: 0, boxShadow: "0 2px 12px rgba(124,92,252,0.4)",
            }}>📱</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em" }}>Insta Manager</div>
              <div style={{ fontSize: 10, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: swInfo.color, fontSize: 8 }} title={swInfo.title}>{swInfo.label}</span>
                Meta Graph API
              </div>
            </div>
          </div>
        </div>

        {/* Contas na sidebar — FIX: foto e nome */}
        {accounts.length > 0 && (
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 10, textTransform: "uppercase" }}>
              Contas ({accounts.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 200, overflowY: "auto" }}>
              {accounts.map((acc) => (
                <div key={acc.id} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  {/* FIX: fallback robusto para foto */}
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    {acc.profile_picture ? (
                      <img
                        src={acc.profile_picture}
                        alt=""
                        style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", border: "1.5px solid var(--border2)" }}
                        onError={(e) => {
                          e.target.style.display = "none";
                          e.target.nextSibling.style.display = "flex";
                        }}
                      />
                    ) : null}
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "linear-gradient(135deg, var(--accent), #9b4dfc)",
                      display: acc.profile_picture ? "none" : "flex",
                      alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, color: "#fff",
                      border: "1.5px solid var(--border2)", flexShrink: 0,
                    }}>
                      {(acc.username || "?")[0].toUpperCase()}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      @{acc.username || "conta"}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>{acc.account_type || "BUSINESS"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Nav */}
        <nav style={{ padding: "10px 10px", flex: 1 }}>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              style={({ isActive }) => ({
                display: "flex", alignItems: "center", gap: 11,
                padding: "10px 13px", borderRadius: 10, marginBottom: 3,
                color: isActive ? "var(--accent3)" : "var(--muted)",
                background: isActive ? "rgba(124,92,252,0.12)" : "transparent",
                fontWeight: isActive ? 600 : 400, fontSize: 13.5,
                transition: "all 0.12s", borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
              })}
            >
              <span style={{ fontSize: 16, lineHeight: 1, minWidth: 20, textAlign: "center" }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Conectar */}
        <div style={{ padding: "14px 12px", borderTop: "1px solid var(--border)" }}>
          <a href={oauthUrl} className="btn btn-primary" style={{ width: "100%", fontSize: 13 }}>
            + Conectar conta
          </a>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, overflow: "auto", minWidth: 0, background: "var(--bg)" }}>
        {/* Toast */}
        {toast && (
          <div style={{
            position: "fixed", top: 20, right: 20, zIndex: 1000,
            padding: "12px 20px", borderRadius: 12, fontSize: 13, fontWeight: 500,
            background: toast.type === "success" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
            color: toast.type === "success" ? "var(--success)" : "var(--danger)",
            border: `1px solid ${toast.type === "success" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
            boxShadow: "var(--shadow)", backdropFilter: "blur(12px)",
            animation: "slideIn 0.2s ease",
          }}>
            {toast.type === "success" ? "✅" : "❌"} {toast.msg}
          </div>
        )}
        {swStatus === "unsupported" && (
          <div style={{ margin: "16px 32px 0", padding: "10px 16px", borderRadius: 10, fontSize: 12, background: "rgba(245,158,11,0.1)", color: "var(--warning)", border: "1px solid rgba(245,158,11,0.25)" }}>
            ⚠️ Navegador não suporta Service Worker. Agendamentos só funcionam com a aba aberta.
          </div>
        )}
        <Routes>
          <Route path="/"          element={<Accounts />} />
          <Route path="/novo"      element={<NewPost />} />
          <Route path="/agendar"   element={<Schedule />} />
          <Route path="/historico" element={<History />} />
        </Routes>
      </main>

      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>
    </div>
  );
}
