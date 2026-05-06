import https from "https";

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
    const boundary = "----Boundary" + Date.now().toString(36);

    const headerPart = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="fileToUpload"; filename="${fileName}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    );
    const closingPart = Buffer.from(`\r\n--${boundary}--`);
    const body = Buffer.concat([headerPart, fileBuffer, closingPart]);

    const url = await new Promise((resolve, reject) => {
      const options = {
        hostname: "catbox.moe",
        path: "/user/api.php",
        method: "POST",
        timeout: 60000,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "*/*",
          "Origin": "https://catbox.moe",
          "Referer": "https://catbox.moe/",
        },
      };

      const req = https.request(options, (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8").trim();
          console.log("Catbox status:", res.statusCode, "body:", text.slice(0, 200));
          if (text.startsWith("https://")) resolve(text);
          else reject(new Error(`Catbox erro: ${text || res.statusCode}`));
        });
      });

      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout (60s)")); });
      req.on("error", (err) => reject(new Error(`Erro de rede: ${err.message}`)));

      req.write(body);
      req.end();
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url }) };

  } catch (err) {
    console.error("Erro proxy:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
