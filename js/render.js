/* All DOM rendering. The app wires user actions in via initRender(actions);
 * nothing in here mutates state or talks to the player directly.
 *
 * Hot paths (like toggles, player status changes, progress) patch the DOM in
 * place instead of rebuilding lists, so keyboard focus survives interaction. */

import { createCover, emptyState, icon, skeletonRows } from "./components.js";
import { LIBRARY_PAGE_SIZE, LIKED_ID, currentTrack, isEmbedBlocked, isPlaying, state } from "./state.js";
import { allPlaylists, isLiked, playlistById } from "./playlists.js";
import { libraryTracks, upNextTracks } from "./queue.js";
import { formatClock, hasCJK } from "./utils.js";

const SKELETON_ROWS = 8;

export const nodes = {};

let actions = {
  onSelectTrack() {},
  onToggleLiked() {},
  onOpenMenu() {},
  onSelectPlaylist() {},
  onPlaylistContext() {},
  onPlayQueued() {},
  onQueuedMenu() {}
};

export function initRender(userActions) {
  actions = { ...actions, ...userActions };
  const ids = [
    "globalSearch", "searchClearBtn", "dataBanner", "dataBannerText", "dataRetryBtn",
    "playlistNav", "newPlaylistBtn",
    "heroCard", "heroArtBox", "onAirChip", "onAirText", "heroTitle", "heroSubtitle", "heroSource",
    "heroBlockedNote", "heroBlockedOpenBtn", "heroPlayBtn", "heroPlayLabel", "heroLikeBtn",
    "heroAddBtn", "heroShareBtn", "heroOpenBtn",
    "upNextList", "upNextCount",
    "libraryRows", "libraryCount", "libraryTitle", "deletePlaylistBtn",
    "azSortBtn", "newestSortBtn", "filterRow", "libraryControls",
    "playerArtBox", "playerTitle", "playerArtist", "playerSource", "currentLikeBtn", "playerNowBtn",
    "playerElapsed", "playerDuration", "progressTrack", "progressFill",
    "playBtn", "prevBtn", "nextBtn", "shuffleBtn", "repeatBtn",
    "playerMenuBtn", "volumeSlider", "muteBtn", "sleepBtn",
    "nowPanel", "panelOverlay", "panelTitle", "panelArtist", "panelSource",
    "panelBlockedNote", "panelBlockedOpenBtn",
    "panelToggleBtn", "panelHideBtn",
    "aboutMoments", "aboutStreams", "aboutHours", "aboutLiked", "aboutLikedLabel", "toast"
  ];
  ids.forEach((id) => {
    nodes[id] = document.getElementById(id);
  });
  nodes.app = document.querySelector(".app-shell");
  nodes.knotWrap = document.querySelector(".knot-wrap");
  nodes.nowCopy = document.querySelector(".now-copy");
  nodes.panelInfo = document.querySelector(".panel-info");
  nodes.progressRiver = document.querySelector(".progress-fill-river");
  nodes.upNextList.addEventListener("scroll", syncQueueFade, { passive: true });
  nodes.filterRow.addEventListener("scroll", syncFilterFade, { passive: true });
  window.addEventListener("resize", syncFilterFade);
}

/* On phones the filter chips become a nowrap scroll strip; without a fade
 * the clipped chip at the edge reads as a broken layout, not "scroll me".
 * Same contract as the queue's edge fades. */
function syncFilterFade() {
  const row = nodes.filterRow;
  row.classList.toggle("fade-left", row.scrollLeft > 4);
  row.classList.toggle("fade-right", row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
}

/* Re-rendering replaces the focused element; find its successor by key so
 * keyboard users are not ejected to <body> after every interaction. When the
 * exact key is gone (e.g. the activated queue card left the queue), an
 * optional fallback selector keeps focus in the neighborhood. */
function withFocusRestore(rerender, fallbackSelector = null) {
  const key = document.activeElement?.dataset?.focusKey;
  rerender();
  if (!key) return;
  const successor = document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
  if (successor) {
    successor.focus();
  } else if (fallbackSelector) {
    document.querySelector(fallbackSelector)?.focus();
  }
}

/* ------------------------------ text helpers ----------------------------- */

function playerStatusLabel() {
  if (state.playerStatus === "loading") return "Tuning in";
  if (state.playerStatus === "playing") return "On air";
  if (state.playerStatus === "paused") return "Paused";
  if (state.playerStatus === "error") return "YouTube only";
  return "Ready";
}

/* Keep collab credits intact: only Shiina-alone artist strings collapse.
 * Wording is category-aware — "cover" implies a produced cover video, so
 * karaoke clips credit the original artist without claiming to be one. */
export function performerLabel(track) {
  if (track.untitled || track.shiinaIsArtist) return "Shiina Amanogawa";
  if (/shiina|amanogawa/i.test(track.artist)) return track.artist;
  if (track.category === "cover") return `Shiina Amanogawa · ${track.artist} cover`;
  if (track.category === "original") return track.artist;
  return `Shiina Amanogawa · orig. ${track.artist}`;
}

/* The one place the "<source> · <date>" line is assembled. */
function sourceLine(track) {
  return track.dateLabel ? `${track.sourceLabel} · ${track.dateLabel}` : track.sourceLabel;
}

/* Set text and tag CJK content so screen readers pick a Japanese voice. */
function langText(node, text) {
  node.textContent = text;
  if (hasCJK(text)) node.lang = "ja";
  else node.removeAttribute("lang");
}

/* Secondary line for queues and rows. Untitled songs always carry their
 * source so identical "Untitled singing moment" rows stay distinguishable. */
function trackSubtitle(track, { includeSource = true, includeDuration = false } = {}) {
  const parts = [];
  if (!track.shiinaIsArtist && !track.untitled) parts.push(track.artist);
  if ((includeSource || track.untitled) && track.sourceLabel) parts.push(track.sourceLabel);
  if (includeDuration && track.duration) parts.push(track.durationLabel);
  return parts.join(" · ");
}

/* ------------------------------- fragments ------------------------------- */

function createHeartButton(track) {
  const button = document.createElement("button");
  button.className = "icon-action heart-action";
  button.type = "button";
  button.dataset.focusKey = `heart:${track.id}`;
  button.dataset.heartFor = track.id;
  syncHeartButton(button, track);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    actions.onToggleLiked(track.id, button);
  });
  return button;
}

/* All secondary row actions live behind one ⋮ menu; only the heart stays
 * inline as the one-tap action. */
function createMenuButton(track) {
  const button = document.createElement("button");
  button.className = "icon-action menu-action";
  button.type = "button";
  button.dataset.focusKey = `menu:${track.id}`;
  button.setAttribute("aria-label", `More options for ${track.title}`);
  button.setAttribute("aria-haspopup", "menu");
  button.appendChild(icon("dots"));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    actions.onOpenMenu(button, track);
  });
  return button;
}

/* Right-click anywhere on a track element opens its ⋮ menu at the cursor. */
function bindTrackContextMenu(element, track) {
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    actions.onOpenMenu(element, track, { x: event.clientX, y: event.clientY });
  });
}

function syncHeartButton(button, track, saveLabel = "Save to Liked Songs", removeLabel = "Remove from Liked Songs") {
  if (!button) return;
  button.innerHTML = "";
  const liked = Boolean(track && isLiked(track.id));
  button.disabled = !track;
  button.classList.toggle("active", liked);
  button.setAttribute("aria-pressed", String(liked));
  button.setAttribute("aria-label", liked ? removeLabel : saveLabel);
  button.appendChild(icon(liked ? "heart-fill" : "heart"));
}

/* Patch every heart for a track in place — no list rebuild, no focus loss. */
export function syncHeartsFor(trackId) {
  const track = state.trackById.get(trackId);
  if (!track) return;
  document.querySelectorAll(`[data-heart-for="${CSS.escape(trackId)}"]`).forEach((button) => {
    syncHeartButton(button, track);
  });
  if (state.currentId === trackId) {
    syncHeartButton(nodes.heroLikeBtn, track);
    syncHeartButton(nodes.currentLikeBtn, track, "Save current song to Liked Songs", "Remove current song from Liked Songs");
  }
}

function createPlayingBars() {
  const bars = document.createElement("span");
  bars.className = "playing-bars";
  bars.setAttribute("aria-hidden", "true");
  bars.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  return bars;
}

/* Replay the .track-swap entrance on a surface's text/art when its track
 * actually changes. Keyed per surface: the hero can render later than the
 * player (view switch, renderAll) and must not replay for a track it has
 * already shown. The first render of a surface never animates — the page
 * arrival is view-in's job. */
const swapShown = new Map();

function replayTrackSwap(surface, trackId, elements) {
  const previous = swapShown.get(surface);
  swapShown.set(surface, trackId);
  if (previous === undefined || previous === trackId || !trackId) return;
  const targets = elements.filter(Boolean);
  targets.forEach((el) => el.classList.remove("track-swap"));
  void targets[0]?.offsetWidth;
  targets.forEach((el) => el.classList.add("track-swap"));
}

/* -------------------------------- sections ------------------------------- */

export function renderSkeletons() {
  nodes.upNextList.innerHTML = "";
  nodes.upNextList.appendChild(skeletonRows(4));
  nodes.libraryRows.innerHTML = "";
  nodes.libraryRows.appendChild(skeletonRows(SKELETON_ROWS));
}

export function renderBanner() {
  if (state.dataStatus === "error") {
    nodes.dataBannerText.textContent = "Couldn't load the song index. Check your connection and retry.";
    nodes.dataBanner.hidden = false;
  } else if (state.dataStatus === "empty") {
    nodes.dataBannerText.textContent = "The song index is empty — no songs to play yet.";
    nodes.dataBanner.hidden = false;
  } else {
    nodes.dataBanner.hidden = true;
  }
}

export function renderHero() {
  const track = currentTrack();

  replayTrackSwap("hero", track?.id ?? null, [nodes.heroArtBox, nodes.heroTitle, nodes.heroSubtitle, nodes.heroSource]);
  nodes.heroArtBox.innerHTML = "";
  /* The card's blurred backdrop is the track's own cover art. The small
   * thumb: this is typically the LCP image, and the blur hides the pixels. */
  if (track) {
    nodes.heroCard.style.setProperty("--hero-cover", `url("${track.thumbnailSmall}")`);
  } else {
    nodes.heroCard.style.removeProperty("--hero-cover");
  }
  if (!track) {
    nodes.onAirText.textContent = "Off air";
    nodes.onAirChip.classList.remove("live", "loading");
    nodes.heroTitle.textContent = state.dataStatus === "loading" ? "Tuning the telescope…" : "The night sky is quiet";
    nodes.heroSubtitle.textContent = state.dataStatus === "loading" ? "" : "No singing songs loaded yet.";
    nodes.heroSource.textContent = "";
    nodes.heroBlockedNote.hidden = true;
    syncHeartButton(nodes.heroLikeBtn, null);
    nodes.heroAddBtn.disabled = true;
    nodes.heroShareBtn.disabled = true;
    return;
  }

  nodes.heroArtBox.appendChild(createCover(track, "hero"));
  nodes.heroAddBtn.disabled = false;
  nodes.heroShareBtn.disabled = false;
  langText(nodes.heroTitle, track.title);
  nodes.heroSubtitle.textContent = performerLabel(track);
  langText(nodes.heroSource, sourceLine(track));
  nodes.heroSource.title = track.source;
  nodes.heroBlockedNote.hidden = !isEmbedBlocked(track.id);
  syncHeartButton(nodes.heroLikeBtn, track);
  renderPlayerState();
}

/* Status-dependent chrome only: chips, labels, playing classes. Cheap enough
 * to run on every YouTube state event without rebuilding any list. */
export function renderPlayerState() {
  nodes.app.classList.toggle("is-playing", isPlaying());
  nodes.app.classList.toggle("is-loading", state.playerStatus === "loading");
  nodes.app.dataset.playerStatus = state.playerStatus;

  nodes.onAirText.textContent = currentTrack() ? playerStatusLabel() : "Off air";
  nodes.onAirChip.classList.toggle("live", isPlaying());
  nodes.onAirChip.classList.toggle("loading", state.playerStatus === "loading");
  nodes.heroPlayLabel.textContent = state.playerStatus === "loading"
    ? "Loading"
    : isPlaying()
      ? "Pause"
      : "Play";

  nodes.shuffleBtn.classList.toggle("active", state.shuffle);
  nodes.shuffleBtn.setAttribute("aria-pressed", String(state.shuffle));
  nodes.repeatBtn.classList.toggle("active", state.repeat !== "off");
  nodes.repeatBtn.classList.toggle("repeat-one", state.repeat === "one");
  nodes.repeatBtn.setAttribute("aria-label", `Repeat ${state.repeat}`);
}

function createQueueCard(track, keyPrefix, subtitleOptions = { includeSource: false, includeDuration: true }, queuedIndex = null) {
  const card = document.createElement("button");
  card.className = "queue-card";
  card.type = "button";
  /* Hand-queued cards act on their queue slot, not the track id: the same
   * song can sit in the queue and in the ambient order at once. */
  if (queuedIndex !== null) {
    card.classList.add("queued");
    card.dataset.focusKey = `${keyPrefix}:q${queuedIndex}:${track.id}`;
    card.addEventListener("click", () => actions.onPlayQueued(queuedIndex));
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      actions.onQueuedMenu(card, track, queuedIndex, { x: event.clientX, y: event.clientY });
    });
  } else {
    card.dataset.focusKey = `${keyPrefix}:${track.id}`;
    card.addEventListener("click", () => actions.onSelectTrack(track.id, { play: true }));
    bindTrackContextMenu(card, track);
  }

  const meta = document.createElement("span");
  meta.className = "queue-meta";

  const title = document.createElement("span");
  title.className = "queue-title";
  langText(title, track.title);

  const subtitle = document.createElement("span");
  subtitle.className = "queue-subtitle";
  langText(subtitle, trackSubtitle(track, subtitleOptions) || performerLabel(track));

  meta.append(title, subtitle);
  card.append(createCover(track), meta);
  return card;
}

export function renderUpNext() {
  withFocusRestore(() => {
    const { tracks: upcoming, queuedCount, endsHere } = upNextTracks();
    nodes.upNextList.innerHTML = "";
    nodes.upNextCount.textContent = upcoming.length ? `${upcoming.length} up next` : "";

    if (!upcoming.length) {
      nodes.upNextList.appendChild(
        endsHere
          ? emptyState("End of the station", "Turn on repeat or shuffle to keep the music going.")
          : emptyState("Nothing queued", "Play a song to chart the course.")
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    upcoming.forEach((track, index) => fragment.appendChild(
      createQueueCard(track, "queue", undefined, index < queuedCount ? index : null)
    ));
    nodes.upNextList.appendChild(fragment);

    if (endsHere) {
      const note = document.createElement("p");
      note.className = "queue-end-note";
      note.textContent = "End of the station — turn on repeat or shuffle to keep going.";
      nodes.upNextList.appendChild(note);
    }
  }, ".upnext-list .queue-card");
  /* Deferred a frame: during the initial renderAll the panel is still
   * hidden, so the list measures 0 tall and no fade would ever appear. */
  window.requestAnimationFrame(syncQueueFade);
}

/* The queue hides its scrollbar; edge fades signal off-screen items instead.
 * Runs on every scroll tick and rebuild (cheap: two reads, two toggles). */
function syncQueueFade() {
  const list = nodes.upNextList;
  list.classList.toggle("fade-top", list.scrollTop > 4);
  list.classList.toggle("fade-bottom", list.scrollTop + list.clientHeight < list.scrollHeight - 4);
}

function renderLibraryRow(track, index) {
  const row = document.createElement("div");
  row.className = `library-row${track.id === state.currentId ? " active" : ""}`;
  row.dataset.trackRow = track.id;

  const songCell = document.createElement("span");
  songCell.className = "library-song";

  const songButton = document.createElement("button");
  songButton.className = "library-song-cell";
  songButton.type = "button";
  songButton.dataset.focusKey = `row:${track.id}`;
  songButton.setAttribute("aria-label", `Play ${track.title}`);
  songButton.addEventListener("click", () => actions.onSelectTrack(track.id, { play: true, setContext: state.activePlaylist }));

  const number = document.createElement("span");
  number.className = "row-number";
  number.textContent = String(index + 1);

  const meta = document.createElement("span");
  meta.className = "library-meta";

  const title = document.createElement("span");
  title.className = `library-title${track.untitled ? " untitled" : ""}`;
  langText(title, track.title);

  const artist = document.createElement("span");
  artist.className = "library-artist";
  const artistText = performerLabel(track);
  artist.textContent = isEmbedBlocked(track.id) ? `${artistText} · plays on YouTube` : artistText;

  /* Narrow-layout second line: the source (and date) that wide layouts show
   * in a column — without it duplicate songs are indistinguishable. */
  const sub = document.createElement("span");
  sub.className = "library-sub";
  langText(sub, sourceLine(track));

  meta.append(title, artist, sub);
  songButton.append(createPlayingBars(), number, createCover(track), meta);
  songCell.appendChild(songButton);

  const source = document.createElement("span");
  source.className = "library-source";
  langText(source, sourceLine(track));
  source.title = track.source;

  const duration = document.createElement("span");
  duration.className = `duration${track.duration ? "" : " duration-unknown"}`;
  duration.textContent = track.duration ? track.durationLabel : "—";
  if (!track.duration) duration.setAttribute("aria-label", "Duration unknown");

  const rowActions = document.createElement("span");
  rowActions.className = "row-actions";
  rowActions.append(createHeartButton(track), createMenuButton(track));

  row.append(songCell, source, duration, rowActions);
  bindTrackContextMenu(row, track);
  return row;
}

/* Which query/filter/sort/playlist the list last showed. "Show more" and
 * like-driven rebuilds keep the same context and must not replay the settle. */
let lastLibraryContext;

export function renderLibrary() {
  const context = [state.activePlaylist, state.query.trim(), state.librarySort, state.libraryFilter].join("|");
  if (lastLibraryContext !== undefined && lastLibraryContext !== context) {
    nodes.libraryRows.classList.remove("list-swap");
    void nodes.libraryRows.offsetWidth;
    nodes.libraryRows.classList.add("list-swap");
  }
  lastLibraryContext = context;

  withFocusRestore(() => {
    const playlist = state.activePlaylist ? playlistById(state.activePlaylist) : null;
    const tracks = libraryTracks();
    const visibleTracks = tracks.slice(0, state.libraryVisibleCount);
    nodes.libraryRows.innerHTML = "";
    nodes.libraryTitle.textContent = playlist ? playlist.name : "Library";
    nodes.deletePlaylistBtn.hidden = !playlist || playlist.id === LIKED_ID;

    /* Category filters and sorting only make sense over the full index. */
    nodes.libraryControls.hidden = Boolean(playlist);
    const query = state.query.trim();
    syncSortChip(nodes.azSortBtn, "az", query);
    syncSortChip(nodes.newestSortBtn, "newest", query);
    /* The Newest chip only exists once the index actually carries dates. */
    nodes.newestSortBtn.hidden = !state.hasDates;
    /* Deferred a frame: on the first library render the view may still be
     * display:none, where the row measures 0 wide and no fade would appear. */
    window.requestAnimationFrame(syncFilterFade);

    const showingText = tracks.length > visibleTracks.length
      ? `Showing ${visibleTracks.length} of ${tracks.length}`
      : `${tracks.length}`;
    nodes.libraryCount.textContent = query
      ? `${showingText} results for "${query}"`
      : `${showingText} songs`;

    if (!tracks.length) {
      let message;
      if (playlist && !query) {
        message = playlist.id === LIKED_ID
          ? emptyState("No liked songs yet", "Tap the heart on any song to save it here.")
          : emptyState("This playlist is empty", "Use the + button on any song to add it.");
      } else if (state.dataStatus === "empty" || state.dataStatus === "error") {
        message = emptyState("No songs yet", "The index has no songs — check back soon.");
      } else {
        message = emptyState("No stars found", "Try another title, artist, or stream name.");
      }
      nodes.libraryRows.appendChild(message);
      return;
    }

    const fragment = document.createDocumentFragment();
    visibleTracks.forEach((track, index) => fragment.appendChild(renderLibraryRow(track, index)));
    nodes.libraryRows.appendChild(fragment);

    if (visibleTracks.length < tracks.length) {
      const more = document.createElement("button");
      more.className = "show-more-row";
      more.type = "button";
      more.dataset.focusKey = "more";
      more.textContent = `Show ${Math.min(LIBRARY_PAGE_SIZE, tracks.length - visibleTracks.length)} more`;
      more.addEventListener("click", () => {
        state.libraryVisibleCount += LIBRARY_PAGE_SIZE;
        renderLibrary();
      });
      nodes.libraryRows.appendChild(more);
    }
  });
}

/* Search results are relevance-ordered, so the sort chips go inert (not just
 * unstyled) while a query is active — a lit A–Z chip over non-A–Z rows lies. */
function syncSortChip(button, sort, query) {
  const active = state.librarySort === sort;
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
  button.disabled = Boolean(query);
}

/* Swap the active-row highlight without rebuilding the list. */
export function updateLibraryActiveRow() {
  document.querySelectorAll("[data-track-row]").forEach((row) => {
    row.classList.toggle("active", row.dataset.trackRow === state.currentId);
  });
}

export function renderPlaylistNav() {
  withFocusRestore(() => {
    nodes.playlistNav.innerHTML = "";
    const fragment = document.createDocumentFragment();

    allPlaylists().forEach((playlist) => {
      const button = document.createElement("button");
      button.className = `playlist-item${playlist.id === state.activePlaylist ? " active" : ""}`;
      button.type = "button";
      button.dataset.focusKey = `pl:${playlist.id}`;
      if (playlist.id === state.activePlaylist) button.setAttribute("aria-current", "page");

      const name = document.createElement("span");
      name.className = "playlist-name";
      name.textContent = playlist.name;

      const count = document.createElement("span");
      count.className = "playlist-count";
      const total = playlist.trackIds.length;
      count.textContent = `${total} ${total === 1 ? "song" : "songs"}`;

      button.append(name, count);
      button.addEventListener("click", () => actions.onSelectPlaylist(playlist.id));
      /* Right-click management shortcuts. Every playlist gets one — the
       * handler decides what Liked Songs may do (share, not rename/delete). */
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        actions.onPlaylistContext(button, playlist, { x: event.clientX, y: event.clientY });
      });
      fragment.appendChild(button);
    });

    nodes.playlistNav.appendChild(fragment);
  });
}

export function renderPlayer() {
  const track = currentTrack();
  renderPlayerState();

  replayTrackSwap("player", track?.id ?? null, [nodes.playerArtBox, nodes.nowCopy]);
  nodes.playerArtBox.innerHTML = "";
  if (!track) {
    nodes.playerTitle.textContent = state.dataStatus === "loading" ? "Loading ShiiTunes" : "No track selected";
    nodes.playerArtist.textContent = "Shiina Amanogawa";
    nodes.playerSource.textContent = "";
    nodes.playerElapsed.textContent = "0:00";
    nodes.playerDuration.textContent = "--:--";
    setProgressRatio(0);
    syncSeekable(null);
    syncHeartButton(nodes.currentLikeBtn, null, "Save current song to Liked Songs", "Remove current song from Liked Songs");
    renderNowPanel(null);
    return;
  }

  nodes.playerArtBox.appendChild(createCover(track, "player"));
  langText(nodes.playerTitle, track.title);
  nodes.playerArtist.textContent = performerLabel(track);
  langText(nodes.playerSource, track.sourceLabel);
  nodes.playerSource.title = track.source;
  nodes.playerDuration.textContent = track.duration ? track.durationLabel : "--:--";
  syncSeekable(track);
  syncHeartButton(nodes.currentLikeBtn, track, "Save current song to Liked Songs", "Remove current song from Liked Songs");
  renderNowPanel(track);
}

/* Pointer seeking needs a known duration; without one the bar is display-only
 * and must not advertise itself as an enabled slider. */
function syncSeekable(track) {
  const seekable = Boolean(track && track.duration);
  nodes.progressTrack.dataset.seekable = String(seekable);
  nodes.progressTrack.setAttribute("aria-disabled", String(!seekable));
}

/* Info half of the now-playing panel. The video frame above it is managed by
 * the player module (iframe) plus the has-video class set on first playback. */
function renderNowPanel(track) {
  syncPanelToggleButton();
  replayTrackSwap("panel", track?.id ?? null, [nodes.panelInfo]);
  if (!track) {
    nodes.nowPanel.hidden = state.panelDismissed || !isPlaying();
    return;
  }
  nodes.nowPanel.hidden = state.panelDismissed;
  langText(nodes.panelTitle, track.title);
  nodes.panelArtist.textContent = performerLabel(track);
  langText(nodes.panelSource, sourceLine(track));
  nodes.panelSource.title = track.source;
  nodes.panelBlockedNote.hidden = !isEmbedBlocked(track.id);
  nodes.panelOverlay.style.setProperty("--panel-cover", `url("${track.thumbnail}")`);
}

/* Player-bar toggle mirrors the panel: lit while the panel is showing. */
export function syncPanelToggleButton() {
  const visible = !state.panelDismissed;
  nodes.panelHideBtn.classList.toggle("active", visible);
  nodes.panelHideBtn.setAttribute("aria-pressed", String(visible));
  nodes.panelHideBtn.setAttribute(
    "aria-label",
    visible ? "Hide now playing panel" : "Show now playing panel"
  );
}

export function updateProgress({ elapsed, duration }) {
  nodes.playerElapsed.textContent = formatClock(elapsed);
  if (duration) {
    setProgressRatio(Math.min(1, elapsed / duration));
    nodes.progressTrack.setAttribute("aria-valuetext", `${formatClock(elapsed)} of ${formatClock(duration)}`);
  } else {
    /* No known duration = no honest fill ratio. Pinning it to zero beats the
     * alternative — inheriting whatever the previous song left behind. */
    setProgressRatio(0);
    nodes.progressTrack.setAttribute("aria-valuetext", formatClock(elapsed));
  }
}

let lastProgressRatio = 0;

export function setProgressRatio(ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  /* Playback progress only polls every 500ms; a linear transition glides the
   * star between ticks. Backwards moves and big jumps (seeks, track changes)
   * snap instantly so the star never sweeps across the whole bar. */
  const glide = clamped >= lastProgressRatio && clamped - lastProgressRatio < 0.04;
  nodes.progressTrack.classList.toggle("progress-snap", !glide);
  lastProgressRatio = clamped;

  const percent = `${clamped * 100}%`;
  /* Transform-only updates stay on the compositor. The fill is a full-width
   * clip window scaled to the ratio; the river inside is counter-scaled so
   * its star-dust never squashes (matching CSS in player.css). */
  nodes.progressFill.style.transform = `scaleX(${clamped})`;
  nodes.progressRiver.style.transform = clamped > 0.0001 ? `scaleX(${1 / clamped})` : "scaleX(1)";
  /* Keep the knot (13px star) inside the track at both extremes. The wrap
   * spans the track, so the translateX percentage is track-relative. */
  nodes.knotWrap.style.transform = `translateX(clamp(6.5px, ${percent}, calc(100% - 6.5px)))`;
  nodes.progressTrack.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
}

/* ------------------------------- about view ------------------------------ */

/* The numbers count up the first time the view opens; after that (and under
 * reduced motion) they just show the value. */
let aboutHasCounted = false;

/* The concert SVG (~200 lines) lives in its own asset instead of bloating
 * index.html; it is fetched once, on the first About visit. Injected inline
 * (not <img>) because the page stylesheets animate groups inside it.
 * no-cache = cheap ETag revalidation, so edits ship without a ?v= stamp. */
let chibiLoaded = false;

async function injectChibi() {
  if (chibiLoaded) return;
  chibiLoaded = true;
  try {
    const response = await fetch("./assets/chibi-concert.svg", { cache: "no-cache" });
    if (!response.ok) throw new Error(String(response.status));
    const markup = await response.text();
    document.querySelector(".chibi-stage")?.insertAdjacentHTML("afterbegin", markup);
  } catch {
    chibiLoaded = false; // retry on the next About visit
  }
}

/* The liked stat's caption talks back — zero likes doesn't get to pass
 * without comment, and enough of them earns the fan-name title. */
function likedStatLabel(count) {
  if (count === 0) return "songs liked… they're all so good though?";
  if (count < 10) return "songs liked — finally, some taste";
  if (count < 30) return "songs liked — okay, you get it";
  return "songs liked — real Butter Cookie";
}

function renderAbout() {
  injectChibi();
  nodes.aboutLikedLabel.textContent = likedStatLabel(state.playlists.liked.length);
  /* Count videos, not source titles — two VODs can share a stream title. */
  const streams = new Set(state.tracks.map((track) => track.videoId)).size;
  const hours = Math.round(state.tracks.reduce((sum, track) => sum + (track.duration || 0), 0) / 3600);
  const stats = [
    [nodes.aboutMoments, state.tracks.length],
    [nodes.aboutStreams, streams],
    [nodes.aboutHours, hours],
    [nodes.aboutLiked, state.playlists.liked.length]
  ];
  const animate = !aboutHasCounted
    && state.dataStatus !== "loading"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  stats.forEach(([node, value]) => {
    if (animate) countUp(node, value);
    else node.textContent = String(value);
  });
  if (state.dataStatus !== "loading") aboutHasCounted = true;
}

function countUp(node, target, duration = 900) {
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = String(Math.round(target * eased));
    if (progress < 1) window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

export function renderActiveView() {
  if (state.activeView === "radio") {
    renderHero();
  } else if (state.activeView === "library") {
    renderLibrary();
  } else if (state.activeView === "about") {
    renderAbout();
  }
}

export function renderAll() {
  renderPlaylistNav();
  renderActiveView();
  /* The queue lives in the now-playing panel, outside any view. */
  renderUpNext();
  renderPlayer();
  renderBanner();
}
