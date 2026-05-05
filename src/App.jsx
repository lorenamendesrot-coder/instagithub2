import { Routes, Route, NavLink } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import Accounts from "./pages/Accounts.jsx";
import NewPost from "./pages/NewPost.jsx";
import Schedule from "./pages/Schedule.jsx";
import History from "./pages/History.jsx";
import { dbGetAll, dbPut, dbPutMany, dbDelete, dbClear } from "./useDB.js";

// ─── Accounts (ainda usa localStorage — não precisa de IDB) ─────────────────
export const useAccounts = () => {
  const [accounts, setAccounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ig_accounts") || "[]"); } catch { return []; }
  });
  const saveAccounts = (list) => {
    localStorage.setItem("ig_accounts", JSON.stringify(list));
    setAccounts(list);
  };
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

// ─── History — IndexedDB ────────────────────────────────────────────────────
export const useHistory = () => {
  const [history, setHistory] = useState([]);

  const reload = useCallback(async () => {
    const all = await dbGetAll("history");
    all.sort((a, b) => b.id - a.id);
    setHistory(all.slice(0, 200));
  }, []);

  useEffect(() => { reload(); }, []);

  const addEntry = async (entry) => {
    await dbPut("history", entry);
    reload();
  };

  const clearHistory = async () => {
    await dbClear("history");
    setHistory([]);
  };

  return { history, addEntry, clearHistory, reloadHistory: reload };
};

// ─── SW registration ─────────────────────────────────────────────────────────
function registerSW(setSwStatus) {
  if (!("serviceWorker" in navigator)) {
    setSwStatus("unsupported");
    return;
  }
  navigator.serviceWorker
    .register("/sw.js")
    .then(() => {
      setSwStatus("active");
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data?.type === "QUEUE_UPDATE") {
          window.dispatchEvent(new CustomEvent("sw:queue-update"));
        }
      });
    })
    .catch(() => setSwStatus("error"));
}

const NAV = [
  { to: "/",          label: "Contas",       icon: "○" },
  { to: "/novo",      label: "Novo post",    icon: "+" },
  { to: "/agendar",   label: "Agendamentos", icon: "◷" },
  { to: "/historico", label: "Histórico",    icon: "≡" },
];

export default function App() {
  const { addAccounts, accounts } = useAccounts();
  const [toast, setToast] = useState(null);
  const [swStatus, setSwStatus] = useState("loading");

  useEffect(() => { registerSW(setSwStatus); }, []);

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

  const swDot = {
    active:      { color: "var(--success)", title: "Scheduler ativo em background" },
    error:       { color: "var(--danger)",  title: "Scheduler inativo — erro ao registrar SW" },
    unsupported: { color: "var(--warning)", title: "Navegador não suporta Service Worker" },
    loading:     { color: "var(--muted)",   title: "Iniciando scheduler..." },
  }[swStatus];

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: 220, background: "var(--bg2)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", padding: "20px 0", flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ padding: "0 18px 20px", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 8 }}>
            Insta Manager
            <span title={swDot.title} style={{ fontSize: 8, color: swDot.color, lineHeight: 1 }}>⬤</span>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>Meta Graph API</div>
        </div>

        {accounts.length > 0 && (
          <div style={{ padding: "8px 14px 10px", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, fontWeight: 500, letterSpacing: "0.03em" }}>CONTAS ({accounts.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 160, overflowY: "auto" }}>
              {accounts.map((acc) => (
                <div key={acc.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {acc.profile_picture
                    ? <img src={acc.profile_picture} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--bg3)", flexShrink: 0 }} />}
                  <span style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{acc.username}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <nav style={{ padding: "8px 10px", flex: 1 }}>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              style={({ isActive }) => ({
                display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, marginBottom: 2,
                color: isActive ? "var(--accent-light)" : "var(--muted)", background: isActive ? "#7c5cfc18" : "transparent",
                fontWeight: isActive ? 500 : 400, fontSize: 14, transition: "all 0.12s",
              })}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>{item.icon}</span>{item.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: "12px 10px 0", borderTop: "1px solid var(--border)" }}>
          <a href={oauthUrl} className="btn btn-primary" style={{ width: "100%", fontSize: 13 }}>+ Conectar conta</a>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
        {toast && (
          <div style={{ margin: "16px 32px 0", padding: "11px 16px", borderRadius: 10, fontSize: 13, background: toast.type === "success" ? "#05422e" : "#3b0d0d", color: toast.type === "success" ? "var(--success)" : "var(--danger)", border: `1px solid ${toast.type === "success" ? "#34d39940" : "#f8717140"}` }}>
            {toast.msg}
          </div>
        )}
        {swStatus === "unsupported" && (
          <div style={{ margin: "16px 32px 0", padding: "10px 16px", borderRadius: 10, fontSize: 12, background: "#3b2500", color: "var(--warning)", border: "1px solid #fbbf2440" }}>
            ⚠️ Seu navegador não suporta Service Worker. Agendamentos só funcionam com a aba aberta.
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
