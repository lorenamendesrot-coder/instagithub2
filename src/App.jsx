import { Routes, Route, NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import Accounts from "./pages/Accounts.jsx";
import NewPost from "./pages/NewPost.jsx";
import Schedule from "./pages/Schedule.jsx";
import History from "./pages/History.jsx";

export const useAccounts = () => {
  const [accounts, setAccounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ig_accounts") || "[]"); } catch { return []; }
  });
  const saveAccounts = (list) => { localStorage.setItem("ig_accounts", JSON.stringify(list)); setAccounts(list); };
  const addAccounts = (newAccs) => {
    const existing = JSON.parse(localStorage.getItem("ig_accounts") || "[]");
    const merged = [...existing];
    for (const acc of newAccs) {
      const idx = merged.findIndex((a) => a.id === acc.id);
      if (idx >= 0) merged[idx] = acc; else merged.push(acc);
    }
    saveAccounts(merged);
    return merged.length - existing.length;
  };
  const removeAccount = (id) => saveAccounts(accounts.filter((a) => a.id !== id));
  return { accounts, addAccounts, removeAccount, setAccounts: saveAccounts };
};

export const useHistory = () => {
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ig_history") || "[]"); } catch { return []; }
  });
  const addEntry = (entry) => {
    const prev = JSON.parse(localStorage.getItem("ig_history") || "[]");
    const updated = [entry, ...prev].slice(0, 200);
    localStorage.setItem("ig_history", JSON.stringify(updated));
    setHistory(updated);
  };
  const clearHistory = () => { localStorage.removeItem("ig_history"); setHistory([]); };
  return { history, addEntry, clearHistory };
};

const NAV = [
  { to: "/",          label: "Contas",       icon: "⊙", desc: "Gerenciar contas" },
  { to: "/novo",      label: "Publicar",     icon: "↑", desc: "Publicar agora" },
  { to: "/agendar",   label: "Agendar",      icon: "◷", desc: "Fila de posts" },
  { to: "/historico", label: "Histórico",    icon: "≡", desc: "Posts anteriores" },
];

export default function App() {
  const { addAccounts, accounts } = useAccounts();
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("accounts");
    const error = params.get("error");
    window.history.replaceState({}, "", "/");
    if (encoded) {
      try {
        const accs = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
        addAccounts(accs);
        setToast({ type: "success", msg: `${accs.length} conta(s) conectada(s) com sucesso!` });
      } catch { setToast({ type: "error", msg: "Erro ao importar contas." }); }
      setTimeout(() => setToast(null), 4000);
    }
    if (error) { setToast({ type: "error", msg: decodeURIComponent(error) }); setTimeout(() => setToast(null), 5000); }
  }, []);

  const APP_ID = import.meta.env.VITE_META_APP_ID;
  const REDIRECT = encodeURIComponent(window.location.origin + "/api/auth-callback");
  const SCOPE = "instagram_basic,instagram_content_publish,pages_read_engagement,pages_show_list,business_management";
  const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${REDIRECT}&scope=${SCOPE}&response_type=code`;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* ── Sidebar ── */}
      <aside style={{
        width: 230, background: "var(--bg2)",
        borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column",
        flexShrink: 0, position: "sticky", top: 0, height: "100vh",
        overflow: "hidden",
      }}>
        {/* Logo */}
        <div style={{ padding: "20px 18px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: "linear-gradient(135deg, #7c5cfc, #a78bfa)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>IG</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em" }}>Insta Manager</div>
              <div style={{ color: "var(--muted)", fontSize: 10, marginTop: 1 }}>Meta Graph API</div>
            </div>
          </div>
        </div>

        <div style={{ height: "1px", background: "var(--border)", margin: "0 14px" }} />

        {/* Contas resumo */}
        {accounts.length > 0 && (
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, letterSpacing: "0.06em", marginBottom: 8, textTransform: "uppercase" }}>
              Contas ativas ({accounts.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 120, overflowY: "auto" }}>
              {accounts.map((acc) => (
                <div key={acc.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {acc.profile_picture
                    ? <img src={acc.profile_picture} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1.5px solid var(--border2)" }} />
                    : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#7c5cfc,#a78bfa)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 700 }}>
                        {acc.username?.[0]?.toUpperCase() || "?"}
                      </div>}
                  <span style={{ fontSize: 12, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    @{acc.username}
                  </span>
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
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", borderRadius: 9, marginBottom: 2,
                color: isActive ? "var(--accent-light)" : "var(--muted)",
                background: isActive ? "var(--accent-glow)" : "transparent",
                fontWeight: isActive ? 600 : 400, fontSize: 13,
                transition: "all 0.12s",
                borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
              })}
            >
              <span style={{ fontSize: 15, lineHeight: 1, width: 18, textAlign: "center" }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Conectar */}
        <div style={{ padding: "12px 12px 20px", borderTop: "1px solid var(--border)" }}>
          <a href={oauthUrl} className="btn btn-primary" style={{ width: "100%", fontSize: 13, borderRadius: 9 }}>
            <span style={{ fontSize: 16 }}>+</span> Conectar conta
          </a>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, overflow: "auto", minWidth: 0, background: "var(--bg)" }}>
        {toast && (
          <div style={{
            margin: "16px 28px 0", padding: "12px 16px", borderRadius: 10, fontSize: 13,
            background: toast.type === "success" ? "var(--success-bg)" : "var(--danger-bg)",
            color: toast.type === "success" ? "var(--success)" : "var(--danger)",
            border: `1px solid ${toast.type === "success" ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span>{toast.type === "success" ? "✓" : "✕"}</span>
            {toast.msg}
          </div>
        )}
        <Routes>
          <Route path="/"          element={<Accounts />} />
          <Route path="/novo"      element={<NewPost />} />
          <Route path="/agendar"   element={<Schedule />} />
          <Route path="/historico" element={<History />} />
        </Routes>
      </main>
    </div>
  );
}
