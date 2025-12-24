// client/src/components/questions/media-uploader.tsx
import React, { useRef, useState } from "react";

type Props = {
  value?: { mediaUrl?: string; mediaType?: "image" | "audio" | "video" | null };
  onChange: (patch: { mediaUrl?: string; mediaType?: "image" | "audio" | "video" | null }) => void;
};

export function MediaUploader({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/media/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");

      const data = await res.json(); // { url: "/uploads/xxx.png", mediaType:"image" }
      onChange({ mediaUrl: data.url, mediaType: data.mediaType });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? "Загрузка..." : "Загрузить медиа"}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/*,audio/*,video/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.currentTarget.value = ""; // чтобы можно было выбрать тот же файл повторно
          }}
        />
      </div>

      {value?.mediaUrl ? (
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          Файл: <code>{value.mediaUrl}</code>
          <button
            type="button"
            onClick={() => onChange({ mediaUrl: "", mediaType: null })}
            style={{ marginLeft: 8 }}
          >
            Удалить
          </button>
        </div>
      ) : null}
    </div>
  );
}
