// CatboxUploader.jsx — Upload via proxy Netlify (resolve CORS)
import { useState, useRef, useCallback } from "react";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExt(name) {
  return name.split(".").pop().toLowerCase();
}

function isVideo(name) {
  return ["mp4", "mov", "avi", "mkv", "webm"].includes(getExt(name));
}

// Upload via proxy Netlify — evita bloqueio de CORS do browser
async function uploadToCatbox(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", file);

    const xhr = new XMLHttpRequest();
    // Usa o proxy local em vez de chamar catbox.moe diretamente
    xhr.open("POST", "/api/catbox-proxy");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.url) {
            resolve(data.url);
          } else {
            reject(new Error(data.error || "Resposta inválida do servidor"));
          }
        } catch {
          reject(new Error("Resposta inválida do servidor"));
        }
      } else {
        let msg = `Erro ${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => reject(new Error("Erro de rede — verifique sua conexão"));
    xhr.send(form);
  });
}

export default function CatboxUploader({ onUrlsReady }) {
  const [files, setFiles]         = useState([]);
  const [dragging, setDragging]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef();

  const addFiles = (newFiles) => {
    const entries = Array.from(newFiles).map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      name: file.name,
      size: file.size,
      status: "idle",
      progress: 0,
      url: "",
      error: "",
      type: isVideo(file.name) ? "VIDEO" : "IMAGE",
    }));
    setFiles((p) => [...p, ...entries]);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, []);

  const onDragOver  = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const removeFile = (id) => setFiles((p) => p.filter((f) => f.id !== id));
  const clearAll   = () => setFiles([]);

  const uploadAll = async () => {
    const pending = files.filter((f) => f.status === "idle" || f.status === "error");
    if (!pending.length) return;

    setUploading(true);

    for (const entry of pending) {
      setFiles((p) =>
        p.map((f) => f.id === entry.id ? { ...f, status: "uploading", progress: 0, error: "" } : f)
      );

      try {
        const url = await uploadToCatbox(entry.file, (progress) => {
          setFiles((p) => p.map((f) => f.id === entry.id ? { ...f, progress } : f));
        });

        setFiles((p) =>
          p.map((f) => f.id === entry.id ? { ...f, status: "done", url, progress: 100 } : f)
        );
      } catch (err) {
        setFiles((p) =>
          p.map((f) => f.id === entry.id ? { ...f, status: "error", error: err.message } : f)
        );
      }
    }

    setUploading(false);

    // Retorna URLs prontas para o componente pai
    setFiles((current) => {
      const done = current.filter((f) => f.status === "done");
      if (done.length > 0) {
        onUrlsReady(done.map((f) => ({ url: f.url, type: f.type, name: f.name })));
      }
      return current;
    });
  };

  const doneFiles  = files.filter((f) => f.status === "done");
  const errorFiles = files.filter((f) => f.status === "error");
  const idleFiles  = files.filter((f) => f.status === "idle");

  return (
    <div>
      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => !uploading && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--accent)" : "var(--border2)"}`,
          borderRadius: 12,
          padding: "28px 20px",
          textAlign: "center",
          cursor: uploading ? "not-allowed" : "pointer",
          background: dragging ? "rgba(124,92,252,0.08)" : "var(--bg3)",
          transition: "all 0.15s",
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>☁️</div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
          {dragging ? "Solte para adicionar" : "Arraste arquivos ou clique para selecionar"}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Imagens (jpg, png, webp) · Vídeos (mp4, mov, webm) · Sem limite de quantidade
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          style={{ display: "none" }}
          onChange={(e) => e.target.files.length && addFiles(e.target.files)}
        />
      </div>

      {/* Lista de arquivos */}
      {files.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
              {files.length} arquivo(s) · {doneFiles.length} enviado(s)
              {errorFiles.length > 0 && (
                <span style={{ color: "var(--danger)", marginLeft: 8 }}>{errorFiles.length} erro(s)</span>
              )}
            </div>
            <button
              className="btn btn-ghost btn-xs"
              onClick={clearAll}
              disabled={uploading}
            >
              Limpar
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
            {files.map((f) => (
              <div key={f.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", borderRadius: 8,
                background: f.status === "done"
                  ? "rgba(16,185,129,0.06)"
                  : f.status === "error"
                  ? "rgba(239,68,68,0.06)"
                  : "var(--bg3)",
                border: `1px solid ${
                  f.status === "done"
                    ? "rgba(16,185,129,0.2)"
                    : f.status === "error"
                    ? "rgba(239,68,68,0.2)"
                    : "var(--border)"
                }`,
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>
                  {f.type === "VIDEO" ? "🎬" : "🖼"}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    {formatSize(f.size)}
                  </div>

                  {/* Barra de progresso */}
                  {f.status === "uploading" && (
                    <div style={{ marginTop: 5 }}>
                      <div style={{ height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", width: `${f.progress}%`,
                          background: "var(--accent)", transition: "width 0.2s", borderRadius: 2,
                        }} />
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                        {f.progress}% — enviando para Catbox...
                      </div>
                    </div>
                  )}

                  {/* URL gerada */}
                  {f.status === "done" && (
                    <div style={{ fontSize: 11, color: "var(--success)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      ✓ {f.url}
                    </div>
                  )}

                  {/* Erro */}
                  {f.status === "error" && (
                    <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 3 }}>
                      ✗ {f.error}
                    </div>
                  )}
                </div>

                {/* Status badge */}
                <div style={{ flexShrink: 0 }}>
                  {f.status === "idle"      && <span className="badge badge-gray">Pendente</span>}
                  {f.status === "uploading" && <span className="spinner" style={{ width: 14, height: 14 }} />}
                  {f.status === "done"      && <span className="badge badge-success">✓</span>}
                  {f.status === "error"     && <span className="badge badge-danger">Erro</span>}
                </div>

                {/* Remover */}
                {f.status !== "uploading" && (
                  <button
                    onClick={() => removeFile(f.id)}
                    style={{ background: "none", color: "var(--muted)", fontSize: 16, padding: 0, flexShrink: 0 }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Botões de ação */}
          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
            <button
              className="btn btn-primary"
              onClick={uploadAll}
              disabled={uploading || (idleFiles.length === 0 && errorFiles.length === 0)}
              style={{ flex: 1 }}
            >
              {uploading
                ? <><span className="spinner" /> Enviando para Catbox...</>
                : `☁️ Enviar ${idleFiles.length + errorFiles.length} arquivo(s) para Catbox`}
            </button>

            {doneFiles.length > 0 && (
              <button
                className="btn btn-success"
                onClick={() => onUrlsReady(doneFiles.map((f) => ({ url: f.url, type: f.type, name: f.name })))}
                style={{ flexShrink: 0 }}
              >
                ✓ Usar {doneFiles.length} URL(s)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
