/* All DOM event wiring: buttons, search, seek bar, keyboard shortcuts.
 * Pure glue — behavior lives in playback.js / collections.js / views.js. */

import { LIBRARY_PAGE_SIZE, currentTrack, isPlaying, state } from "./state.js";
import { makeAppUrl } from "./data.js";
import { loadedTrackId, playedSeconds, seekWithin } from "./player.js";
import { nodes, renderLibrary } from "./render.js";
import { closePlaylistMenu, openContextMenu, openPlaylistMenu, openTrackMenu } from "./menu.js";
import { applyView, clearSearch, setSearchQuery } from "./views.js";
import {
  applyVolume, cycleRepeat, handlePrev, moveBy, setSleepTimer, shuffleAllAndPlay,
  sleepChoice, startStation, togglePlayback, toggleMute, toggleNowPanel,
  togglePanelSize, toggleShuffle
} from "./playback.js";
import {
  copyText, handleDeletePlaylist, handleToggleLiked, openPlaylistDraft,
  menuActions, openTrack
} from "./collections.js";
import { navigate } from "./router.js";

const SEEK_STEP_SECONDS = 5;

export function bindEvents({ onRetryData }) {
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.viewTarget;
      /* Nav always targets the plain view — leaving any #/library/<id>. */
      if (!navigate(view)) applyView(view, null);
    });
  });

  document.querySelectorAll(".station-chip").forEach((button) => {
    button.addEventListener("click", () => {
      /* "Everything" is shuffle-all wearing a station chip. */
      if (button.dataset.station === "all") shuffleAllAndPlay();
      else startStation(button.dataset.station, button.textContent.trim());
    });
  });

  nodes.globalSearch.addEventListener("input", () => setSearchQuery(nodes.globalSearch.value));
  nodes.globalSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nodes.globalSearch.value) {
      event.stopPropagation();
      clearSearch();
    }
  });
  nodes.searchClearBtn.addEventListener("click", clearSearch);

  document.querySelectorAll(".filter-chip[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.libraryFilter = button.dataset.filter;
      state.libraryVisibleCount = LIBRARY_PAGE_SIZE;
      document.querySelectorAll(".filter-chip[data-filter]").forEach((node) => {
        const active = node === button;
        node.classList.toggle("active", active);
        node.setAttribute("aria-pressed", String(active));
      });
      renderLibrary();
    });
  });

  /* Sort toggles: off = default stream order. ("Stream order" as a visible
   * concept meant nothing to visitors.) Newest only renders once the index
   * carries dates (state.hasDates). */
  const setLibrarySort = (sort) => {
    state.librarySort = state.librarySort === sort ? "stream" : sort;
    state.libraryVisibleCount = LIBRARY_PAGE_SIZE;
    renderLibrary();
  };
  nodes.azSortBtn.addEventListener("click", () => setLibrarySort("az"));
  nodes.newestSortBtn.addEventListener("click", () => setLibrarySort("newest"));

  nodes.playBtn.addEventListener("click", togglePlayback);
  nodes.heroPlayBtn.addEventListener("click", togglePlayback);
  nodes.prevBtn.addEventListener("click", handlePrev);
  nodes.nextBtn.addEventListener("click", () => moveBy(1));
  nodes.shuffleBtn.addEventListener("click", toggleShuffle);
  nodes.repeatBtn.addEventListener("click", cycleRepeat);

  /* Current-track buttons no-op until a track exists (initial data load). */
  const withCurrentTrack = (handler) => () => {
    const track = currentTrack();
    if (track) handler(track);
  };
  const openCurrent = withCurrentTrack(openTrack);
  nodes.heroOpenBtn.addEventListener("click", openCurrent);
  nodes.heroBlockedOpenBtn.addEventListener("click", openCurrent);
  nodes.panelBlockedOpenBtn.addEventListener("click", openCurrent);
  nodes.heroShareBtn.addEventListener("click", withCurrentTrack(
    (track) => copyText(makeAppUrl(track.id), "ShiiTunes link copied")
  ));
  nodes.heroLikeBtn.addEventListener("click", withCurrentTrack(
    (track) => handleToggleLiked(track.id, nodes.heroLikeBtn)
  ));
  nodes.currentLikeBtn.addEventListener("click", withCurrentTrack(
    (track) => handleToggleLiked(track.id, nodes.currentLikeBtn)
  ));
  nodes.heroAddBtn.addEventListener("click", withCurrentTrack(
    (track) => openPlaylistMenu(nodes.heroAddBtn, track, menuActions)
  ));
  nodes.playerMenuBtn.addEventListener("click", withCurrentTrack(
    (track) => openTrackMenu(nodes.playerMenuBtn, track, menuActions)
  ));
  nodes.panelHideBtn.addEventListener("click", toggleNowPanel);
  nodes.panelToggleBtn.addEventListener("click", togglePanelSize);
  nodes.playerNowBtn.addEventListener("click", () => {
    if (!navigate("radio")) applyView("radio");
  });

  nodes.volumeSlider.addEventListener("input", () => {
    applyVolume(Number(nodes.volumeSlider.value));
  });
  nodes.muteBtn.addEventListener("click", toggleMute);
  nodes.sleepBtn.addEventListener("click", () => openSleepMenu(nodes.sleepBtn));
  nodes.dataRetryBtn.addEventListener("click", onRetryData);
  nodes.newPlaylistBtn.addEventListener("click", openPlaylistDraft);
  nodes.deletePlaylistBtn.addEventListener("click", () => handleDeletePlaylist(state.activePlaylist));

  bindSeekBar();
  bindGlobalShortcuts();
  bindGlobalContextMenu();
  bindButtonBlurOnClick();
}

/* Any <button> stays focused after a mouse click (native behavior), so a
 * later Space/Enter press — meant to do something else, like toggling
 * play/pause — instead re-activates the still-focused button again (e.g.
 * clicking the like button, then pressing space to pause, "likes" it a
 * second time instead). This affects every button in the app, not just
 * transport controls, so it's handled once here instead of per-handler.
 * Keyboard-activated clicks (Space/Enter on a focused button) report
 * event.detail === 0; real mouse clicks report >= 1 — only blur the mouse
 * case, so tabbing/keyboard users keep normal focus behavior. */
function bindButtonBlurOnClick() {
  document.addEventListener("click", (event) => {
    if (event.detail === 0) return;
    const button = event.target.closest("button");
    if (button) button.blur();
  });
}

/* Picking the already-active option turns the timer off — the moon button
 * toggles without needing a separate off row while inactive. */
function openSleepMenu(anchor, at = null) {
  const current = sleepChoice();
  const entry = (value, label) => ({
    icon: current === value ? "check" : "moon",
    label,
    onPick: () => setSleepTimer(current === value ? "off" : value)
  });
  const entries = [
    entry("song", "Stop after this song"),
    entry(15, "Stop in 15 minutes"),
    entry(30, "Stop in 30 minutes"),
    entry(60, "Stop in 60 minutes")
  ];
  if (current !== "off") {
    entries.push({ icon: "close", label: "Turn off timer", danger: true, onPick: () => setSleepTimer("off") });
  }
  openContextMenu(anchor, entries, { at, label: "Sleep timer" });
}

/* Right-click is app-owned: songs/playlists open their own menus (element
 * handlers, which preventDefault before this runs), the player and hero open
 * the current song's menu, and anywhere else opens a small player remote.
 * The native menu survives where it's genuinely useful — inputs, links, and
 * selected text. */
function bindGlobalContextMenu() {
  document.addEventListener("contextmenu", (event) => {
    if (event.defaultPrevented) return; // a row/card/playlist already handled it
    const target = event.target;
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    if (target.closest("a[href]")) return;
    if (String(window.getSelection())) return;
    event.preventDefault();
    if (target.closest(".playlist-menu")) return; // already showing options

    const at = { x: event.clientX, y: event.clientY };
    const track = currentTrack();
    if (track && target.closest(".bottom-player, .now-panel, .hero-card")) {
      openTrackMenu(target, track, menuActions, { at });
      return;
    }
    openContextMenu(target, [
      {
        icon: isPlaying() ? "pause" : "play",
        label: isPlaying() ? "Pause" : "Play",
        onPick: togglePlayback
      },
      { icon: "next", label: "Next song", onPick: () => moveBy(1) },
      { icon: "shuffle", label: "Shuffle everything", onPick: shuffleAllAndPlay },
      { icon: "moon", label: "Sleep timer", onPick: () => openSleepMenu(target, at) }
    ], { at, label: "Player options" });
  });
}

/* Draggable seeking: scrub while the pointer is down, commit on release. */
function bindSeekBar() {
  let dragging = false;

  const ratioFromEvent = (event) => {
    const rect = nodes.progressTrack.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  };

  nodes.progressTrack.addEventListener("pointerdown", (event) => {
    const track = currentTrack();
    if (!track || !track.duration || loadedTrackId() !== track.id) return;
    dragging = true;
    /* Direct manipulation: the star must track the pointer with no easing. */
    nodes.progressTrack.classList.add("scrubbing");
    nodes.progressTrack.setPointerCapture(event.pointerId);
    seekWithin(ratioFromEvent(event) * track.duration, { commit: false });
  });
  nodes.progressTrack.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const track = currentTrack();
    if (!track || !track.duration) return;
    seekWithin(ratioFromEvent(event) * track.duration, { commit: false });
  });
  const finishDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    nodes.progressTrack.classList.remove("scrubbing");
    const track = currentTrack();
    if (track && track.duration) seekWithin(ratioFromEvent(event) * track.duration);
  };
  nodes.progressTrack.addEventListener("pointerup", finishDrag);
  nodes.progressTrack.addEventListener("pointercancel", () => {
    dragging = false;
    nodes.progressTrack.classList.remove("scrubbing");
  });

  nodes.progressTrack.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.key === "ArrowLeft" ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS;
    seekWithin(playedSeconds() + delta);
  });
}

function bindGlobalShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePlaylistMenu();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    /* Never steal keys from anything interactive, wherever focus happens to
     * be (body, html, or a wrapper). */
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, button, a, dialog, [contenteditable], [tabindex]")) return;
    if (event.key === " ") {
      event.preventDefault();
      togglePlayback();
    }
    if (event.key === "ArrowLeft") handlePrev();
    if (event.key === "ArrowRight") moveBy(1);
  });
}
