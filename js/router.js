/* Hash routing so views are real navigation: Back/Forward work, and
 * #/library-style links are shareable on static hosting. The library view
 * takes an optional playlist segment (#/library/<playlistId>) so playlists
 * survive refresh and the Back button. */

import { VIEWS } from "./state.js";

const DEFAULT_VIEW = "radio";

const HASH_RE = /^#\/(\w+)(?:\/([\w-]+))?/;

function routeFromHash() {
  const match = window.location.hash.match(HASH_RE);
  if (!match || !VIEWS.includes(match[1])) return null;
  return { view: match[1], param: match[1] === "library" ? match[2] || null : null };
}

function hashFor(view, param) {
  return param ? `#/${view}/${param}` : `#/${view}`;
}

/* apply(view, param) performs the actual DOM/view switch. */
export function initRouter(apply) {
  window.addEventListener("hashchange", () => {
    const route = routeFromHash();
    apply(route?.view || DEFAULT_VIEW, route?.param || null);
  });

  /* Legacy links used ?view=; translate once without adding a history entry. */
  let initial = routeFromHash();
  if (!initial) {
    const url = new URL(window.location.href);
    const legacy = url.searchParams.get("view");
    initial = { view: VIEWS.includes(legacy) ? legacy : DEFAULT_VIEW, param: null };
    url.searchParams.delete("view");
    url.hash = hashFor(initial.view, null);
    window.history.replaceState(null, "", url);
  }
  apply(initial.view, initial.param);
}

/* Pushes a history entry; the hashchange listener applies the view. Returns
 * false when the hash is already current (callers re-render directly then). */
export function navigate(view, param = null) {
  if (!VIEWS.includes(view)) return false;
  const target = hashFor(view, param);
  if (window.location.hash === target) return false;
  window.location.hash = target;
  return true;
}
