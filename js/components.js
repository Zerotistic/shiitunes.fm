/* Reusable DOM builders. */

import { cleanText, hashCode } from "./utils.js";

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.appendChild(use);
  return svg;
}

/* Hero covers try the sharp maxres thumbnail first, then step down to
 * hqdefault, then to the celestial fallback art. Small covers go straight to
 * hqdefault. */
export function createCover(track, size = "row") {
  const wrap = document.createElement("span");
  wrap.className = `cover-wrap cover-${size}`;

  /* Small covers render at 44-56px — mqdefault (320w) is already 3x their
   * needs, and it's 16:9 like the VODs, so the square crop never catches
   * hqdefault's 4:3 letterbox bars. hqdefault stays as the fallback. */
  const sources = size === "hero"
    ? [track.thumbnailLarge, track.thumbnail]
    : [track.thumbnailSmall, track.thumbnail];
  const image = document.createElement("img");
  image.className = "cover-art";
  image.alt = "";
  /* The hero art is usually the page's LCP element and already sits at the
   * end of a JS → data → render chain — don't also lazy-load it. */
  image.loading = size === "hero" ? "eager" : "lazy";
  if (size === "hero") image.setAttribute("fetchpriority", "high");
  image.decoding = "async";

  let sourceIndex = 0;
  image.src = sources[sourceIndex];
  image.addEventListener("error", function stepDown() {
    sourceIndex += 1;
    if (sourceIndex < sources.length) {
      image.src = sources[sourceIndex];
      return;
    }
    image.removeEventListener("error", stepDown);
    image.replaceWith(createFallbackCover(track));
  });
  /* YouTube serves a 120x90 grey placeholder instead of 404 for some missing
   * maxres thumbnails — treat that as a miss too. */
  if (sources.length > 1) {
    image.addEventListener("load", () => {
      if (image.naturalWidth <= 120 && sourceIndex === 0) {
        sourceIndex = 1;
        image.src = sources[sourceIndex];
      }
    });
  }
  wrap.appendChild(image);
  return wrap;
}

function createFallbackCover(track) {
  const fallback = document.createElement("span");
  fallback.className = "cover-art fallback-cover";
  /* Seeded star-field variation so identical songs still look distinct. */
  fallback.dataset.variant = String(hashCode(track.id) % 4);
  /* Untitled songs get the star glyph — a letter would read as a title
   * initial the track doesn't have. Spread, not [0]: indexing a title that
   * starts with an emoji would split the surrogate pair into mojibake. */
  const first = track.untitled ? "" : [...cleanText(track.title)][0];
  fallback.textContent = first ? first.toUpperCase() : "✶";
  return fallback;
}

/* Small hearts-and-stars burst from the tapped like button. Pure decoration:
 * skipped entirely for reduced-motion users, self-removing. */
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function burstHearts(anchor) {
  if (reducedMotion.matches || !anchor?.isConnected) return;
  const rect = anchor.getBoundingClientRect();
  const burst = document.createElement("span");
  burst.className = "heart-burst";
  burst.setAttribute("aria-hidden", "true");
  burst.style.left = `${rect.left + rect.width / 2}px`;
  burst.style.top = `${rect.top + rect.height / 2}px`;

  const bits = 7;
  for (let index = 0; index < bits; index += 1) {
    const bit = document.createElement("span");
    bit.className = "heart-burst-bit";
    bit.textContent = index % 3 === 0 ? "✶" : "♥";
    const angle = (Math.PI * 2 * index) / bits + Math.random() * 0.7;
    const distance = 20 + Math.random() * 18;
    bit.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    bit.style.setProperty("--dy", `${Math.sin(angle) * distance - 8}px`);
    bit.style.setProperty("--spin", `${Math.random() * 80 - 40}deg`);
    burst.appendChild(bit);
  }
  document.body.appendChild(burst);
  window.setTimeout(() => burst.remove(), 700);
}

/* A tiny shooting star streaks the full seek bar — fired when a song ends and
 * the next one loads. */
export function shootStarAcross(track) {
  if (reducedMotion.matches || !track) return;
  const star = document.createElement("span");
  star.className = "shooting-star";
  star.setAttribute("aria-hidden", "true");
  star.style.setProperty("--shoot-distance", `${track.offsetWidth + 72}px`);
  star.addEventListener("animationend", () => star.remove());
  track.appendChild(star);
}

/* Liking a song flicks one extra star into the heavenly river: it drops in,
 * bounces to a twinkle, and fades back into the dust. */
export function dropRiverStar(track) {
  if (reducedMotion.matches || !track) return;
  const star = document.createElement("span");
  star.className = "river-star";
  star.setAttribute("aria-hidden", "true");
  star.style.left = `${8 + Math.random() * 80}%`;
  star.addEventListener("animationend", () => star.remove());
  track.appendChild(star);
}

/* Inline "type the name right here" form — used by the sidebar playlist
 * draft and the track menu's New playlist row instead of a modal prompt.
 * Enter (or blur with text) commits; Escape or an empty blur cancels; an
 * empty Enter shakes and keeps focus so nothing is created silently. */
export function inlineNameForm({ placeholder, value = "", onSubmit, onCancel }) {
  const form = document.createElement("form");
  form.className = "inline-name-form";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 40;
  input.placeholder = placeholder;
  input.value = value;
  input.autocomplete = "off";
  input.setAttribute("aria-label", placeholder);
  form.appendChild(input);

  let settled = false;
  const settle = (fn, value) => {
    if (settled) return;
    settled = true;
    fn(value);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) {
      form.classList.remove("invalid");
      void form.offsetWidth; // restart the shake animation
      form.classList.add("invalid");
      input.focus();
      return;
    }
    settle(onSubmit, name);
  });
  /* Menus arrow-navigate on keydown — typing must stay in the input. */
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      settle(onCancel);
    }
  });
  /* Deferred: when submit/removal caused the blur, settled/isConnected
   * flips before this runs and the cancel is skipped. */
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (settled || !form.isConnected) return;
      const name = input.value.trim();
      if (name) settle(onSubmit, name);
      else settle(onCancel);
    }, 120);
  });
  return form;
}

export function emptyState(titleText, bodyText) {
  const box = document.createElement("div");
  box.className = "empty-state";
  const title = document.createElement("strong");
  title.textContent = titleText;
  const body = document.createElement("span");
  body.textContent = bodyText;
  box.append(title, body);
  return box;
}

export function skeletonRows(count) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const row = document.createElement("div");
    row.className = "skeleton-row";
    row.setAttribute("aria-hidden", "true");
    const art = document.createElement("span");
    art.className = "skeleton-block skeleton-art";
    const lines = document.createElement("span");
    lines.className = "skeleton-lines";
    const lineA = document.createElement("span");
    lineA.className = "skeleton-block skeleton-line";
    const lineB = document.createElement("span");
    lineB.className = "skeleton-block skeleton-line short";
    lines.append(lineA, lineB);
    row.append(art, lines);
    fragment.appendChild(row);
  }
  return fragment;
}
