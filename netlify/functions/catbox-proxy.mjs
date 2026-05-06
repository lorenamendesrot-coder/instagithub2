/**
 * catbox-proxy.mjs
 * Suporta upload direto e chunked para arquivos grandes
 */

const chunks = {}; // armazena chunks em memória durante o upload

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
    const body = JSON.parse(event.body || "{}");
    const { fileBase64, fileName, mimeType, uploadId, chunkIndex, totalChunks, isLastChunk } = body;

    if (!fileBase64 || !fileName || !mimeType) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios ausentes" }) };
    }

    // Upload em chunk
    if (uploadId !== undefined && totalChunks > 1) {
      if (!chunks[uploadId]) chunks[uploadId] = [];
      chunks[uploadId][chunkIndex] = fileBase64;

      // Se não é o último chunk, só confirma recebimento
      if (!isLastChunk) {
        return { statusCode: 200, headers, body: JSON.stringify({ received: chunkIndex }) };
      }

      // Último chunk: remonta o base64 completo e faz upload
      const fullBase64   = chunks[uploadId].join("");
      delete chunks[uploadId];
      const fileBuffer   = Buffer.from(fullBase64, "base64");
      const url          = await uploadBufferToCatbox(fileBuffer, fileName, mimeType);
      return { statusCode: 200, headers, body: JSON.stringify({ url }) };
    }

    // Upload direto (arquivo pequeno)
    const fileBuffer = Buffer.from(fileBase64, "base64");
    const url        = await uploadBufferToCatbox(fileBuffer, fileName, mimeType);
    return { statusCode: 200, headers, body: JSON.stringify({ url }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

async function uploadBufferToCatbox(fileBuffer, fileName, mimeType) {
  const boundary = "----Boundary" + Date.now().toString(36);

  const headerPart = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="fileToUpload"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );
  const closingPart = Buffer.from(`\r\n--${boundary}--`);
  const finalBody   = Buffer.concat([headerPart, fileBuffer, closingPart]);

  const response = await fetch("https://catbox.moe/user/api.php", {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(finalBody.length),
      "User-Agent": "Mozilla/5.0",
    },
    body: finalBody,
  });

  const text = await response.text();
  if (!response.ok)                throw new Error(`Catbox ${response.status}: ${text}`);
  if (!text.startsWith("https://")) throw new Error(text || "Resposta inesperada do Catbox");
  return text.trim();
}
