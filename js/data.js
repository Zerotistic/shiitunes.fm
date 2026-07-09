/* Loading and normalizing the public song index.
 *
 * The exporter (`python -m shiitunes export-web`) owns the file format; this
 * module tolerates both its camelCase schema and the pipeline's snake_case
 * fields as a safety net. All YouTube URLs are derived here so the share-lead
 * rule lives in exactly one place on the web side.
 */

import { cleanText, formatClock, formatDate, readSeconds } from "./utils.js";

/* Bump with the ?v= stamps in index.html on every export/deploy: the stamp
 * busts caches so the fetch itself can use normal HTTP caching. */
const DATA_VERSION = "21";
const DATA_URL = `./data/tracks.json?v=${DATA_VERSION}`;
const SHARE_LEAD_SECONDS = 4;
export const UNTITLED_LABEL = "Untitled singing moment";

/* Collapse the artist only when it is Shiina alone; collab credits like
 * "Youngilly X Amanogawa Shiina" must survive as written. */
const SHIINA_ALONE_RE = /^(shiina|shiina\s+amanogawa|amanogawa\s+shiina)$/i;
const UNTITLED_SENTINEL_RE = /^unknown(\s+singing)?(\s+moment)?$|^unknown singing moment/i;

/* Only bracket blocks that are pure tagging noise get stripped from source
 * labels; collab framing like 【Shiina x Lumi】 stays. */
const NOISE_BRACKET_RE = /^(歌ってみた|歌枠|karaoke|sing(ing)?|cover(ed)?|original\s+song|official(\s+(mv|video))?|mv|asmr|vtuber|phase\s*connect.*|#.*)$/i;

const ORIGINAL_RE = /original\s+song/i;
const COVER_RE = /cover|歌ってみた/i;
const KARAOKE_RE = /karaoke|歌枠|sing/i;

export function makeYouTubeUrl(videoId, startSeconds) {
  const start = Math.max(0, (readSeconds(startSeconds) || 0) - SHARE_LEAD_SECONDS);
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${start}s`;
}

export function makeAppUrl(trackId) {
  return `${window.location.origin}${window.location.pathname}?t=${encodeURIComponent(trackId)}#/radio`;
}

function thumbUrl(videoId, quality) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${quality}.jpg`;
}

/* Mirrors the exporter's heuristic for rows that predate the category field. */
function categorize(source) {
  if (ORIGINAL_RE.test(source)) return "original";
  if (KARAOKE_RE.test(source)) return "karaoke";
  if (COVER_RE.test(source)) return "cover";
  return "stream";
}

/* The public UI has no "stream" concept: singing songs from non-karaoke
 * streams live under Karaoke. Normalizing here keeps exactly one canonical
 * category everywhere downstream (filters, stations, labels). */
function normalizeCategory(category) {
  return category === "stream" ? "karaoke" : category;
}

function cleanSourceLabel(source) {
  const withoutNoise = String(source || "")
    .replace(/【([^】]*)】/g, (match, inner) => (NOISE_BRACKET_RE.test(cleanText(inner)) ? " " : match))
    .replace(/^\[([^\]]*)\]\s*/, (match, inner) => (NOISE_BRACKET_RE.test(cleanText(inner)) ? "" : match));
  const stripped = cleanText(withoutNoise) || cleanText(source);
  if (stripped.length > 60) return `${stripped.slice(0, 59).trimEnd()}…`;
  return stripped;
}

export function enrichTrack(raw, index = 0) {
  const videoId = cleanText(raw.videoId ?? raw.video_id);
  const startSeconds = readSeconds(raw.startSeconds ?? raw.start_seconds) || 0;
  const duration = readSeconds(raw.durationSeconds ?? raw.duration_seconds ?? raw.duration);
  const rawTitle = cleanText(raw.title ?? raw.possible_title);
  const untitled = raw.untitled === true || !rawTitle || UNTITLED_SENTINEL_RE.test(rawTitle);
  const title = untitled ? UNTITLED_LABEL : rawTitle;
  const artist = cleanText(raw.artist ?? raw.possible_artist) || "Shiina Amanogawa";
  const shiinaIsArtist = SHIINA_ALONE_RE.test(artist);
  const source = cleanText(raw.source ?? raw.vod_title) || "Shiina Amanogawa VOD";
  const publishedAt = cleanText(raw.publishedAt ?? raw.published_at).slice(0, 10) || null;

  return {
    id: cleanText(raw.id) || `${videoId}-${startSeconds}-${index}`,
    videoId,
    title,
    artist,
    shiinaIsArtist,
    source,
    sourceLabel: cleanSourceLabel(source),
    category: normalizeCategory(cleanText(raw.category) || categorize(source)),
    startSeconds,
    duration,
    durationLabel: duration ? formatClock(duration) : "",
    publishedAt,
    dateLabel: formatDate(publishedAt),
    openUrl: makeYouTubeUrl(videoId, startSeconds),
    untitled,
    haystack: [title, artist, source].join(" ").toLowerCase(),
    thumbnail: thumbUrl(videoId, "hqdefault"),
    thumbnailLarge: thumbUrl(videoId, "maxresdefault"),
    /* For blurred backdrops only — the blur hides the resolution, and the
     * hero backdrop is usually the page's LCP image, so smaller is faster. */
    thumbnailSmall: thumbUrl(videoId, "mqdefault")
  };
}

/* No sample fallback: fabricated songs must never render as real content.
 * On failure the app shows the error banner with a retry over empty states. */
export async function loadTracks() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    if (!Array.isArray(json)) throw new Error("Invalid data shape");
    const seen = new Set();
    const tracks = json
      .map((raw, index) => enrichTrack(raw, index))
      .filter((track) => {
        if (!track.videoId || seen.has(track.id)) return false;
        seen.add(track.id);
        return true;
      });
    if (!tracks.length) return { tracks: [], status: "empty" };
    return { tracks, status: "ok" };
  } catch {
    return { tracks: [], status: "error" };
  }
}
