const GRAPH = "https://graph.facebook.com/v21.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ✅ CORS restrito ao domínio próprio
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

// ✅ Validação de URL de mídia
function isValidMediaUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ✅ Verificação de token antes de publicar
async function verifyToken(token) {
  try {
    const res  = await fetch(`${GRAPH}/me?fields=id&access_token=${token}`);
    const data = await res.json();
    if (data.error) {
      const code = data.error.code;
      // códigos 190 = token inválido/expirado
      if (code === 190) return { valid: false, expired: true };
      return { valid: false, expired: false };
    }
    return { valid: true, expired: false };
  } catch {
    return { valid: true, expired: false }; // falha de rede — não bloquear, deixar a Meta decidir
  }
}

async function waitForContainer(containerId, token, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(6000);
    const res  = await fetch(`${GRAPH}/${containerId}?fields=status_code,status&access_token=${token}`);
    const data = await res.json();
    if (data.status_code === "FINISHED") return true;
    if (data.status_code === "ERROR")    return false;
  }
  return false;
}

async function publishOne({ account, media_url, media_type, post_type, caption }) {
  const { id: igId, access_token: token } = account;
  const isVideo = media_type === "VIDEO";

  // ✅ Verificar token antes de tentar publicar
  const tokenCheck = await verifyToken(token);
  if (!tokenCheck.valid) {
    const msg = tokenCheck.expired
      ? "Token expirado. Reconecte a conta no painel de Contas."
      : "Token inválido. Reconecte a conta no painel de Contas.";
    return { success: false, error: msg, token_expired: tokenCheck.expired };
  }

  try {
    let payload = { access_token: token };

    if (post_type === "FEED") {
      payload = isVideo
        ? { ...payload, video_url: media_url, media_type: "REELS", caption }
        : { ...payload, image_url: media_url, caption };
    } else if (post_type === "REEL") {
      if (!isVideo) return { success: false, error: "Reels só aceita vídeo via API do Instagram. Use a mídia do tipo VIDEO." };
      payload = { ...payload, video_url: media_url, media_type: "REELS", caption, share_to_feed: true };
    } else if (post_type === "STORY") {
      payload = isVideo
        ? { ...payload, video_url: media_url, media_type: "VIDEO" }
        : { ...payload, image_url: media_url };
    }

    const cRes  = await fetch(`${GRAPH}/${igId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const cData = await cRes.json();
    if (cData.error) return { success: false, error: cData.error.message };

    if (isVideo || post_type === "REEL") {
      const ready = await waitForContainer(cData.id, token);
      if (!ready) return { success: false, error: "Timeout no processamento do vídeo (120s). Tente novamente." };
    }

    const pRes  = await fetch(`${GRAPH}/${igId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: cData.id, access_token: token }),
    });
    const pData = await pRes.json();
    if (pData.error) return { success: false, error: pData.error.message };

    return { success: true, media_id: pData.id, published_at: new Date().toISOString() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export const handler = async (event) => {
  // ✅ CORS restrito
  const requestOrigin = event.headers?.origin || "";
  const corsOrigin = ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN
    ? ALLOWED_ORIGIN
    : ALLOWED_ORIGIN || "*";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    ...(corsOrigin !== "*" && { "Vary": "Origin" }),
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { accounts, media_url, media_type, post_type, captions, default_caption, delay_seconds } = body;

  // ✅ Validação ampliada dos campos de entrada
  if (!accounts?.length || !media_url || !media_type || !post_type) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios ausentes" }) };
  }

  const VALID_MEDIA_TYPES = ["IMAGE", "VIDEO"];
  const VALID_POST_TYPES  = ["FEED", "REEL", "STORY"];

  if (!VALID_MEDIA_TYPES.includes(media_type)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `media_type inválido: ${media_type}` }) };
  }
  if (!VALID_POST_TYPES.includes(post_type)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `post_type inválido: ${post_type}` }) };
  }
  if (!isValidMediaUrl(media_url)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "media_url deve ser uma URL HTTPS válida" }) };
  }

  const delayMs = (parseInt(delay_seconds) || 0) * 1000;
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const caption = captions?.[account.id] ?? default_caption ?? "";
    const result  = await publishOne({ account, media_url, media_type, post_type, caption });
    results.push({ account_id: account.id, username: account.username, ...result });
  }

  return { statusCode: 200, headers, body: JSON.stringify({ results }) };
};
