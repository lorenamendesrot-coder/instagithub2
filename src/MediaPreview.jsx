// MediaPreview.jsx — preview de imagem ou vídeo com detecção automática de tipo

import { useState, useEffect, useRef } from "react";

const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?.*)?$/i;
const VIDEO_EXTS = /\.(mp4|mov|avi|mkv|webm|m4v|3gp)(\?.*)?$/i;

function detectType(url) {
  if (!url) return null;
  if (IMAGE_EXTS.test(url)) return "IMAGE";
  if (VIDEO_EXTS.test(url)) return "VIDEO";
  return null; // desconhecido — vai tentar carregar como imagem
}

export default function MediaPreview({ url, mediaType, onTypeDetected }) {
  const [status, setStatus] = useState("idle"); // idle | loading | ok | error
  const [resolvedType, setResolvedType] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!url || !url.startsWith("http")) {
      setStatus("idle");
      setResolvedType(null);
      return;
    }

    setStatus("loading");

    debounceRef.current = setTimeout(() => {
      const detected = detectType(url) || mediaType || "IMAGE";
      setResolvedType(detected);

      if (detected !== mediaType && onTypeDetected) {
        onTypeDetected(detected);
      }
    }, 600); // debounce 600ms depois de parar de digitar

    return () => clearTimeout(debounceRef.current);
  }, [url]);

  if (!url || !url.startsWith("http")) return null;

  return (
    <div style={{
      marginTop: 12,
      borderRadius: 10,
      overflow: "hidden",
      border: "1px solid var(--border)",
      background: "var(--bg3)",
      position: "relative",
    }}>
      {status === "loading" && (
        <div style={{
          height: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          color: "var(--muted)",
          fontSize: 13,
        }}>
          <span className="spinner" />
          Carregando preview...
        </div>
      )}

      {(status === "loading" || status === "ok") && resolvedType === "VIDEO" && (
        <video
          key={url}
          src={url}
          controls
          muted
          style={{
            width: "100%",
            maxHeight: 320,
            display: status === "ok" ? "block" : "none",
            background: "#000",
          }}
          onLoadedData={() => setStatus("ok")}
          onError={() => setStatus("error")}
        />
      )}

      {(status === "loading" || status === "ok") && resolvedType !== "VIDEO" && (
        <img
          key={url}
          src={url}
          alt="Preview"
          style={{
            width: "100%",
            maxHeight: 320,
            objectFit: "contain",
            display: status === "ok" ? "block" : "none",
          }}
          onLoad={() => setStatus("ok")}
          onError={() => setStatus("error")}
        />
      )}

      {status === "error" && (
        <div style={{
          height: 120,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: "var(--muted)",
          fontSize: 13,
        }}>
          <span style={{ fontSize: 28 }}>🔗</span>
          <span>Não foi possível carregar o preview</span>
          <span style={{ fontSize: 11 }}>Verifique se a URL é pública e acessível</span>
        </div>
      )}

      {status === "ok" && (
        <div style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: "rgba(0,0,0,0.65)",
          color: "#fff",
          fontSize: 11,
          padding: "3px 9px",
          borderRadius: 20,
          backdropFilter: "blur(4px)",
          fontWeight: 500,
        }}>
          {resolvedType === "VIDEO" ? "🎬 Vídeo" : "🖼 Imagem"}
        </div>
      )}
    </div>
  );
}
