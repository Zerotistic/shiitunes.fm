/* YouTube IFrame API wrapper. Knows nothing about app state or rendering —
 * the app configures it with callbacks and asks it to play/cue/pause/seek.
 *
 * YT error codes: 101/150 = embedding disabled, 100 = removed/private,
 * 153 = missing Referer/API client identity, 2/5 = player/request failure. */

const PROGRESS_POLL_MS = 500;
/* Unlabeled duration on a mid-VOD moment: cap it so radio never plays the
 * rest of a multi-hour VOD. Full-video tracks (start 0) play to their end. */
const UNKNOWN_MOMENT_CAP_SECONDS = 360;

let ytPlayer = null;
let ytReady = false;
let apiPromise = null;
let progressTimer = null;
let loadedTrack = null;
let desiredVolume = null;

let handlers = {
  onStatus() {},
  onBlocked() {},
  onEnded() {},
  onProgress() {}
};

export function configurePlayer(callbacks) {
  handlers = { ...handlers, ...callbacks };
}

export function loadedTrackId() {
  return loadedTrack?.id || null;
}

export function forgetLoadedTrack() {
  loadedTrack = null;
}

function trackEndSeconds(track) {
  if (track.duration) return track.startSeconds + track.duration;
  if (track.startSeconds > 0) return track.startSeconds + UNKNOWN_MOMENT_CAP_SECONDS;
  return null;
}

function youtubeIdentityParams() {
  const params = new URLSearchParams({
    /* The app owns all transport UI — hide YouTube's control bar so hovering
     * the video doesn't stack a second set of controls over it. */
    controls: "0",
    enablejsapi: "1",
    playsinline: "1",
    rel: "0"
  });
  if (/^https?:$/.test(window.location.protocol)) {
    params.set("origin", window.location.origin);
    params.set("widget_referrer", window.location.href.split("#")[0]);
  }
  return params;
}

function tagYouTubeIframe(iframe = null) {
  if (!iframe && ytPlayer && typeof ytPlayer.getIframe === "function") {
    iframe = ytPlayer.getIframe();
  }
  if (!iframe) return;
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
  iframe.setAttribute("allowfullscreen", "");
}

function ensureYouTubeIframe(track) {
  const existing = document.getElementById("youtubePlayer");
  if (existing?.tagName === "IFRAME") {
    tagYouTubeIframe(existing);
    return existing;
  }

  const iframe = document.createElement("iframe");
  iframe.id = "youtubePlayer";
  iframe.title = "YouTube video player";
  iframe.width = "100%";
  iframe.height = "100%";
  tagYouTubeIframe(iframe);

  const videoId = encodeURIComponent(track?.videoId || "");
  const params = youtubeIdentityParams();
  if (track?.startSeconds) params.set("start", String(track.startSeconds));
  /* Privacy-enhanced host: no YouTube cookies until playback starts. */
  iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
  existing?.replaceWith(iframe);
  return iframe;
}

function loadYouTubeApi(track) {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const buildPlayer = () => {
      ensureYouTubeIframe(track);
      ytPlayer = new YT.Player("youtubePlayer", {
        events: {
          onReady: () => {
            ytReady = true;
            tagYouTubeIframe();
            disableCaptions();
            if (desiredVolume !== null) ytPlayer.setVolume(desiredVolume);
            resolve(ytPlayer);
          },
          onStateChange: (event) => handlePlayerState(event.data),
          onError: (event) => handlePlayerError(event.data)
        }
      });
    };

    if (window.YT && window.YT.Player) {
      buildPlayer();
      return;
    }

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === "function") previousReady();
      buildPlayer();
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return apiPromise;
}

/* No URL param turns captions off (cc_load_policy only forces them ON);
 * unloading the captions module is the supported API route. Each new video
 * reloads the module, so this runs again on every PLAYING transition. */
function disableCaptions() {
  try {
    ytPlayer.unloadModule("captions");
    ytPlayer.unloadModule("cc");
  } catch {
    /* Module may not exist yet — the next state change tries again. */
  }
}

function handlePlayerState(playerState) {
  if (!window.YT || !window.YT.PlayerState) return;
  if (playerState === YT.PlayerState.PLAYING) {
    disableCaptions();
    startProgressTimer();
    handlers.onStatus("playing");
  }
  if (playerState === YT.PlayerState.PAUSED) {
    stopProgressTimer();
    handlers.onStatus("paused");
  }
  if (playerState === YT.PlayerState.ENDED) {
    stopProgressTimer();
    /* A moment with an unknown end was cut by the safety cap, not finished. */
    const cappedStop = Boolean(loadedTrack && !loadedTrack.duration && loadedTrack.startSeconds > 0);
    handlers.onEnded({ cappedStop });
  }
}

function handlePlayerError(code) {
  stopProgressTimer();
  const blockedTrackId = loadedTrack?.id || null;
  loadedTrack = null;
  handlers.onBlocked({ trackId: blockedTrackId, code });
}

function playbackRequest(track) {
  const request = {
    videoId: track.videoId,
    startSeconds: track.startSeconds || 0
  };
  const end = trackEndSeconds(track);
  if (end) request.endSeconds = end;
  return request;
}

/* Resolves true when playback was handed to YouTube, false on API failure. */
export async function playTrack(track) {
  const request = playbackRequest(track);
  try {
    const player = await loadYouTubeApi(track);
    if (loadedTrack?.id !== track.id) {
      loadedTrack = track;
      player.loadVideoById(request);
    } else if (typeof player.playVideo === "function") {
      player.playVideo();
    }
    /* The PLAYING state event starts the progress timer. Starting it here,
     * while getCurrentTime() still reports the previous video's position,
     * let the end-guard read a huge bogus elapsed and skip the new track. */
    return true;
  } catch {
    return false;
  }
}

export async function cueTrack(track) {
  const request = playbackRequest(track);
  try {
    const player = await loadYouTubeApi(track);
    loadedTrack = track;
    player.cueVideoById(request);
    return true;
  } catch {
    return false;
  }
}

/* Remembered before the player exists and applied on ready, so the saved
 * volume survives page loads. The iframe API caps at 100 — no boost. */
export function setPlayerVolume(volume) {
  desiredVolume = Math.max(0, Math.min(100, Math.round(volume)));
  if (ytPlayer && ytReady && typeof ytPlayer.setVolume === "function") {
    ytPlayer.setVolume(desiredVolume);
  }
}

export function pausePlayback() {
  stopProgressTimer();
  if (ytPlayer && ytReady && typeof ytPlayer.pauseVideo === "function") {
    ytPlayer.pauseVideo();
  }
}

export function playedSeconds() {
  if (!loadedTrack || !ytPlayer || !ytReady) return 0;
  if (typeof ytPlayer.getCurrentTime !== "function") return 0;
  return Math.max(0, Number(ytPlayer.getCurrentTime() || 0) - (loadedTrack.startSeconds || 0));
}

/* Seek within the loaded moment. `commit: false` scrubs without letting the
 * player fetch ahead (used mid-drag); the pointerup seek commits. Tracks
 * without a known duration allow free forward seeking. */
export function seekWithin(seconds, { commit = true } = {}) {
  if (!loadedTrack || !ytPlayer || !ytReady) return;
  if (typeof ytPlayer.seekTo !== "function") return;
  const max = loadedTrack.duration || 0;
  const clamped = max ? Math.min(Math.max(0, seconds), max) : Math.max(0, seconds);
  ytPlayer.seekTo((loadedTrack.startSeconds || 0) + clamped, commit);
  emitProgress();
}

function startProgressTimer() {
  stopProgressTimer();
  progressTimer = window.setInterval(() => emitProgress({ checkEnd: true }), PROGRESS_POLL_MS);
  emitProgress();
}

function stopProgressTimer() {
  window.clearInterval(progressTimer);
  progressTimer = null;
}

/* The IFrame API's endSeconds has a history of being ignored (after seeks,
 * on some clients). This slack keeps a legitimate ENDED event first while
 * still catching a moment that blows past its boundary. */
const END_GUARD_SLACK_SECONDS = 2;

/* checkEnd only on live timer ticks. Seeks (and drags, and seeks while
 * paused) also emit — if those ran the guard, scrubbing near the end of a
 * song would fire onEnded and auto-advance: a phantom skip. */
function emitProgress({ checkEnd = false } = {}) {
  if (!loadedTrack) return;
  const elapsed = playedSeconds();
  const duration = loadedTrack.duration || null;
  if (checkEnd && duration && elapsed > duration + END_GUARD_SLACK_SECONDS) {
    stopProgressTimer();
    handlers.onEnded({ cappedStop: false });
    return;
  }
  handlers.onProgress({ elapsed, duration });
}
