/* Likes, playlists, and per-track actions (open/copy/menu). Keeps the play
 * queue honest when the active context's membership changes. */

import { LIBRARY_PAGE_SIZE, LIKED_ID, state } from "./state.js";
import * as playlists from "./playlists.js";
import { rebuildPlayOrder } from "./queue.js";
import { makeAppUrl } from "./data.js";
import {
  nodes, renderAll, renderLibrary, renderPlaylistNav, renderUpNext, syncHeartsFor
} from "./render.js";
import { burstHearts, dropRiverStar, inlineNameForm } from "./components.js";
import { closePlaylistMenu } from "./menu.js";
import { confirmDanger } from "./dialogs.js";
import { showToast } from "./toast.js";
import { firstPlaylistMilestone, likeMilestone } from "./soul.js";
import { navigate } from "./router.js";
import { applyView } from "./views.js";
import { queueLast, queueNext } from "./playback.js";

/* After a membership change in `playlistId`: refresh the nav counts, drop
 * the play context if the current song just left it, and re-render whichever
 * views show that playlist. Shared by the like and playlist toggles. */
function syncAfterMembershipChange(playlistId) {
  renderPlaylistNav();
  if (state.playContext === playlistId) {
    const contextIds = playlists.playlistById(playlistId)?.trackIds || [];
    if (state.currentId && !contextIds.includes(state.currentId)) state.playContext = null;
    rebuildPlayOrder();
    renderUpNext();
  }
  if (state.activePlaylist === playlistId && state.activeView === "library") renderLibrary();
}

export function handleToggleLiked(trackId, sourceButton = null) {
  const nowLiked = playlists.toggleLiked(trackId);
  if (nowLiked) {
    burstHearts(sourceButton);
    dropRiverStar(nodes.progressTrack);
  }
  syncHeartsFor(trackId);
  syncAfterMembershipChange(LIKED_ID);
  /* One-time moments get one-time copy: the 1st like and the 500th should
   * not produce identical output. */
  const milestone = nowLiked
    ? likeMilestone(state.playlists.liked.length, state.tracks.length)
    : null;
  if (milestone) showToast(milestone, { celebrate: true });
  else showToast(nowLiked ? "Saved to Liked Songs" : "Removed from Liked Songs");
}

function handleToggleInPlaylist(playlistId, track) {
  const added = playlists.toggleInPlaylist(playlistId, track.id);
  if (added === null) return;
  syncAfterMembershipChange(playlistId);
  const playlist = playlists.playlistById(playlistId);
  showToast(added ? `Added to ${playlist.name}` : `Removed from ${playlist.name}`);
}

function handleCreatePlaylist(name, track = null) {
  const playlist = playlists.createPlaylist(name, track ? [track.id] : []);
  if (!playlist) return null;
  if (firstPlaylistMilestone(state.playlists.custom.length)) {
    showToast(`Created "${playlist.name}" — your first playlist ✦`, { celebrate: true });
  } else {
    showToast(track ? `Added to ${playlist.name}` : `Created "${playlist.name}"`);
  }
  renderPlaylistNav();
  return playlist;
}

/* Sidebar +: an inline draft row appears where the playlist will live —
 * name it in place instead of through a modal. Creating from here also opens
 * the (empty) playlist, whose empty state explains how to fill it. */
export function openPlaylistDraft() {
  const existing = nodes.playlistNav.querySelector(".inline-name-form");
  if (existing) {
    existing.querySelector("input").focus();
    return;
  }
  const draft = inlineNameForm({
    placeholder: "Name your playlist",
    onSubmit: (name) => {
      draft.remove();
      const playlist = handleCreatePlaylist(name);
      if (playlist) handleSelectPlaylist(playlist.id);
    },
    onCancel: () => draft.remove()
  });
  draft.classList.add("playlist-draft");
  nodes.playlistNav.appendChild(draft);
  draft.scrollIntoView({ block: "nearest" });
  draft.querySelector("input").focus();
}

/* Rename happens where the name lives: the sidebar row swaps to an inline
 * input prefilled with the current name. */
export function handleRenamePlaylist(playlistId) {
  const playlist = playlists.playlistById(playlistId);
  if (!playlist || playlist.id === LIKED_ID) return;
  const item = nodes.playlistNav.querySelector(`[data-focus-key="pl:${playlistId}"]`);
  if (!item) return;
  const form = inlineNameForm({
    placeholder: "Rename playlist",
    value: playlist.name,
    onSubmit: (name) => {
      playlists.renamePlaylist(playlistId, name);
      renderAll(); // the name shows in the nav, library head, and toasts
      /* Toast the stored name — the raw input may have collapsed whitespace. */
      showToast(`Renamed to "${playlists.playlistById(playlistId).name}"`);
    },
    onCancel: () => renderPlaylistNav()
  });
  form.classList.add("playlist-draft");
  item.replaceWith(form);
  const input = form.querySelector("input");
  input.focus();
  input.select();
}

export async function handleSharePlaylist(playlistId) {
  const playlist = playlists.playlistById(playlistId);
  if (!playlist) return;
  if (!playlist.trackIds.length) {
    showToast("This playlist is empty — nothing to share yet", { error: true });
    return;
  }
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  /* The await is a local compression pass (milliseconds) — well inside the
   * user-activation window the clipboard write needs. */
  url.searchParams.set("pl", await playlists.encodePlaylistShare(playlist));
  copyText(url.toString(), "Share link copied — anyone can save this playlist");
}

export async function handleDeletePlaylist(playlistId) {
  const playlist = playlists.playlistById(playlistId);
  if (!playlist || playlist.id === LIKED_ID) return;
  const confirmed = await confirmDanger({
    title: `Delete "${playlist.name}"?`,
    body: `${playlist.trackIds.length} saved ${playlist.trackIds.length === 1 ? "song" : "songs"} will be removed with it.`,
    confirmLabel: "Delete playlist"
  });
  if (!confirmed) return;
  playlists.deletePlaylist(playlistId);
  if (state.activePlaylist === playlistId) {
    state.activePlaylist = null;
    /* Only the library view carries the dead #/library/<id> hash. Deleting
     * from elsewhere (sidebar right-click on the radio view) must not yank
     * the person over to the library. */
    if (state.activeView === "library") navigate("library");
  }
  if (state.playContext === playlistId) {
    state.playContext = null;
    rebuildPlayOrder();
  }
  renderAll();
  showToast("Playlist deleted");
}

export function handleSelectPlaylist(playlistId) {
  closePlaylistMenu();
  state.libraryVisibleCount = LIBRARY_PAGE_SIZE;
  state.query = "";
  nodes.globalSearch.value = "";
  nodes.searchClearBtn.hidden = true;
  /* Tapping the already-active playlist deselects it back to the full
   * library — with a single playlist there is no other way out. */
  const target = state.activeView === "library" && state.activePlaylist === playlistId
    ? null
    : playlistId;
  /* navigate() → hashchange → applyView picks the playlist up from the hash;
   * when the hash is already current, apply it directly. */
  if (!navigate("library", target)) applyView("library", target);
}

/* --------------------------------- actions -------------------------------- */

export function openTrack(track) {
  window.open(track.openUrl, "_blank", "noopener");
}

export async function copyText(text, successMessage) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      /* execCommand is deprecated but remains the only fallback on
       * non-secure origins; remove once the site is HTTPS-only. */
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    showToast(successMessage);
  } catch {
    showToast("Could not copy link", { error: true });
  }
}

export const menuActions = {
  onToggle: handleToggleInPlaylist,
  onCreate: handleCreatePlaylist,
  onQueueNext: queueNext,
  onQueueLast: queueLast,
  onOpen: openTrack,
  onCopyLink: (track) => copyText(track.openUrl, "YouTube link copied"),
  onCopyAppLink: (track) => copyText(makeAppUrl(track.id), "ShiiTunes link copied")
};
