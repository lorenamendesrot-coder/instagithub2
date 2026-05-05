const GRAPH = "https://graph.facebook.com/v19.0";

export const handler = async (event) => {
  const code = event.queryStringParameters?.code;
  if (!code) {
    return { statusCode: 302, headers: { Location: "/?error=sem_codigo" } };
  }

  const APP_ID = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;
  const REDIRECT_URI = process.env.META_REDIRECT_URI;

  try {
    // Trocar code por token curto
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error.message);

    // Trocar por token longo (60 dias)
    const longRes = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longRes.json();
    const userToken = longData.access_token || tokenData.access_token;

    // Buscar páginas do Facebook
    const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${userToken}`);
    const pagesData = await pagesRes.json();
    const pages = pagesData.data || [];

    const accounts = [];

    for (const page of pages) {
      const pageToken = page.access_token;
      const pageId = page.id;

      // Buscar conta Instagram vinculada
      const igRes = await fetch(
        `${GRAPH}/${pageId}?fields=instagram_business_account&access_token=${pageToken}`
      );
      const igData = await igRes.json();
      const igAccount = igData.instagram_business_account;
      if (!igAccount) continue;

      const igId = igAccount.id;

      // Buscar detalhes
      const detailRes = await fetch(
        `${GRAPH}/${igId}?fields=username,profile_picture_url,account_type&access_token=${pageToken}`
      );
      const detail = await detailRes.json();

      accounts.push({
        id: igId,
        username: detail.username || "",
        profile_picture: detail.profile_picture_url || "",
        account_type: detail.account_type || "BUSINESS",
        access_token: pageToken,
        page_id: pageId,
        connected_at: new Date().toISOString(),
      });
    }

    // Codificar contas em base64 para passar pela URL
    const encoded = Buffer.from(JSON.stringify(accounts)).toString("base64url");

    return {
      statusCode: 302,
      headers: { Location: `/?accounts=${encoded}` },
    };
  } catch (err) {
    const msg = encodeURIComponent(err.message);
    return {
      statusCode: 302,
      headers: { Location: `/?error=${msg}` },
    };
  }
};
