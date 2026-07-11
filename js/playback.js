/* Playback orchestration: select/play/skip/shuffle/repeat, the YouTube event
 * handlers, Media Session mirroring, panel visibility, and volume. Knows
 * nothing about likes/playlists — that lives in collections.js. */

import {
  REPEAT_MODES, currentTrack, isEmbedBlocked, isPlaying, markEmbedBlocked,
  setPlayerStatus, state
} from "./state.js";
import { categoryStationId, contextTrackIds, rebuildPlayOrder } from "./queue.js";
import {
  configurePlayer, cueIfLoaded, forgetLoadedTrack, isPlaybackStable, pausePlayback,
  playTrack, playedSeconds, seekWithin, setPlayerVolume
} from "./player.js";
import {
  nodes, performerLabel, renderHero, renderLibrary, renderPlayer,
  renderPlayerState, renderUpNext, setProgressRatio, syncPanelToggleButton,
  updateLibraryActiveRow, updateProgress
} from "./render.js";
import { shootStarAcross } from "./components.js";
import { showToast } from "./toast.js";
import { navigate } from "./router.js";

const PREV_RESTART_SECONDS = 3;
const ERROR_SKIP_DELAY_MS = 1500;
const VOLUME_STORAGE_KEY = "shiitunes.volume.v1";

export function selectTrack(trackId, { play = true, setContext, ephemeral = false } = {}) {
  const track = state.trackById.get(trackId);
  if (!track) return;
  /* Ephemeral = a hand-queued track: it plays as a detour without touching
   * the context or play order, which resume afterwards (queueResumeId). */
  if (!ephemeral) {
    let shouldRebuild = false;
    if (setContext !== undefined && setContext !== state.playContext) {
      state.playContext = setContext;
      shouldRebuild = true;
    }
    const contextIds = state.playContext ? contextTrackIds(state.playContext) : null;
    if (state.playContext && (!contextIds || !contextIds.includes(trackId))) {
      state.playContext = null;
      shouldRebuild = true;
    }
    state.currentId = trackId;
    state.queueResumeId = null; // picking a song directly ends any detour
    if (shouldRebuild || !state.playOrder.includes(trackId)) {
      rebuildPlayOrder();
    }
  } else {
    /* The queued track may well also sit somewhere in the ambient order, so
     * a set queueResumeId — not playOrder membership — is what marks the
     * detour; only the first of consecutive queued tracks records it. */
    if (!state.queueResumeId) state.queueResumeId = state.currentId;
    state.currentId = trackId;
  }
  renderHero();
  renderPlayer();
  renderUpNext();
  updateLibraryActiveRow();
  updateMediaSession(track);
  preloadUpcomingArt();
  if (!play) {
    /* Keep a warm player in step with the selection (see cueIfLoaded). The
     * cue resets playback, so a stale "loading"/"playing" status would lie. */
    if (cueIfLoaded(track) && state.playerStatus !== "idle") {
      setPlayerStatus("paused");
      renderPlayerState();
      updateProgress({ elapsed: 0, duration: track.duration || null });
    }
    return;
  }
  playCurrent();
}

/* The YouTube iframe can't buffer a second video ahead of time, but the
 * upcoming tracks' artwork can sit in the HTTP cache before it's needed —
 * the hero, player bar, and queue then swap covers instantly on advance. */
function preloadUpcomingArt() {
  const order = state.playOrder;
  const index = order.indexOf(state.currentId);
  if (index === -1) return;
  /* A hand-queued track, when present, is the real "next". */
  const queuedNext = state.manualQueue.length ? state.trackById.get(state.manualQueue[0]) : null;
  const next = queuedNext || state.trackById.get(order[(index + 1) % order.length]);
  const after = state.trackById.get(order[(index + 2) % order.length]);
  if (next) {
    new Image().src = next.thumbnailSmall; // rows, queue, player, hero backdrop
    new Image().src = next.thumbnailLarge; // the hero art's preferred size
  }
  if (after) new Image().src = after.thumbnailSmall;
}

export async function playCurrent() {
  const track = currentTrack();
  if (!track) return;

  /* Embed-blocked tracks never auto-open tabs; Play moves on to a playable
   * moment and the hero keeps a visible "Open YouTube" affordance. */
  if (isEmbedBlocked(track.id)) {
    setPlayerStatus("error");
    renderHero();
    showToast("This one only plays on YouTube — skipping to a playable song");
    skipToPlayable(1);
    return;
  }

  revealVideo();
  setPlayerStatus("loading");
  renderPlayerState();

  const started = await playTrack(track);
  if (!started) {
    setPlayerStatus("error");
    renderPlayerState();
    showToast("Player unavailable — use Open YouTube", { error: true });
  }
}

function pauseCurrent() {
  setPlayerStatus("paused");
  pausePlayback();
  renderPlayerState();
}

export function togglePlayback() {
  if (state.playerStatus === "playing" || state.playerStatus === "loading") pauseCurrent();
  else playCurrent();
}

function skipToPlayable(step, { play = true } = {}) {
  moveBy(step, { play, allowCurrent: false });
}

/* ------------------------------ manual queue ----------------------------- */

export function queueNext(track) {
  state.manualQueue.unshift(track.id);
  renderUpNext();
  showToast("Playing next");
}

export function queueLast(track) {
  state.manualQueue.push(track.id);
  renderUpNext();
  showToast("Added to queue");
}

export function removeQueuedAt(index) {
  state.manualQueue.splice(index, 1);
  renderUpNext();
  showToast("Removed from queue");
}

/* Clicking a queued card plays it immediately and consumes that entry. */
export function playQueuedAt(index) {
  const [id] = state.manualQueue.splice(index, 1);
  if (!id || !state.trackById.has(id)) {
    renderUpNext();
    return;
  }
  selectTrack(id, { play: true, ephemeral: true });
}

/* Skipping forward drains the hand-picked queue before the ambient order. */
function playFromManualQueue(play) {
  while (state.manualQueue.length) {
    const id = state.manualQueue.shift();
    if (!state.trackById.has(id) || isEmbedBlocked(id)) continue;
    selectTrack(id, { play, ephemeral: true });
    return true;
  }
  return false;
}

/* Skipping keeps the listening intent: playing OR still loading means the
 * person was about to hear something, so the next track should play too.
 * Only a genuinely paused/idle player skips silently. */
export function moveBy(delta, {
  play = isPlaying() || state.playerStatus === "loading",
  allowCurrent = true
} = {}) {
  if (delta > 0 && playFromManualQueue(play)) return;
  if (!state.playOrder.length) return;
  const length = state.playOrder.length;
  const step = delta < 0 ? -1 : 1;
  /* If a hand-queued track is playing, continue from where the ambient
   * order was interrupted rather than from the queued track's own slot. */
  let index = Math.max(0, state.playOrder.indexOf(state.queueResumeId ?? state.currentId));
  state.queueResumeId = null;
  for (let tries = 0; tries < length; tries += 1) {
    index = (index + step + length) % length;
    const candidateId = state.playOrder[index];
    if (!allowCurrent && candidateId === state.currentId) continue;
    if (candidateId && !isEmbedBlocked(candidateId)) {
      selectTrack(candidateId, { play });
      return;
    }
  }
  showToast("No playable tracks — try Open YouTube", { error: true });
}

/* Coming to rest after ENDED. Forgetting the loaded track matters: playVideo
 * on an ENDED player replays without re-arming endSeconds (the same hazard
 * the repeat-one branch documents), so a later Play press could run past the
 * moment into the rest of the VOD. A forgotten track forces playTrack down
 * the fresh loadVideoById path, start and end intact. */
function stopAtEnd() {
  forgetLoadedTrack();
  setPlayerStatus("idle");
  renderPlayerState();
}

/* The YT ENDED event is the single auto-advance trigger. */
function advanceAfterEnd() {
  /* "Stop after this song" wins over every advance path. */
  if (sleepSetting === "song") {
    sleepSetting = "off";
    syncSleepButton();
    stopAtEnd();
    showToast("Sleep timer — good night");
    return;
  }
  const index = state.playOrder.indexOf(state.queueResumeId ?? state.currentId);
  const isLast = index === state.playOrder.length - 1;
  if (isLast && state.repeat === "off" && !state.manualQueue.length) {
    stopAtEnd();
    renderUpNext();
    return;
  }
  moveBy(1, { play: true });
}

export function handlePrev() {
  /* getCurrentTime() briefly still reports the outgoing track's position
   * right after a skip (worst when the next track shares a videoId — an
   * in-place seek, not a reload). Trusting playedSeconds() in that window
   * could read a stale "well into the song" value for a track that just
   * started, turning a second consecutive Previous press into "restart the
   * current song" instead of "go back a track". Treat not-yet-stable the
   * same as "just started" — go back. */
  if (isPlaybackStable() && playedSeconds() > PREV_RESTART_SECONDS) {
    seekWithin(0);
    return;
  }
  moveBy(-1);
}

/* One-gesture radio: shuffle a context (everything, or one category station)
 * and start playing. */
function startShuffleContext(context, toastMessage) {
  if (!state.tracks.length) return;
  const previousContext = state.playContext;
  const previousId = state.currentId;
  const previousShuffle = state.shuffle;
  state.shuffle = true;
  state.playContext = context;
  state.currentId = null;
  rebuildPlayOrder();
  const firstPlayable = state.playOrder.find((id) => !isEmbedBlocked(id));
  if (!firstPlayable) {
    /* Full rollback: a nulled currentId would leave the shown track's play
     * button a silent no-op, and a stuck-on shuffle would quietly reorder
     * the old queue. */
    state.playContext = previousContext;
    state.currentId = previousId;
    state.shuffle = previousShuffle;
    rebuildPlayOrder();
    renderPlayerState();
    showToast("No playable tracks — try Open YouTube", { error: true });
    return;
  }
  navigate("radio");
  selectTrack(firstPlayable, { play: true });
  showToast(toastMessage);
}

export function shuffleAllAndPlay() {
  startShuffleContext(null, "Shuffling all songs");
}

export function startStation(category, label) {
  startShuffleContext(categoryStationId(category), `Tuned to the ${label} station`);
}

export function toggleShuffle() {
  state.shuffle = !state.shuffle;
  rebuildPlayOrder();
  renderPlayerState();
  renderUpNext();
  showToast(state.shuffle ? "Shuffle on" : "Shuffle off");
}

export function cycleRepeat() {
  const next = REPEAT_MODES[(REPEAT_MODES.indexOf(state.repeat) + 1) % REPEAT_MODES.length];
  state.repeat = next;
  renderPlayerState();
  renderUpNext();
  showToast(next === "off" ? "Repeat off" : next === "all" ? "Repeat all" : "Repeat one");
}

/* --------------------------- player event handlers ------------------------ */

/* Lock-screen / notification / hardware-key controls mirror the radio. */
function updateMediaSession(track) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = track
    ? new MediaMetadata({
        title: track.title,
        artist: performerLabel(track),
        album: "ShiiTunes",
        artwork: [{ src: track.thumbnail, sizes: "480x360", type: "image/jpeg" }]
      })
    : null;
}

export function bindMediaSession() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.setActionHandler("play", () => playCurrent());
  navigator.mediaSession.setActionHandler("pause", () => pauseCurrent());
  navigator.mediaSession.setActionHandler("previoustrack", () => handlePrev());
  navigator.mediaSession.setActionHandler("nexttrack", () => moveBy(1));
}

configurePlayer({
  onStatus(status) {
    setPlayerStatus(status);
    renderPlayerState();
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = status === "playing" ? "playing" : "paused";
    }
  },
  onEnded({ cappedStop }) {
    setProgressRatio(1);
    shootStarAcross(nodes.progressTrack);
    if (state.repeat === "one") {
      forgetLoadedTrack(); // force a fresh load so endSeconds re-arms
      playCurrent();
      return;
    }
    if (cappedStop) showToast("Moment end unknown — playing the next one");
    advanceAfterEnd();
  },
  onBlocked({ trackId, code }) {
    markEmbedBlocked(trackId || state.currentId);
    const wasActive = state.playerStatus === "playing" || state.playerStatus === "loading";
    const blockedId = state.currentId;
    const reason = code === 101 || code === 150
      ? "This VOD doesn't allow embedding"
      : code === 100
        ? "This video is unavailable"
        : code === 153
          ? "YouTube needs a valid referrer"
          : "YouTube playback failed";

    setPlayerStatus("error");
    renderHero();
    renderPlayer();
    if (state.activeView === "library") renderLibrary();

    if (wasActive) {
      showToast(`${reason} — skipping`, { error: true });
      window.setTimeout(() => {
        if (state.currentId === blockedId && state.playerStatus !== "paused") skipToPlayable(1);
      }, ERROR_SKIP_DELAY_MS);
    } else {
      showToast(`${reason} — use Open YouTube`, { error: true });
    }
  },
  onProgress(progress) {
    updateProgress(progress);
  }
});

/* ---------------------------- now-playing panel --------------------------- */

/* Once real playback exists, the panel swaps its placeholder for the video.
 * A user-hidden panel stays hidden — Spotify-style, playback keeps going and
 * the player-bar toggle brings it back. */
export function revealVideo() {
  nodes.nowPanel.classList.add("has-video");
  if (!state.panelDismissed) nodes.nowPanel.hidden = false;
}

/* Player-bar toggle: fold the right column away or bring it back. Hiding is
 * display-only — the iframe stays in the DOM, so playback never restarts. */
export function toggleNowPanel() {
  state.panelDismissed = !state.panelDismissed;
  nodes.nowPanel.hidden = state.panelDismissed;
  syncPanelToggleButton();
}

/* Mobile-only chrome: the floating mini-video grows into an info sheet. The
 * class is breakpoint-scoped in CSS, so it is inert on desktop. */
export function togglePanelSize() {
  const expanded = nodes.nowPanel.classList.toggle("is-sheet");
  nodes.panelToggleBtn.setAttribute("aria-expanded", String(expanded));
  nodes.panelToggleBtn.setAttribute("aria-label", expanded ? "Minimize video panel" : "Expand video panel");
}

/* ---------------------------------- volume -------------------------------- */

export function savedVolume() {
  const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
  if (raw === null) return 100;
  const volume = Number(raw);
  return Number.isFinite(volume) && volume >= 0 && volume <= 100 ? volume : 100;
}

export function applyVolume(volume) {
  setPlayerVolume(volume);
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
  } catch {
    /* Private-mode storage failures only cost persistence. */
  }
  syncMuteButton();
}

/* Mute rides the volume slider (the YT iframe has no separate mute state we
 * can trust across loads): 0 = muted, unmute restores the last audible level. */
let lastAudibleVolume = 100;

export function toggleMute() {
  const current = Number(nodes.volumeSlider.value);
  if (current > 0) {
    lastAudibleVolume = current;
    nodes.volumeSlider.value = "0";
    applyVolume(0);
  } else {
    const restore = lastAudibleVolume || 100;
    nodes.volumeSlider.value = String(restore);
    applyVolume(restore);
  }
}

export function syncMuteButton() {
  const muted = Number(nodes.volumeSlider.value) === 0;
  nodes.muteBtn.setAttribute("aria-pressed", String(muted));
  nodes.muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
  nodes.muteBtn.classList.toggle("active", muted);
  nodes.muteBtn.querySelector("use").setAttribute("href", muted ? "#icon-volume-mute" : "#icon-volume");
}

/* ------------------------------- sleep timer ------------------------------ */

/* "off" | "song" | minutes (number). Session-only, like the manual queue. */
let sleepSetting = "off";
let sleepTimeoutHandle = null;

export function sleepChoice() {
  return sleepSetting;
}

function syncSleepButton() {
  const active = sleepSetting !== "off";
  nodes.sleepBtn.classList.toggle("active", active);
  nodes.sleepBtn.setAttribute("aria-pressed", String(active));
  nodes.sleepBtn.setAttribute(
    "aria-label",
    active
      ? `Sleep timer on (${sleepSetting === "song" ? "stops after this song" : `${sleepSetting} minutes`})`
      : "Sleep timer"
  );
}

export function setSleepTimer(option) {
  if (sleepTimeoutHandle) window.clearTimeout(sleepTimeoutHandle);
  sleepTimeoutHandle = null;
  sleepSetting = option;
  syncSleepButton();
  if (option === "off") {
    showToast("Sleep timer off");
  } else if (option === "song") {
    showToast("Stopping after this song");
  } else {
    sleepTimeoutHandle = window.setTimeout(() => {
      sleepTimeoutHandle = null;
      sleepSetting = "off";
      pauseCurrent();
      syncSleepButton();
      showToast("Sleep timer — good night");
    }, option * 60000);
    showToast(`Stopping in ${option} minutes`);
  }
}
