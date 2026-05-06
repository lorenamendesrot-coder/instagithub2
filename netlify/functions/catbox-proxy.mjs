import https from "https";

const chunks = {};

function postToCatbox(fileBuffer, fileName, mimeType) {
  return new Promise((resolve, reject) => {
    const boundary   = "----Boundary" + Date.now().toString(36);
    const headerPart = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="fileToUpload"; filename="${fileName}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    );
    const closingPart = Buffer.from(`\r\n--${boundary}--`);
    const body        = Buffer.concat([headerPart, fileBuffer, closingPart]);

    const options = {
      hostname: "catbox.moe",
      path:     "/user/api.php",
      method:   "POST",
      timeout:  25000, // 25s timeout
      headers: {
        "Content-Type":   `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
        "User-Agent":     "Mozilla/5.0",
        "Accept":         "*/*",
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        console.log("Catbox status:", res.statusCode, "response:", text.slice(0, 200));
        if (text.startsWith("https://")) resolve(text);
        else reject(new Error(`Catbox erro: ${text || res.statusCode}`));
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout ao conectar com Catbox (25s)"));
    });

    req.on("error", (err) => {
      console.error("Erro https:", err.message);
      reject(new Error(`Erro de rede: ${err.message}`));
    });

    req.write(body);
    req.end();
  });
}

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":                 "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  try {
    console.log("catbox-proxy chamado, body size:", event.body?.length || 0);

    const body = JSON.parse(event.body || "{}");
    const { fileBase64, fileName, mimeType, uploadId, chunkIndex, totalChunks, isLastChunk } = body;

    if (!fileBase64 || !fileName || !mimeType) {
      console.error("Campos ausentes:", { fileBase64: !!fileBase64, fileName, mimeType });
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios ausentes" }) };
    }

    console.log("Arquivo:", fileName, mimeType, "base64 length:", fileBase64.length);

    // Upload em chunks
    if (uploadId !== undefined && totalChunks > 1) {
      if (!chunks[uploadId]) chunks[uploadId] = [];
      chunks[uploadId][chunkIndex] = fileBase64;
      console.log(`Chunk ${chunkIndex + 1}/${totalChunks} recebido`);

      if (!isLastChunk)
        return { statusCode: 200, headers, body: JSON.stringify({ received: chunkIndex }) };

      const fullBase64 = chunks[uploadId].join("");
      delete chunks[uploadId];
      console.log("Todos chunks recebidos, enviando para Catbox...");
      const url = await postToCatbox(Buffer.from(fullBase64, "base64"), fileName, mimeType);
      return { statusCode: 200, headers, body: JSON.stringify({ url }) };
    }

    // Upload direto
    console.log("Upload direto para Catbox...");
    const url = await postToCatbox(Buffer.from(fileBase64, "base64"), fileName, mimeType);
    console.log("Upload OK:", url);
    return { statusCode: 200, headers, body: JSON.stringify({ url }) };

  } catch (err) {
    console.error("Erro no proxy:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
