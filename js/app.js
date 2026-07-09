/* ShiiTunes entry point: loads data, wires the modules together, and handles
 * deep links. Behavior lives in the feature modules —
 *   views.js       view switching + search
 *   playback.js    select/play/skip/shuffle + YouTube events + volume
 *   collections.js likes, playlists, per-track actions
 *   bindings.js    DOM event wiring
 *
 * Cache note: bump every ?v= stamp in index.html (css/ links, js/app.js)
 * together whenever any web file changes, and DATA_VERSION in js/data.js
 * when data/tracks.json changes; module imports below revalidate through
 * normal HTTP caching. */

import { loadTracks } from "./data.js";
import { LIKED_ID, currentTrack, state } from "./state.js";
import * as playlists from "./playlists.js";
import { rebuildPlayOrder } from "./queue.js";
import { cueTrack, setPlayerVolume } from "./player.js";
import { initRender, nodes, renderAll, renderBanner, renderSkeletons } from "./render.js";
import { openContextMenu, openTrackMenu } from "./menu.js";
import { initRouter, navigate } from "./router.js";
import { applyView } from "./views.js";
import {
  bindMediaSession, playQueuedAt, removeQueuedAt, revealVideo, savedVolume,
  selectTrack, syncMuteButton
} from "./playback.js";
import {
  handleDeletePlaylist, handleRenamePlaylist, handleSelectPlaylist,
  handleSharePlaylist, handleToggleLiked, menuActions
} from "./collections.js";
import { confirmDanger } from "./dialogs.js";
import { bindEvents } from "./bindings.js";
import { showToast } from "./toast.js";

async function loadData() {
  state.dataStatus = "loading";
  renderSkeletons();
  renderBanner();

  const { tracks, status } = await loadTracks();
  state.tracks = tracks;
  state.trackById = new Map(tracks.map((track) => [track.id, track]));
  state.hasDates = tracks.some((track) => track.publishedAt);
  state.dataStatus = status;
  /* Re-exports can re-time songs (new ids): rebind saved likes/playlists
   * to the nearest surviving moment instead of dropping them. */
  if (tracks.length) playlists.migratePlaylists(state.trackById);
  if (!state.currentId || !state.trackById.has(state.currentId)) {
    state.currentId = tracks[0]?.id || null;
  }
  rebuildPlayOrder();
  renderAll();
  return status;
}

/* Render-layer callbacks. Track menus route through the shared menuActions;
 * the playlist menu is assembled here because its entries depend on which
 * playlist was clicked (Liked Songs can be shared but not renamed/deleted). */
const renderActions = {
  onSelectTrack: selectTrack,
  onToggleLiked: handleToggleLiked,
  onOpenMenu: (anchor, track, at = null) => openTrackMenu(anchor, track, menuActions, { at }),
  onSelectPlaylist: handleSelectPlaylist,
  onPlayQueued: playQueuedAt,
  /* Cards already in the hand-picked queue swap "Play next"/"Add to queue"
   * for removal — queueing a queued card again would be noise. */
  onQueuedMenu: (anchor, track, index, at) => openTrackMenu(anchor, track, menuActions, {
    at,
    queueControls: [
      { icon: "close", label: "Remove from queue", danger: true, onPick: () => removeQueuedAt(index) }
    ]
  }),
  onPlaylistContext: (anchor, playlist, at) => {
    const custom = playlist.id !== LIKED_ID;
    const entries = [
      custom && { icon: "pencil", label: "Rename", onPick: () => handleRenamePlaylist(playlist.id) },
      { icon: "link", label: "Copy share link", onPick: () => handleSharePlaylist(playlist.id) },
      custom && { icon: "close", label: "Delete playlist", danger: true, onPick: () => handleDeletePlaylist(playlist.id) }
    ].filter(Boolean);
    openContextMenu(anchor, entries, { at, label: `Options for ${playlist.name}` });
  }
};

/* ?t=<trackId> cues a specific moment; legacy ?play=1 cues the first track.
 * Cueing (not autoplaying) respects autoplay policies. */
function handleTrackLink(params) {
  const linkedId = params.get("t");
  if (linkedId && state.trackById.has(linkedId)) {
    selectTrack(linkedId, { play: false });
    revealVideo();
    cueTrack(currentTrack());
    return;
  }
  if (params.get("play") === "1" && state.currentId) {
    revealVideo();
    cueTrack(currentTrack());
    return;
  }
  /* A ?t= link whose moment no longer exists must not fail silently — the
   * person clicked a shared song and got the homepage. */
  if (linkedId && state.tracks.length) {
    showToast("That shared song isn't in the library anymore", { error: true });
  }
  /* Warm the YouTube API + player behind the panel overlay. Without a warm
   * player, the first song click has to bootstrap the whole iframe API
   * before it can start — slow, and the click's autoplay grant can expire
   * before loadVideoById runs, leaving the first selection stuck "loading".
   * Warming waits for the first touch of the page, though: at load it made
   * every visitor (and Lighthouse) pay ~1.5 MB of player they might never
   * use, and it still lands seconds before anyone picks a song. */
  if (state.currentId) warmPlayerOnFirstInteraction();
}

function warmPlayerOnFirstInteraction() {
  const warm = () => {
    document.removeEventListener("pointerdown", warm);
    document.removeEventListener("keydown", warm);
    if (state.currentId) cueTrack(currentTrack());
  };
  document.addEventListener("pointerdown", warm, { passive: true });
  document.addEventListener("keydown", warm);
}

/* Shared playlist links (?pl=): decode, confirm, save a copy. Asking first
 * matters — a link click must not silently mutate someone's library. */
async function handlePlaylistLink(params) {
  const sharedParam = params.get("pl");
  if (!sharedParam || !state.tracks.length) return;
  const shared = await playlists.decodePlaylistShare(sharedParam);
  const known = shared ? shared.trackIds.filter((id) => state.trackById.has(id)) : [];
  if (!shared || !known.length) {
    showToast("That shared playlist link couldn't be read", { error: true });
    return;
  }
  const missing = shared.trackIds.length - known.length;
  const confirmed = await confirmDanger({
    title: `Save "${shared.name}"?`,
    body: `Someone shared this playlist of ${known.length} ${known.length === 1 ? "song" : "songs"}${missing ? ` (${missing} no longer available)` : ""}. It will be added to your playlists.`,
    confirmLabel: "Save playlist",
    danger: false
  });
  if (!confirmed) return;
  const playlist = playlists.createPlaylist(shared.name, known);
  renderAll();
  if (!navigate("library", playlist.id)) applyView("library", playlist.id);
  showToast(`Saved "${playlist.name}"`);
}

async function init() {
  state.playlists = playlists.loadPlaylists();
  initRender(renderActions);
  bindEvents({ onRetryData: () => loadData() });
  bindMediaSession();
  nodes.volumeSlider.value = String(savedVolume());
  setPlayerVolume(savedVolume());
  syncMuteButton();
  initRouter(applyView);

  await loadData();

  const url = new URL(window.location.href);
  const params = url.searchParams;
  handleTrackLink(params);
  await handlePlaylistLink(params);

  /* Consumed deep-link params must not linger: whatever is in the address
   * bar afterwards is what users copy and share. */
  if (params.has("t") || params.has("play") || params.has("pl")) {
    ["t", "play", "pl"].forEach((name) => params.delete(name));
    /* `url` was captured at load — the flows above may have navigated since
     * (e.g. into a just-saved playlist), and that hash must survive. */
    url.hash = window.location.hash;
    window.history.replaceState(null, "", url);
  }

  /* Installable app + offline shell + instant repeat visits. Registered
   * last: the first paint must never compete with sw.js precaching. */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* No SW (old browser, private mode) just means no offline shell. */
    });
  }
}

init();
