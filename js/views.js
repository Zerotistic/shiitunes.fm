/* View switching + global search. applyView is the single place a view
 * becomes active (the router calls it on every hash change). */

import { LIBRARY_PAGE_SIZE, state } from "./state.js";
import * as playlists from "./playlists.js";
import { nodes, renderActiveView, renderLibrary, renderPlaylistNav } from "./render.js";
import { closePlaylistMenu } from "./menu.js";
import { navigate } from "./router.js";

export function applyView(view, playlistParam = null) {
  closePlaylistMenu();
  state.activeView = view;
  /* CSS keys view-specific chrome off this (About hides search; the mobile
   * playlist strip only shows in the Library). */
  nodes.app.dataset.view = view;
  if (view === "library") {
    /* The playlist lives in the hash (#/library/<id>) so Back/refresh/links
     * restore it; an unknown or deleted id falls back to the full library. */
    const valid = playlistParam && playlists.playlistById(playlistParam) ? playlistParam : null;
    if (valid !== state.activePlaylist) {
      state.activePlaylist = valid;
      state.libraryVisibleCount = LIBRARY_PAGE_SIZE;
    }
    renderPlaylistNav();
  }
  document.querySelectorAll(".view").forEach((node) => {
    node.classList.toggle("active", node.dataset.view === view);
  });
  document.querySelectorAll(".nav-item").forEach((node) => {
    node.classList.toggle("active", node.dataset.viewTarget === view);
  });
  renderActiveView();
}

export function setSearchQuery(value) {
  state.query = value;
  state.libraryVisibleCount = LIBRARY_PAGE_SIZE;
  nodes.searchClearBtn.hidden = !value;
  /* Typing anywhere lands you on live Library results — silent input from
   * other views reads as broken search. */
  if (value.trim() && state.activeView !== "library") {
    navigate("library");
    return;
  }
  if (state.activeView === "library") renderLibrary();
}

export function clearSearch() {
  nodes.globalSearch.value = "";
  setSearchQuery("");
  nodes.globalSearch.focus();
}
