/* Small shared helpers with no app knowledge. */

export function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function readSeconds(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
}

export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

export function formatDate(isoDate) {
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : DATE_FORMAT.format(date);
}

/* Kana + CJK ideographs: used to tag Japanese titles with lang="ja" so
 * screen readers pick the right voice. */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;

export function hasCJK(text) {
  return CJK_RE.test(String(text || ""));
}

/* Tiny deterministic hash for seeding per-track visual variations. */
export function hashCode(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}
