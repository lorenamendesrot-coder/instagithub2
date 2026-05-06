// catbox-proxy.mjs — agora usa Telegram como CDN (catbox.moe bloqueia IPs de datacenter)
import https from "https";

const BOT_TOKEN = "8364004619:AAHmmnWqfrIVlqfW-0BXrb7Ln3j_xgg-ieM";
const CHAT_ID   = "-1003994898545";

function telegramRequest(method, formBody) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${BOT_TOKEN}/${method}`,
      method: "POST",
      timeout: 60000,
      headers: {
        "Content-Type": formBody.contentType,
        "Content-Length": formBody.buffer.length,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (json.ok) resolve(json.result);
          else reject(new Error(`Telegram erro: ${json.description}`));
        } catch (e) {
          reject(new Error("Resposta inválida do Telegram"));
        }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout Telegram (60s)")); });
    req.on("error", (err) => reject(new Error(`Erro de rede: ${err.message}`)));
    req.write(formBody.buffer);
    req.end();
  });
}

function buildMultipart(fields, file) {
  const boundary = "----TGBoundary" + Date.now().toString(16);
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
  }

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`
  ));
  parts.push(file.buffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return {
    buffer: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function isVideo(mimeType) {
  return mimeType.startsWith("video/");
}

async function uploadToTelegram(fileBuffer, fileName, mimeType) {
  const video = isVideo(mimeType);
  const method = video ? "sendVideo" : "sendPhoto";
  const field  = video ? "video" : "photo";

  const form = buildMultipart(
    { chat_id: CHAT_ID },
    { field, name: fileName, mimeType, buffer: fileBuffer }
  );

  const result = await telegramRequest(method, form);

  // Pega o file_id do maior tamanho disponível
  let fileId;
  if (video) {
    fileId = result.video?.file_id;
  } else {
    const photos = result.photo;
    fileId = photos?.[photos.length - 1]?.file_id;
  }

  if (!fileId) throw new Error("file_id não retornado pelo Telegram");

  // Obtém a URL de download direto
  const fileMeta = await telegramRequest("getFile", buildMultipart(
    { file_id: fileId }, { field: "_dummy", name: "x", mimeType: "text/plain", buffer: Buffer.alloc(0) }
  ));

  // getFile não usa multipart — refaz com JSON
  const fileMetaJson = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ file_id: fileId });
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${BOT_TOKEN}/getFile`,
      method: "POST",
      timeout: 15000,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (json.ok) resolve(json.result);
        else reject(new Error(`getFile erro: ${json.description}`));
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  const filePath = fileMetaJson.file_path;
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
}

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
    const { fileBase64, fileName, mimeType } = JSON.parse(event.body || "{}");

    if (!fileBase64 || !fileName || !mimeType)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios ausentes" }) };

    const fileBuffer = Buffer.from(fileBase64, "base64");
    console.log("Enviando para Telegram:", fileName, mimeType, fileBuffer.length, "bytes");

    const url = await uploadToTelegram(fileBuffer, fileName, mimeType);
    console.log("URL gerada:", url);

    return { statusCode: 200, headers, body: JSON.stringify({ url }) };

  } catch (err) {
    console.error("Erro:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
