/* Central mutable state plus tiny derived getters. Rendering and mutation
 * logic live elsewhere; nothing here touches the DOM. */

export const LIKED_ID = "liked";
export const VIEWS = ["radio", "library", "about"];
export const REPEAT_MODES = ["off", "all", "one"];
export const LIBRARY_PAGE_SIZE = 72;

const EMBED_BLOCKED_KEY = "shiitunes.embedBlocked.v1";
/* Embeddability can change (owner settings, region), so remembered blocks
 * expire instead of sticking forever. */
const EMBED_BLOCKED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function loadEmbedBlocked() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(EMBED_BLOCKED_KEY) || "{}");
    const cutoff = Date.now() - EMBED_BLOCKED_TTL_MS;
    const fresh = {};
    Object.entries(raw).forEach(([id, stamp]) => {
      if (typeof stamp === "number" && stamp > cutoff) fresh[id] = stamp;
    });
    return fresh;
  } catch {
    return {};
  }
}

function saveEmbedBlocked(entries) {
  try {
    window.localStorage.setItem(EMBED_BLOCKED_KEY, JSON.stringify(entries));
  } catch {
    /* Private-mode storage failures only cost persistence. */
  }
}

const embedBlockedStamps = loadEmbedBlocked();

export const state = {
  tracks: [],
  trackById: new Map(),
  hasDates: false,
  dataStatus: "loading", // loading | ok | empty | error
  activeView: "radio",
  currentId: null,
  playerStatus: "idle", // idle | loading | playing | paused | error
  playContext: null,
  activePlaylist: null,
  playlists: {
    liked: [],
    custom: []
  },
  shuffle: false,
  repeat: "off",
  playOrder: [],
  /* Hand-picked "play next / add to queue" track ids, consumed before the
   * ambient playOrder. Session-only by design — a stale queue on the next
   * visit would be baffling. */
  manualQueue: [],
  /* While a queued track plays (it lives outside playOrder), this remembers
   * where the ambient order should resume afterwards. */
  queueResumeId: null,
  query: "",
  libraryFilter: "all",
  librarySort: "stream", // stream | az | newest
  libraryVisibleCount: LIBRARY_PAGE_SIZE,
  /* True while the user has toggled the now-playing panel away from the
   * player bar. Playback continues; the panel stays hidden until toggled
   * back (Spotify-style). */
  panelDismissed: false,
  /* Tracks known to refuse embedding. Persisted (with expiry) so returning
   * visitors don't re-hit the error → toast → skip dance every session. */
  embedBlockedIds: new Set(Object.keys(embedBlockedStamps))
};

/* isPlaying is derived, never stored — no second source of truth to drift. */
export function isPlaying() {
  return state.playerStatus === "playing";
}

export function setPlayerStatus(status) {
  state.playerStatus = status;
}

export function currentTrack() {
  return state.trackById.get(state.currentId) || null;
}

export function isEmbedBlocked(trackId) {
  return state.embedBlockedIds.has(trackId);
}

export function markEmbedBlocked(trackId) {
  if (!trackId) return;
  state.embedBlockedIds.add(trackId);
  embedBlockedStamps[trackId] = Date.now();
  saveEmbedBlocked(embedBlockedStamps);
}
