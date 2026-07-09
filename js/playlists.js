/* Playlist and Liked Songs persistence + mutations. Pure data layer: no
 * rendering, no toasts — callers react to the returned outcome. */

import { LIKED_ID, state } from "./state.js";
import { cleanText } from "./utils.js";

const STORAGE_KEY = "shiitunes.playlists.v1";
const PLAYLIST_NAME_MAX = 40;

function cleanPlaylistName(value) {
  return cleanText(value).slice(0, PLAYLIST_NAME_MAX);
}

function uniqueTrackIds(ids) {
  const seen = new Set();
  return (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || "").trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

export function loadPlaylists() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      liked: uniqueTrackIds(raw.liked),
      custom: Array.isArray(raw.custom)
        ? raw.custom
            .map((playlist) => ({
              id: String(playlist.id || "").trim(),
              name: cleanPlaylistName(playlist.name),
              trackIds: uniqueTrackIds(playlist.trackIds)
            }))
            .filter((playlist) => playlist.id && playlist.name)
        : []
    };
  } catch {
    return { liked: [], custom: [] };
  }
}

function savePlaylists() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.playlists));
    return true;
  } catch {
    return false;
  }
}

/* Saved ids embed the moment's start second (`<videoId>-<start>`), so a
 * re-export that re-times a moment orphans every like/playlist entry that
 * points at it. Rebind orphans to the same video's nearest moment instead of
 * silently dropping them. */
const MIGRATE_MAX_DELTA_SECONDS = 120;

function nearestTrackId(orphanId, tracksByVideo) {
  for (const [videoId, tracks] of tracksByVideo) {
    if (!orphanId.startsWith(`${videoId}-`)) continue;
    const start = Number(orphanId.slice(videoId.length + 1).split("-")[0]);
    if (!Number.isFinite(start)) return null;
    let best = null;
    let bestDelta = Infinity;
    tracks.forEach((track) => {
      const delta = Math.abs(track.startSeconds - start);
      if (delta < bestDelta) {
        best = track;
        bestDelta = delta;
      }
    });
    return best && bestDelta <= MIGRATE_MAX_DELTA_SECONDS ? best.id : null;
  }
  return null;
}

export function migratePlaylists(trackById) {
  const tracksByVideo = new Map();
  trackById.forEach((track) => {
    if (!tracksByVideo.has(track.videoId)) tracksByVideo.set(track.videoId, []);
    tracksByVideo.get(track.videoId).push(track);
  });

  let changed = false;
  const remapIds = (ids) => uniqueTrackIds(ids.map((id) => {
    if (trackById.has(id)) return id;
    const replacement = nearestTrackId(id, tracksByVideo);
    if (replacement) changed = true;
    return replacement || id;
  }));

  state.playlists.liked = remapIds(state.playlists.liked);
  state.playlists.custom.forEach((playlist) => {
    playlist.trackIds = remapIds(playlist.trackIds);
  });
  if (changed) savePlaylists();
  return changed;
}

export function playlistById(id) {
  if (id === LIKED_ID) {
    return { id: LIKED_ID, name: "Liked Songs", trackIds: state.playlists.liked };
  }
  return state.playlists.custom.find((playlist) => playlist.id === id) || null;
}

export function allPlaylists() {
  return [playlistById(LIKED_ID), ...state.playlists.custom];
}

export function isLiked(trackId) {
  return state.playlists.liked.includes(trackId);
}

/* Returns true when the track is now liked. */
export function toggleLiked(trackId) {
  const liked = isLiked(trackId);
  state.playlists.liked = liked
    ? state.playlists.liked.filter((id) => id !== trackId)
    : [...state.playlists.liked, trackId];
  savePlaylists();
  return !liked;
}

export function createPlaylist(name, trackIds = []) {
  const cleaned = cleanPlaylistName(name);
  if (!cleaned) return null;
  const playlist = {
    id: `playlist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: cleaned,
    trackIds: uniqueTrackIds(trackIds)
  };
  state.playlists.custom.push(playlist);
  savePlaylists();
  return playlist;
}

/* Returns true when the rename stuck. Liked Songs keeps its name. */
export function renamePlaylist(playlistId, name) {
  const cleaned = cleanPlaylistName(name);
  const playlist = state.playlists.custom.find((item) => item.id === playlistId);
  if (!playlist || !cleaned) return false;
  playlist.name = cleaned;
  savePlaylists();
  return true;
}

/* Share links carry the whole playlist (name + track ids) in the URL — no
 * backend, no accounts.
 *
 * Format v2 ("2~<escaped name>~<tracks>"): track ids are already URL-safe
 * (an 11-char base64ish videoId, a dash, a decimal start), so wrapping them
 * in JSON and then base64url — the original format — paid a 4/3 inflation
 * on every byte for nothing. v2 keeps the payload as plain URL characters:
 * each track is the 11 videoId chars directly followed by the start in
 * base36, tracks joined by dots. Only the name is percent-escaped.
 *
 * "z~<base64url deflate-raw of the v2 payload>" is used instead when it
 * comes out shorter — random video ids don't compress (deflate can't beat
 * the base64 tax it reintroduces), but playlists with many tracks from the
 * same VODs, or long names, do.
 *
 * Legacy links (base64url JSON, no "~" possible in base64) decode forever. */

const V2_TRACK_ID = /^([A-Za-z0-9_-]{11})-(\d+)$/;

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const binary = atob(String(text).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/* "<escaped name>~<id><start36>.<id><start36>..." — null when any track id
 * doesn't fit the compact shape (then the legacy encoding takes over). */
function encodeV2Payload(playlist) {
  const tracks = [];
  for (const trackId of playlist.trackIds) {
    const match = V2_TRACK_ID.exec(trackId);
    if (!match) return null;
    tracks.push(match[1] + Number(match[2]).toString(36));
  }
  /* encodeURIComponent leaves "~" alone — escape it by hand so the name can
   * never impersonate the field separator. Dots in names are safe: only the
   * tracks field is dot-split. */
  const name = encodeURIComponent(playlist.name).replaceAll("~", "%7E");
  return `${name}~${tracks.join(".")}`;
}

function decodeV2Payload(payload) {
  const split = payload.indexOf("~");
  if (split < 0) return null;
  const name = decodeURIComponent(payload.slice(0, split));
  const trackIds = payload.slice(split + 1).split(".").map((entry) => {
    const start = parseInt(entry.slice(11), 36);
    return entry.length > 11 && Number.isFinite(start) ? `${entry.slice(0, 11)}-${start}` : null;
  });
  return trackIds.includes(null) ? null : { name, trackIds };
}

function legacyEncode(playlist) {
  const json = JSON.stringify({ n: playlist.name, t: playlist.trackIds });
  return toBase64Url(new TextEncoder().encode(json));
}

async function throughStream(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function validateShare(data) {
  if (!data) return null;
  const name = cleanPlaylistName(data.name ?? data.n);
  const trackIds = uniqueTrackIds(data.trackIds ?? data.t);
  if (!name || !trackIds.length) return null;
  return { name, trackIds };
}

export async function encodePlaylistShare(playlist) {
  const payload = encodeV2Payload(playlist);
  if (payload === null) return legacyEncode(playlist);
  const plain = `2~${payload}`;
  if (typeof CompressionStream === "function") {
    try {
      const deflated = await throughStream(
        new TextEncoder().encode(payload),
        new CompressionStream("deflate-raw")
      );
      const packed = `z~${toBase64Url(deflated)}`;
      if (packed.length < plain.length) return packed;
    } catch {
      /* Compression is an optimization; the plain form below always works. */
    }
  }
  return plain;
}

export async function decodePlaylistShare(encoded) {
  try {
    const value = String(encoded);
    if (value.startsWith("2~")) return validateShare(decodeV2Payload(value.slice(2)));
    if (value.startsWith("z~")) {
      const inflated = await throughStream(
        fromBase64Url(value.slice(2)),
        new DecompressionStream("deflate-raw")
      );
      return validateShare(decodeV2Payload(new TextDecoder().decode(inflated)));
    }
    return validateShare(JSON.parse(new TextDecoder().decode(fromBase64Url(value))));
  } catch {
    return null;
  }
}

/* Returns true when the track is now in the playlist. */
export function toggleInPlaylist(playlistId, trackId) {
  const playlist = playlistById(playlistId);
  if (!playlist || playlist.id === LIKED_ID) return null;
  const hasTrack = playlist.trackIds.includes(trackId);
  playlist.trackIds = hasTrack
    ? playlist.trackIds.filter((id) => id !== trackId)
    : [...playlist.trackIds, trackId];
  savePlaylists();
  return !hasTrack;
}

export function deletePlaylist(playlistId) {
  const playlist = playlistById(playlistId);
  if (!playlist || playlist.id === LIKED_ID) return false;
  state.playlists.custom = state.playlists.custom.filter((item) => item.id !== playlistId);
  savePlaylists();
  return true;
}
