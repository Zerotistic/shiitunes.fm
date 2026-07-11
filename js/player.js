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
let loadedAt = 0;
let desiredVolume = null;
/* Bumped by anything that supersedes an in-flight playTrack() — a pause, a
 * newer play/cue request. playTrack() reads this back after its `await` and
 * bails if it's no longer current, instead of blindly issuing loadVideoById/
 * playVideo on a request the user has already moved on from (e.g. hitting
 * Pause while a slow/cold-boot load is still in flight — the pause would
 * otherwise land first and then get silently overridden once the stale
 * playTrack() finally resolves and autoplays anyway). */
let playToken = 0;
/* A play intent not yet confirmed by a PLAYING event. If the player comes to
 * rest CUED instead (an autoplay attempt the browser swallowed), one nudge
 * gets it moving — see handlePlayerState. */
let pendingPlay = false;

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

function ensureYouTubeIframe(track, { autoplay = false } = {}) {
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
  if (track) {
    const request = playbackRequest(track);
    if (request.startSeconds) params.set("start", String(request.startSeconds));
    if (request.endSeconds) params.set("end", String(Math.ceil(request.endSeconds)));
  }
  if (autoplay) params.set("autoplay", "1");
  /* Privacy-enhanced host: no YouTube cookies until playback starts. */
  iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
  existing?.replaceWith(iframe);
  return iframe;
}

export function isPlayerBooted() {
  return apiPromise !== null;
}

function loadYouTubeApi(track, { autoplay = false } = {}) {
  if (apiPromise) return apiPromise;

  /* The iframe is created NOW, synchronously inside the user's gesture, not
   * after the API script arrives. When the boot carries a play intent, the
   * src's autoplay=1 (plus start/end) lets the embed start itself the moment
   * it loads — a later postMessage play command would run after the click's
   * activation expired, and browsers swallow it. That was the "first play of
   * a visit needs pause-then-play" bug. */
  ensureYouTubeIframe(track, { autoplay });
  const bootTrack = track || null;

  apiPromise = new Promise((resolve, reject) => {
    const buildPlayer = () => {
      ytPlayer = new YT.Player("youtubePlayer", {
        events: {
          onReady: () => {
            ytReady = true;
            /* The boot video is baked into the iframe src — record it so the
             * awaiting caller takes the playVideo/skip path, not a redundant
             * loadVideoById that would restart the load. */
            if (bootTrack) {
              loadedTrack = bootTrack;
              loadedAt = Date.now();
            }
            tagYouTubeIframe();
            disableCaptions();
            if (desiredVolume !== null) ytPlayer.setVolume(desiredVolume);
            /* An autoplay boot can already be PLAYING before the API attaches
             * — the transition event is gone, so replay it. */
            if (window.YT?.PlayerState && ytPlayer.getPlayerState?.() === YT.PlayerState.PLAYING) {
              handlePlayerState(YT.PlayerState.PLAYING);
            }
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
    pendingPlay = false;
    disableCaptions();
    startProgressTimer();
    handlers.onStatus("playing");
  }
  /* Coming to rest CUED while a play was asked for = the browser blocked the
   * autoplay attempt. One nudge; if that's blocked too, the next real press
   * lands on a ready player and works. */
  if (playerState === YT.PlayerState.CUED && pendingPlay) {
    pendingPlay = false;
    if (typeof ytPlayer?.playVideo === "function") ytPlayer.playVideo();
  }
  if (playerState === YT.PlayerState.PAUSED) {
    pendingPlay = false;
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
  /* A timer from the outgoing track can still be ticking here (only ENDED/
   * PAUSED stop it) — left running, it fires mid-load with the reassigned
   * loadedTrack below but getCurrentTime() still on the old video, reads a
   * huge bogus elapsed, and end-guards the new track before it even starts.
   * That was the "skip lands, then instantly skips again" bug. */
  stopProgressTimer();
  const token = (playToken += 1);
  try {
    pendingPlay = true;
    const player = await loadYouTubeApi(track, { autoplay: true });
    /* Superseded while awaiting the API (e.g. the user paused, or skipped
     * again, before this request's load ever landed) — do not resurrect it. */
    if (token !== playToken) return false;
    if (loadedTrack?.id !== track.id) {
      loadedTrack = track;
      loadedAt = Date.now();
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
  playToken += 1; // supersede any in-flight playTrack — cueing means "don't play"
  try {
    pendingPlay = false;
    const player = await loadYouTubeApi(track);
    /* A boot for this same track already sits cued in the iframe src —
     * re-cueing would just refetch it. */
    if (loadedTrack?.id !== track.id) {
      loadedTrack = track;
      loadedAt = Date.now();
      player.cueVideoById(request);
    }
    return true;
  } catch {
    return false;
  }
}

/* Selecting a track without playing (skip while paused) must still reach the
 * player, or it keeps holding the previous video: the pane shows the wrong
 * frame, and the next Play press goes through loadVideoById — which some
 * platforms (iOS in particular) load without starting when the player sat
 * paused. Cueing here means that Play press hits the reliable playVideo()
 * path instead. Never boots the API: a cold player has nothing stale to fix.
 * Returns true when it re-cued. */
export function cueIfLoaded(track) {
  if (!ytPlayer || !ytReady || !loadedTrack || loadedTrack.id === track.id) return false;
  if (typeof ytPlayer.cueVideoById !== "function") return false;
  playToken += 1; // supersede any in-flight playTrack — cueing means "don't play"
  stopProgressTimer();
  loadedTrack = track;
  loadedAt = Date.now();
  ytPlayer.cueVideoById(playbackRequest(track));
  return true;
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
  /* Supersede any in-flight playTrack() — without this, pausing during a
   * slow/cold-boot load (playerStatus "loading") could get silently
   * overridden once that stale request finally resolves and autoplays. */
  playToken += 1;
  pendingPlay = false;
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

/* False for a beat after any load — see END_GUARD_ARM_DELAY_MS below.
 * getCurrentTime() (and so playedSeconds()) can't be trusted in that window,
 * so callers that make decisions off playedSeconds() (restart-vs-previous,
 * arrow-key seeking) should treat "not armed" as "nothing reliable to read
 * yet" rather than acting on a stale number. */
export function isPlaybackStable() {
  return Date.now() - loadedAt > END_GUARD_ARM_DELAY_MS;
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

/* Right after loadVideoById/cueVideoById, getCurrentTime() can keep
 * reporting the OUTGOING video's position for a few hundred ms while the
 * seek catches up — worst when back-to-back tracks share the same videoId
 * (multiple singing moments cut from one VOD) and the player just seeks in
 * place instead of doing a full reload. If a timer tick lands in that
 * window, elapsed is computed against the stale position and the new
 * track's (often much shorter) duration, blows past it instantly, and the
 * guard below fires a phantom skip. Holding the guard off for a beat after
 * every load gives getCurrentTime() time to catch up to the real seek. */
const END_GUARD_ARM_DELAY_MS = 1500;

/* checkEnd only on live timer ticks. Seeks (and drags, and seeks while
 * paused) also emit — if those ran the guard, scrubbing near the end of a
 * song would fire onEnded and auto-advance: a phantom skip. */
function emitProgress({ checkEnd = false } = {}) {
  if (!loadedTrack) return;
  const elapsed = playedSeconds();
  const duration = loadedTrack.duration || null;
  const armed = Date.now() - loadedAt > END_GUARD_ARM_DELAY_MS;
  if (checkEnd && armed && duration && elapsed > duration + END_GUARD_SLACK_SECONDS) {
    stopProgressTimer();
    handlers.onEnded({ cappedStop: false });
    return;
  }
  handlers.onProgress({ elapsed, duration });
}
