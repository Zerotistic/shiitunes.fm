/* Play-order math and library selection (search, filter, sort). */

import { state } from "./state.js";
import { playlistById } from "./playlists.js";

/* The panel's queue scrolls, so it can afford to promise a longer horizon. */
const UP_NEXT_COUNT = 15;
const NO_MATCH_SCORE = Infinity;

/* Play contexts are either a playlist id or a category station ("cat:cover").
 * Both resolve to the same shape: an ordered list of track ids. */
const CATEGORY_CONTEXT_PREFIX = "cat:";

export function categoryStationId(category) {
  return `${CATEGORY_CONTEXT_PREFIX}${category}`;
}

export function contextTrackIds(contextId) {
  if (!contextId) return null;
  if (contextId.startsWith(CATEGORY_CONTEXT_PREFIX)) {
    const category = contextId.slice(CATEGORY_CONTEXT_PREFIX.length);
    const ids = state.tracks.filter((track) => track.category === category).map((track) => track.id);
    return ids.length ? ids : null;
  }
  const playlist = playlistById(contextId);
  return playlist ? playlist.trackIds.filter((id) => state.trackById.has(id)) : null;
}

export function canonicalOrder() {
  return contextTrackIds(state.playContext) || state.tracks.map((track) => track.id);
}

export function rebuildPlayOrder() {
  if (!state.shuffle) {
    state.playOrder = canonicalOrder();
    return;
  }
  const ids = canonicalOrder().filter((id) => id !== state.currentId);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
  }
  if (state.currentId) ids.unshift(state.currentId);
  state.playOrder = ids;
}

/* Upcoming tracks the player will actually reach: the hand-picked queue
 * first (queuedCount tells the renderer where it ends), then the ambient
 * order. With repeat off the list stops at the end of the order instead of
 * promising a wrapped queue. */
export function upNextTracks() {
  const queued = state.manualQueue.map((id) => state.trackById.get(id)).filter(Boolean);
  /* While a queued track plays (queueResumeId set), the ambient horizon
   * continues from where the order was interrupted, not from the queued
   * track's own slot in the order. */
  const anchorId = state.queueResumeId ?? state.currentId;
  const index = state.playOrder.indexOf(anchorId);
  if (index === -1) return { tracks: queued, queuedCount: queued.length, endsHere: false };
  const wrap = state.repeat !== "off";
  const upcoming = [];
  const ambientCount = Math.max(UP_NEXT_COUNT - queued.length, 3);
  let endsHere = false;
  for (let step = 1; step <= ambientCount; step += 1) {
    const position = index + step;
    if (!wrap && position >= state.playOrder.length) {
      endsHere = true;
      break;
    }
    const id = state.playOrder[position % state.playOrder.length];
    if (id === anchorId) break;
    upcoming.push(id);
  }
  const ambient = upcoming.map((id) => state.trackById.get(id)).filter(Boolean);
  return { tracks: [...queued, ...ambient], queuedCount: queued.length, endsHere };
}

function tokenScore(track, token) {
  const title = track.title.toLowerCase();
  const artist = track.artist.toLowerCase();
  const source = track.source.toLowerCase();
  if (title.startsWith(token)) return 0;
  if (title.includes(token)) return 10;
  if (artist.startsWith(token)) return 20;
  if (artist.includes(token)) return 30;
  if (source.startsWith(token)) return 40;
  if (source.includes(token)) return 50;
  if (track.haystack.includes(token)) return 60;
  return NO_MATCH_SCORE;
}

/* Multi-word queries match per token in any order ("requiem kanaria" and
 * "kanaria requiem" find the same track); every token must land somewhere.
 * The summed score keeps title hits ranked above source-only hits. */
export function searchScore(track, query) {
  const tokens = query.split(/\s+/).filter(Boolean);
  if (!tokens.length) return NO_MATCH_SCORE;
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(track, token);
    if (score === NO_MATCH_SCORE) return NO_MATCH_SCORE;
    total += score;
  }
  return total;
}

function matchesFilter(track, filter) {
  /* "stream" is normalized to "karaoke" at enrich time (data.js), so a plain
   * equality check covers every category. */
  return filter === "all" || track.category === filter;
}

function sortTracks(tracks) {
  if (state.librarySort === "az") {
    return [...tracks].sort((a, b) => a.title.localeCompare(b.title) || a.startSeconds - b.startSeconds);
  }
  if (state.librarySort === "newest") {
    return [...tracks].sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  }
  return tracks;
}

/* Tracks shown in the Library view for the current query + filter + sort.
 * With a query, relevance order wins and the sort setting is ignored (the
 * sort chips render disabled while searching). */
export function libraryTracks() {
  const query = state.query.trim().toLowerCase();
  const playlist = state.activePlaylist ? playlistById(state.activePlaylist) : null;
  let tracks = playlist
    ? playlist.trackIds.map((id) => state.trackById.get(id)).filter(Boolean)
    : state.tracks;

  if (query) {
    return tracks
      .map((track) => ({ track, score: searchScore(track, query) }))
      .filter((item) => item.score !== NO_MATCH_SCORE)
      .sort((a, b) => a.score - b.score)
      .map((item) => item.track)
      .filter((track) => matchesFilter(track, playlist ? "all" : state.libraryFilter));
  }

  /* Sort/filter chips render hidden for playlists (render.js) — a leftover
   * A-Z/Newest sort from a prior full-library visit must not silently
   * reorder a playlist's own track order. */
  if (playlist) return tracks;
  tracks = tracks.filter((track) => matchesFilter(track, state.libraryFilter));
  return sortTracks(tracks);
}
