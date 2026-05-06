// Atualizado para Graph API v21.0 — busca páginas pessoais + Business Managers
const GRAPH = "https://graph.facebook.com/v21.0";

async function getIgAccount(pageId, pageToken, APP_ID, APP_SECRET) {
  // Buscar conta Instagram vinculada à página
  const igRes  = await fetch(`${GRAPH}/${pageId}?fields=instagram_business_account&access_token=${pageToken}`);
  const igData = await igRes.json();
  const igAccount = igData.instagram_business_account;
  if (!igAccount) return null;

  const igId = igAccount.id;

  // Detalhes da conta IG
  const detailRes = await fetch(`${GRAPH}/${igId}?fields=username,profile_picture_url,account_type,name&access_token=${pageToken}`);
  const detail    = await detailRes.json();
  if (detail.error) return null;

  // Token de longa duração para a página
  const longRes = await fetch(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${pageToken}`
  );
  const longData   = await longRes.json();
  const finalToken = longData.access_token || pageToken;

  return {
    id:              igId,
    username:        detail.username || "",
    name:            detail.name || detail.username || "",
    profile_picture: detail.profile_picture_url || "",
    account_type:    detail.account_type || "BUSINESS",
    access_token:    finalToken,
    page_id:         pageId,
    connected_at:    new Date().toISOString(),
  };
}

export const handler = async (event) => {
  const code = event.queryStringParameters?.code;
  if (!code) {
    return { statusCode: 302, headers: { Location: "/?error=sem_codigo" } };
  }

  const APP_ID       = process.env.META_APP_ID;
  const APP_SECRET   = process.env.META_APP_SECRET;
  const REDIRECT_URI = process.env.META_REDIRECT_URI;

  try {
    // 1. Trocar code por token curto
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error.message);

    // 2. Trocar por token longo (60 dias)
    const longRes = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const longData  = await longRes.json();
    const userToken = longData.access_token || tokenData.access_token;

    const accounts   = [];
    const seenIgIds  = new Set(); // evita duplicatas

    // ── 3. Páginas pessoais (me/accounts) ────────────────────────────────
    const pagesRes  = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${userToken}`);
    const pagesData = await pagesRes.json();
    const pages     = pagesData.data || [];

    for (const page of pages) {
      const acc = await getIgAccount(page.id, page.access_token, APP_ID, APP_SECRET);
      if (acc && !seenIgIds.has(acc.id)) {
        seenIgIds.add(acc.id);
        accounts.push({ ...acc, source: "personal" });
      }
    }

    // ── 4. Páginas dos Business Managers ─────────────────────────────────
    const bmRes  = await fetch(`${GRAPH}/me/businesses?fields=id,name&limit=50&access_token=${userToken}`);
    const bmData = await bmRes.json();
    const bms    = bmData.data || [];

    for (const bm of bms) {
      // Buscar páginas owned pelo BM
      const bmPagesRes  = await fetch(
        `${GRAPH}/${bm.id}/owned_pages?fields=id,name,access_token&limit=100&access_token=${userToken}`
      );
      const bmPagesData = await bmPagesRes.json();
      const bmPages     = bmPagesData.data || [];

      for (const page of bmPages) {
        // Página pode não vir com access_token via BM — usa o userToken como fallback
        const pageToken = page.access_token || userToken;
        const acc = await getIgAccount(page.id, pageToken, APP_ID, APP_SECRET);
        if (acc && !seenIgIds.has(acc.id)) {
          seenIgIds.add(acc.id);
          accounts.push({ ...acc, source: "business", business_id: bm.id, business_name: bm.name });
        }
      }

      // Buscar também páginas client (caso o BM tenha acesso a páginas de clientes)
      const clientPagesRes  = await fetch(
        `${GRAPH}/${bm.id}/client_pages?fields=id,name,access_token&limit=100&access_token=${userToken}`
      );
      const clientPagesData = await clientPagesRes.json();
      const clientPages     = clientPagesData.data || [];

      for (const page of clientPages) {
        const pageToken = page.access_token || userToken;
        const acc = await getIgAccount(page.id, pageToken, APP_ID, APP_SECRET);
        if (acc && !seenIgIds.has(acc.id)) {
          seenIgIds.add(acc.id);
          accounts.push({ ...acc, source: "client", business_id: bm.id, business_name: bm.name });
        }
      }
    }

    // ── 5. Retorno ────────────────────────────────────────────────────────
    if (accounts.length === 0) {
      return {
        statusCode: 302,
        headers: {
          Location: "/?error=" + encodeURIComponent(
            "Nenhuma conta Instagram Business encontrada. Verifique se as páginas têm contas Instagram vinculadas e se são do tipo Business ou Creator."
          ),
        },
      };
    }

    const encoded = Buffer.from(JSON.stringify(accounts)).toString("base64url");
    return { statusCode: 302, headers: { Location: `/?accounts=${encoded}` } };

  } catch (err) {
    console.error("auth-callback error:", err);
    return { statusCode: 302, headers: { Location: `/?error=${encodeURIComponent(err.message)}` } };
  }
};
