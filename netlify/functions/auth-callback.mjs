const GRAPH = "https://graph.facebook.com/v21.0";

async function getPageToken(pageId, userToken) {
  const res  = await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${userToken}`);
  const data = await res.json();
  console.log(`getPageToken(${pageId}):`, JSON.stringify(data).slice(0, 200));
  return data.access_token || null;
}

export const handler = async (event) => {
  const code = event.queryStringParameters?.code;
  if (!code) return { statusCode: 302, headers: { Location: "/?error=sem_codigo" } };

  const APP_ID       = process.env.META_APP_ID;
  const APP_SECRET   = process.env.META_APP_SECRET;
  const REDIRECT_URI = process.env.META_REDIRECT_URI;

  try {
    // 1. Token curto
    const tokenRes  = await fetch(`${GRAPH}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code=${code}`);
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error.message);

    // 2. Token longo
    const longRes   = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`);
    const longData  = await longRes.json();
    const userToken = longData.access_token || tokenData.access_token;
    console.log("userToken obtido:", !!userToken);

    const accounts  = [];
    const seenIgIds = new Set();

    const processPage = async (pageId, token, source, bmInfo = {}) => {
      try {
        console.log(`processPage(${pageId}, source=${source})`);
        const igRes  = await fetch(`${GRAPH}/${pageId}?fields=instagram_business_account&access_token=${token}`);
        const igData = await igRes.json();
        console.log(`  -> igData:`, JSON.stringify(igData).slice(0, 200));
        if (!igData.instagram_business_account) return;

        const igId = igData.instagram_business_account.id;
        if (seenIgIds.has(igId)) { console.log(`  -> duplicado, pulando`); return; }

        const detailRes = await fetch(`${GRAPH}/${igId}?fields=username,profile_picture_url,account_type,name&access_token=${token}`);
        const detail    = await detailRes.json();
        console.log(`  -> detail:`, JSON.stringify(detail).slice(0, 200));
        if (!detail.username) return;

        let finalToken = token;
        try {
          const lr = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${token}`);
          const ld = await lr.json();
          if (ld.access_token) finalToken = ld.access_token;
        } catch (_) {}

        seenIgIds.add(igId);
        accounts.push({
          id: igId, username: detail.username || "", name: detail.name || detail.username || "",
          profile_picture: detail.profile_picture_url || "", account_type: detail.account_type || "BUSINESS",
          access_token: finalToken, page_id: pageId, connected_at: new Date().toISOString(), source, ...bmInfo,
        });
        console.log(`  ✓ conta adicionada: @${detail.username}`);
      } catch (e) { console.log(`  ERRO em processPage:`, e.message); }
    };

    // 3. Páginas pessoais
    const pagesRes  = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${userToken}`);
    const pagesData = await pagesRes.json();
    console.log("Páginas pessoais:", JSON.stringify(pagesData.data?.map(p => ({ id: p.id, name: p.name, hasToken: !!p.access_token }))));
    for (const page of (pagesData.data || [])) {
      await processPage(page.id, page.access_token || userToken, "personal");
    }

    // 4. Business Managers
    const bmRes  = await fetch(`${GRAPH}/me/businesses?fields=id,name&limit=50&access_token=${userToken}`);
    const bmData = await bmRes.json();
    console.log("Business Managers:", JSON.stringify(bmData.data?.map(b => ({ id: b.id, name: b.name }))));

    for (const bm of (bmData.data || [])) {
      const bmInfo = { business_id: bm.id, business_name: bm.name };

      const ownedRes  = await fetch(`${GRAPH}/${bm.id}/owned_pages?fields=id,name&limit=100&access_token=${userToken}`);
      const ownedData = await ownedRes.json();
      console.log(`BM ${bm.name} owned_pages:`, JSON.stringify(ownedData.data?.map(p => p.name)));
      for (const page of (ownedData.data || [])) {
        const pageToken = await getPageToken(page.id, userToken);
        if (!pageToken) { console.log(`  sem token para página ${page.id}`); continue; }
        await processPage(page.id, pageToken, "business", bmInfo);
      }

      const clientRes  = await fetch(`${GRAPH}/${bm.id}/client_pages?fields=id,name&limit=100&access_token=${userToken}`);
      const clientData = await clientRes.json();
      console.log(`BM ${bm.name} client_pages:`, JSON.stringify(clientData.data?.map(p => p.name)));
      for (const page of (clientData.data || [])) {
        const pageToken = await getPageToken(page.id, userToken);
        if (!pageToken) { console.log(`  sem token para página ${page.id}`); continue; }
        await processPage(page.id, pageToken, "client", bmInfo);
      }
    }

    console.log("Total contas encontradas:", accounts.length);

    if (accounts.length === 0) {
      return {
        statusCode: 302,
        headers: { Location: "/?error=" + encodeURIComponent("Nenhuma conta Instagram Business encontrada. Verifique se as páginas têm contas Instagram vinculadas e se são do tipo Business ou Creator.") },
      };
    }

    const encoded = Buffer.from(JSON.stringify(accounts)).toString("base64url");
    return { statusCode: 302, headers: { Location: `/?accounts=${encoded}` } };

  } catch (err) {
    console.error("auth-callback error:", err);
    return { statusCode: 302, headers: { Location: `/?error=${encodeURIComponent(err.message)}` } };
  }
};
