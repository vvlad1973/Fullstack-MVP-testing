import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",

  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",

  "video/mp4": "mp4",
  "video/webm": "webm",
};

function parseDataUrl(input: string): { mime: string; buffer: Buffer } | null {
  if (!input) return null;
  const m = /^data:([^;]+);base64,(.+)$/i.exec(input.trim());
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  return { mime, buffer: Buffer.from(b64, "base64") };
}

/**
 * Делает SCORM полностью автономным:
 * - data:*;base64 -> assets/media/<random>.<ext> (кладём в ZIP)
 * - /uploads/...  -> assets/...               (кладём в ZIP, читая с диска)
 */
export function extractEmbeddedMediaIntoAssets(
  testObj: any,
  opts?: { uploadsRoot?: string; uploadsUrlPrefix?: string },
) {
  const assets: Record<string, Buffer> = {};
  const missing: string[] = [];

  const uploadsUrlPrefix = (opts?.uploadsUrlPrefix ?? "/uploads/").replace(/\\/g, "/");
  const uploadsRoot = path.resolve(opts?.uploadsRoot ?? path.resolve(process.cwd(), "uploads"));
  const uploadsRootWithSep = uploadsRoot.endsWith(path.sep) ? uploadsRoot : uploadsRoot + path.sep;

  const seenAbs = new Set<string>();

  function tryEmbedUploadedFile(url: string): string | null {
    const u = url.trim().replace(/\\/g, "/");
    if (!u.startsWith(uploadsUrlPrefix)) return null;

    const rest = u.slice(uploadsUrlPrefix.length); // "media/abc.mp3"
    const abs = path.resolve(uploadsRoot, rest);

    // защита от ../
    if (!(abs === uploadsRoot || abs.startsWith(uploadsRootWithSep))) {
      missing.push(`blocked path traversal: ${u}`);
      return null;
    }
    if (!fs.existsSync(abs)) {
      missing.push(`missing file on disk: ${abs}`);
      return null;
    }

    const zipPath = `assets/${rest}`.replace(/\\/g, "/");

    if (!seenAbs.has(abs)) {
      try {
        assets[zipPath] = fs.readFileSync(abs);
        seenAbs.add(abs);
      } catch (e: any) {
        missing.push(`failed to read: ${abs} (${e?.message ?? e})`);
        return null;
      }
    }

    return zipPath;
  }

  function visit(node: any) {
    if (!node || typeof node !== "object") return;

    if (typeof node.mediaUrl === "string") {
      const url = node.mediaUrl.trim();

      // 1) base64 data url
      const parsed = parseDataUrl(url);
      if (parsed) {
        const ext = EXT_BY_MIME[parsed.mime] || "bin";
        const fileName = `${nanoid(10)}.${ext}`;
        const zipPath = `assets/media/${fileName}`;
        assets[zipPath] = parsed.buffer;
        node.mediaUrl = zipPath;
      } else {
        // 2) /uploads/... -> pack
        const packedZipPath = tryEmbedUploadedFile(url);
        if (packedZipPath) node.mediaUrl = packedZipPath;
      }
    }

    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  }

  visit(testObj);

  return { testObj, assets, missing };
}
