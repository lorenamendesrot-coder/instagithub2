/**
 * catbox-proxy.mjs — Proxy para upload no Catbox.moe
 * Necessário porque o browser bloqueia POST direto para catbox.moe (CORS)
 */

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  try {
    // O body vem como base64 quando é multipart/form-data
    const isBase64 = event.isBase64Encoded;
    const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";

    // Repassa o body exatamente como chegou para o Catbox
    const bodyBuffer = isBase64
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "");

    const response = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "User-Agent": "Mozilla/5.0",
      },
      body: bodyBuffer,
    });

    const text = await response.text();

    if (!response.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `Catbox retornou ${response.status}: ${text}` }),
      };
    }

    // Catbox retorna a URL direto como texto puro
    if (text.startsWith("https://")) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ url: text.trim() }),
      };
    }

    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: text || "Resposta inesperada do Catbox" }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: `Erro interno: ${err.message}` }),
    };
  }
};
