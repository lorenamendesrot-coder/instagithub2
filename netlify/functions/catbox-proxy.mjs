// catbox-proxy.mjs — usa Cloudflare R2 como CDN de mídia
import https from "https";
import crypto from "crypto";

const R2_ACCOUNT_ID  = "604d4b77f2213f87fcd412ab2441850f";
const R2_ACCESS_KEY  = "c432b65b2ed857c9ff45d750c743c152";
const R2_SECRET_KEY  = "b9aebd41695250484b034f74133e2958a1d4eb2ea4ba4a3edd2a059b36d00520";
const R2_BUCKET      = "insta-midias";
const R2_PUBLIC_URL  = "https://pub-f91190716469483c83ebaf881cfe3ba3.r2.dev";
const R2_ENDPOINT    = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

function hmac(key, data, encoding) {
  return crypto.createHmac("sha256", key).update(data).digest(encoding);
}

function hash(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate    = hmac("AWS4" + secretKey, dateStamp);
  const kRegion  = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  return kSigning;
}

async function uploadToR2(fileBuffer, fileName, mimeType) {
  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const region    = "auto";
  const service   = "s3";

  // Gera nome único para o arquivo
  const ext      = fileName.split(".").pop();
  const key      = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const bodyHash = hash(fileBuffer);

  const canonicalHeaders =
    `content-type:${mimeType}\n` +
    `host:${R2_ENDPOINT}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${R2_BUCKET}/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hash(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(R2_SECRET_KEY, dateStamp, region, service);
  const signature  = hmac(signingKey, stringToSign, "hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: R2_ENDPOINT,
      path: `/${R2_BUCKET}/${key}`,
      method: "PUT",
      timeout: 60000,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": fileBuffer.length,
        "x-amz-date": amzDate,
        "x-amz-content-sha256": bodyHash,
        "Authorization": authorization,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        console.log("R2 status:", res.statusCode, Buffer.concat(chunks).toString().slice(0, 200));
        if (res.statusCode === 200) {
          resolve(`${R2_PUBLIC_URL}/${key}`);
        } else {
          reject(new Error(`R2 erro ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
        }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout R2 (60s)")); });
    req.on("error", (err) => reject(new Error(`Erro de rede: ${err.message}`)));
    req.write(fileBuffer);
    req.end();
  });
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
    console.log("Enviando para R2:", fileName, mimeType, fileBuffer.length, "bytes");

    const url = await uploadToR2(fileBuffer, fileName, mimeType);
    console.log("URL gerada:", url);

    return { statusCode: 200, headers, body: JSON.stringify({ url }) };

  } catch (err) {
    console.error("Erro:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
