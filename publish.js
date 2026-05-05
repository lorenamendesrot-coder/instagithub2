const GRAPH = "https://graph.facebook.com/v19.0";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForContainer(containerId, token, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(6000);
    const res = await fetch(
      `${GRAPH}/${containerId}?fields=status_code&access_token=${token}`
    );
    const data = await res.json();
    if (data.status_code === "FINISHED") return true;
    if (data.status_code === "ERROR") return false;
  }
  return false;
}

async function publishOne({ account, media_url, media_type, post_type, caption }) {
  const { id: igId, access_token: token } = account;
  const isVideo = media_type === "VIDEO";

  try {
    let payload = { access_token: token };

    if (post_type === "FEED") {
      payload = isVideo
        ? { ...payload, video_url: media_url, media_type: "REELS", caption }
        : { ...payload, image_url: media_url, caption };
    } else if (post_type === "REEL") {
      payload = { ...payload, video_url: media_url, media_type: "REELS", caption, share_to_feed: true };
    } else if (post_type === "STORY") {
      payload = isVideo
        ? { ...payload, video_url: media_url, media_type: "VIDEO" }
        : { ...payload, image_url: media_url };
    }

    // 1. Criar container
    const cRes = await fetch(`${GRAPH}/${igId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const cData = await cRes.json();
    if (cData.error) return { success: false, error: cData.error.message };

    // 2. Aguardar processamento de vídeo
    if (isVideo || post_type === "REEL") {
      const ready = await waitForContainer(cData.id, token);
      if (!ready) return { success: false, error: "Timeout no processamento do vídeo" };
    }

    // 3. Publicar
    const pRes = await fetch(`${GRAPH}/${igId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: cData.id, access_token: token }),
    });
    const pData = await pRes.json();
    if (pData.error) return { success: false, error: pData.error.message };

    return { success: true, media_id: pData.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  const body = JSON.parse(event.body || "{}");
  const {
    accounts,       // array de objetos { id, username, access_token, ... }
    media_url,
    media_type,     // "IMAGE" | "VIDEO"
    post_type,      // "FEED" | "REEL" | "STORY"
    captions,       // objeto { [account_id]: "legenda específica" }
    default_caption,
    delay_seconds,  // delay em segundos entre postagens
  } = body;

  if (!accounts?.length || !media_url || !media_type || !post_type) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Campos obrigatórios ausentes" }),
    };
  }

  const delayMs = (parseInt(delay_seconds) || 0) * 1000;
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];

    // Delay entre postagens (não aplica na primeira)
    if (i > 0 && delayMs > 0) {
      await sleep(delayMs);
    }

    // Legenda: usa a específica da conta, ou a padrão
    const caption = captions?.[account.id] ?? default_caption ?? "";

    const result = await publishOne({ account, media_url, media_type, post_type, caption });

    results.push({
      account_id: account.id,
      username: account.username,
      ...result,
      published_at: result.success ? new Date().toISOString() : null,
    });
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results }),
  };
};
