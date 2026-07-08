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
 * backend, no accounts. base64url over UTF-8 JSON so names in any script
 * survive the trip. */
export function encodePlaylistShare(playlist) {
  const json = JSON.stringify({ n: playlist.name, t: playlist.trackIds });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodePlaylistShare(encoded) {
  try {
    const binary = atob(String(encoded).replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const name = cleanPlaylistName(data.n);
    const trackIds = uniqueTrackIds(data.t);
    if (!name || !trackIds.length) return null;
    return { name, trackIds };
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
