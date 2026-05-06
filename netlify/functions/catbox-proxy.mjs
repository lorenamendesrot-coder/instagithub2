/**
 * catbox-proxy.mjs — usa https nativo do Node (compatível com qualquer versão)
 */
import https from "https";

const chunks = {};

function postToCatbox(fileBuffer, fileName, mimeType) {
  return new Promise((resolve, reject) => {
    const boundary  = "----Boundary" + Date.now().toString(36);
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
      headers:  {
        "Content-Type":   `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
        "User-Agent":     "Mozilla/5.0",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        if (data.startsWith("https://")) resolve(data.trim());
        else reject(new Error(data || `Catbox retornou ${res.statusCode}`));
      });
    });

    req.on("error", reject);
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
    const body = JSON.parse(event.body || "{}");
    const { fileBase64, fileName, mimeType, uploadId, chunkIndex, totalChunks, isLastChunk } = body;

    if (!fileBase64 || !fileName || !mimeType)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios ausentes" }) };

    // Upload em chunks
    if (uploadId !== undefined && totalChunks > 1) {
      if (!chunks[uploadId]) chunks[uploadId] = [];
      chunks[uploadId][chunkIndex] = fileBase64;

      if (!isLastChunk)
        return { statusCode: 200, headers, body: JSON.stringify({ received: chunkIndex }) };

      const fullBase64 = chunks[uploadId].join("");
      delete chunks[uploadId];
      const url = await postToCatbox(Buffer.from(fullBase64, "base64"), fileName, mimeType);
      return { statusCode: 200, headers, body: JSON.stringify({ url }) };
    }

    // Upload direto
    const url = await postToCatbox(Buffer.from(fileBase64, "base64"), fileName, mimeType);
    return { statusCode: 200, headers, body: JSON.stringify({ url }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
