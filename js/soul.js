/* The corners nobody asked for: one-time milestone copy, a tab title that
 * knows what's playing, the two days a year worth celebrating, and a hello
 * for whoever opens devtools. Nothing here is load-bearing — this module is
 * the part of the site that notices. */

import { currentTrack, isPlaying } from "./state.js";
import { showToast } from "./toast.js";

/* ------------------------------- milestones ------------------------------ */

const MILESTONES_KEY = "shiitunes.milestones.v1";

function seenMilestones() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(MILESTONES_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function markMilestones(ids) {
  try {
    window.localStorage.setItem(
      MILESTONES_KEY,
      JSON.stringify([...new Set([...seenMilestones(), ...ids])])
    );
  } catch {
    /* Private-mode storage failures only cost a repeat celebration. */
  }
}

/* One-time copy for a one-time moment. Returns null when nothing special
 * happened — the caller falls back to its everyday toast. Highest tier wins,
 * and every lower tier is retired with it so nobody's 100th like is greeted
 * as their first. */
export function likeMilestone(likedCount, totalTracks) {
  const tiers = [
    totalTracks > 0 && likedCount >= totalTracks
      && { id: "liked-all", message: `Every single song liked — all ${totalTracks}. Shiina would be proud ✦` },
    likedCount >= 100 && { id: "liked-100", message: "100 liked songs — that's a whole galaxy now ✦" },
    likedCount >= 25 && { id: "liked-25", message: "25 liked songs — a proper constellation ✦" },
    likedCount >= 1 && { id: "liked-1", message: "First star charted ✦ It'll wait in Liked Songs" }
  ].filter(Boolean);
  const seen = seenMilestones();
  const hit = tiers.find((tier) => !seen.includes(tier.id));
  if (!hit) return null;
  markMilestones(tiers.map((tier) => tier.id));
  return hit.message;
}

export function firstPlaylistMilestone(customCount) {
  if (customCount !== 1 || seenMilestones().includes("playlist-1")) return false;
  markMilestones(["playlist-1"]);
  return true;
}

/* ----------------------------- tab title + icon --------------------------- */

/* The favicon star gains a sparkle while a song plays, so the tab can be
 * found by eye in a crowded tab bar. */
const LIVE_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23ffc53d' d='M12 4l2.3 5.7 6.1.5-4.7 4 1.5 6-5.2-3.2-5.2 3.2 1.5-6-4.7-4 6.1-.5L12 4z'/%3E%3Cpath fill='%23fff3d6' d='M19.2 1.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9.9-2z'/%3E%3C/svg%3E";

let baseTitle = null;
let baseFavicon = null;

export function syncTabTitle() {
  const iconLink = document.querySelector('link[rel="icon"]');
  if (baseTitle === null) {
    baseTitle = document.title;
    baseFavicon = iconLink?.href || null;
  }
  const track = isPlaying() ? currentTrack() : null;
  document.title = track ? `♪ ${track.title} — ShiiTunes` : baseTitle;
  if (iconLink && baseFavicon) iconLink.href = track ? LIVE_FAVICON : baseFavicon;
}

/* ------------------------------- calendar -------------------------------- */

const DEBUT_YEAR = 2022;

function todaysCelebration(now = new Date()) {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  /* July 7: her birthday falls on Tanabata — the star festival. Of course
   * the Milky Way girl was born on the one day the stars get to meet. */
  if (month === 7 && day === 7) {
    return { id: "birthday", message: "Happy birthday, Shiina! 🎂 Born on Tanabata, of course." };
  }
  if (month === 7 && day === 9) {
    const years = now.getFullYear() - DEBUT_YEAR;
    return { id: "debut", message: `On this day in ${DEBUT_YEAR}, Shiina debuted — ${years} ${years === 1 ? "year" : "years"} of songs ✦` };
  }
  return null;
}

const CELEBRATED_KEY = "shiitunes.celebrated.v1";

/* Marks the shell so CSS can dress up, and toasts once per day per year —
 * the second visit of the day doesn't need telling twice. */
export function applyCelebration(now = new Date()) {
  const today = todaysCelebration(now);
  if (!today) return;
  document.body.dataset.celebration = today.id;
  const stamp = `${today.id}:${now.getFullYear()}`;
  try {
    if (window.localStorage.getItem(CELEBRATED_KEY) === stamp) return;
    window.localStorage.setItem(CELEBRATED_KEY, stamp);
  } catch {
    /* No storage — celebrate every visit. There are worse failure modes. */
  }
  showToast(today.message, { celebrate: true });
}

/* -------------------------------- devtools -------------------------------- */

/* Anyone opening the console on a fan site is a future contributor. */
export function greetConsole() {
  console.log(
    "%c✦%c ShiiTunes — hello, stargazer.\n"
      + "Every timestamp here was found, timed, and titled by hand, by fans.\n"
      + "Spot a wrong title or a missing song? → https://twitter.com/gegrgtezrze\n"
      + "No trackers, no analytics — your likes never leave this browser.",
    "color:#ffc53d;font-size:24px;text-shadow:0 0 8px rgba(255,197,61,0.5)",
    "color:inherit;font-size:12px;line-height:1.7"
  );
}
