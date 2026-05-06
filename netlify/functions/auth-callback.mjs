// Graph API v21.0 — busca páginas pessoais + Business Managers
const GRAPH = "https://graph.facebook.com/v21.0";

// Busca o token de acesso de uma página específica via userToken
async function getPageToken(pageId, userToken) {
  const res  = await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${userToken}`);
  const data = await res.json();
  return data.access_token || null;
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

    const accounts  = [];
    const seenIgIds = new Set();

    // helper: dado pageId + token, monta o objeto da conta IG
    const processPage = async (pageId, token, source, bmInfo = {}) => {
      try {
        const igRes  = await fetch(`${GRAPH}/${pageId}?fields=instagram_business_account&access_token=${token}`);
        const igData = await igRes.json();
        if (!igData.instagram_business_account) return;

        const igId = igData.instagram_business_account.id;
        if (seenIgIds.has(igId)) return;

        const detailRes = await fetch(`${GRAPH}/${igId}?fields=username,profile_picture_url,account_type,name&access_token=${token}`);
        const detail    = await detailRes.json();
        if (!detail.username) return;

        // Token longo para a página
        let finalToken = token;
        try {
          const lr = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${token}`);
          const ld = await lr.json();
          if (ld.access_token) finalToken = ld.access_token;
        } catch (_) {}

        seenIgIds.add(igId);
        accounts.push({
          id:              igId,
          username:        detail.username || "",
          name:            detail.name || detail.username || "",
          profile_picture: detail.profile_picture_url || "",
          account_type:    detail.account_type || "BUSINESS",
          access_token:    finalToken,
          page_id:         pageId,
          connected_at:    new Date().toISOString(),
          source,
          ...bmInfo,
        });
      } catch (_) {}
    };

    // ── 3. Páginas pessoais ───────────────────────────────────────────────
    const pagesRes  = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${userToken}`);
    const pagesData = await pagesRes.json();
    for (const page of (pagesData.data || [])) {
      await processPage(page.id, page.access_token || userToken, "personal");
    }

    // ── 4. Business Managers ──────────────────────────────────────────────
    const bmRes  = await fetch(`${GRAPH}/me/businesses?fields=id,name&limit=50&access_token=${userToken}`);
    const bmData = await bmRes.json();

    for (const bm of (bmData.data || [])) {
      const bmInfo = { business_id: bm.id, business_name: bm.name };

      // owned_pages
      const ownedRes  = await fetch(`${GRAPH}/${bm.id}/owned_pages?fields=id,name&limit=100&access_token=${userToken}`);
      const ownedData = await ownedRes.json();
      for (const page of (ownedData.data || [])) {
        // Páginas do BM não vêm com access_token — busca separado
        const pageToken = await getPageToken(page.id, userToken);
        if (!pageToken) continue;
        await processPage(page.id, pageToken, "business", bmInfo);
      }

      // client_pages
      const clientRes  = await fetch(`${GRAPH}/${bm.id}/client_pages?fields=id,name&limit=100&access_token=${userToken}`);
      const clientData = await clientRes.json();
      for (const page of (clientData.data || [])) {
        const pageToken = await getPageToken(page.id, userToken);
        if (!pageToken) continue;
        await processPage(page.id, pageToken, "client", bmInfo);
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
