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
    const boundary = "----FormBoundary" + Date.now().toString(16);

    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload`,
      `--${boundary}\r\nContent-Disposition: form-data; name="time"\r\n\r\n1h`,
      `--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ];

    const bodyStart = Buffer.from(parts.join("\r\n") );
    const bodyEnd   = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body      = Buffer.concat([bodyStart, fileBuffer, bodyEnd]);

    const url = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "catbox.moe",
        path: "/user/api.php",
        method: "POST",
        timeout: 60000,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          "User-Agent": "Mozilla/5.0",
        },
      }, (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8").trim();
          console.log("Catbox status:", res.statusCode, "| body:", text.slice(0, 300));
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
