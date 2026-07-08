/* Track popup menu (⋮): quick actions plus add-to-playlist checkboxes.
 * Implements the keyboard contract its menu roles promise: focus moves into
 * the menu on open, arrow keys navigate, Escape closes and returns focus to
 * the trigger. */

import { icon, inlineNameForm } from "./components.js";
import { state } from "./state.js";

let menuNode = null;
let triggerNode = null;
let cleanupFns = [];

export function closePlaylistMenu({ refocus = false } = {}) {
  if (!menuNode) return;
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  menuNode.remove();
  menuNode = null;
  if (refocus && triggerNode?.isConnected) triggerNode.focus();
  triggerNode = null;
}

function menuItems() {
  return [...menuNode.querySelectorAll("button")];
}

function focusItem(index) {
  const items = menuItems();
  if (!items.length) return;
  const wrapped = (index + items.length) % items.length;
  /* preventScroll: the menu is position:fixed inside the viewport, and any
   * focus-scroll would instantly trip the close-on-scroll listener. */
  items[wrapped].focus({ preventScroll: true });
}

function handleMenuKeydown(event) {
  const items = menuItems();
  const current = items.indexOf(document.activeElement);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusItem(current + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusItem(current - 1);
  } else if (event.key === "Home") {
    event.preventDefault();
    focusItem(0);
  } else if (event.key === "End") {
    event.preventDefault();
    focusItem(items.length - 1);
  } else if (event.key === "Escape") {
    event.stopPropagation();
    closePlaylistMenu({ refocus: true });
  } else if (event.key === "Tab") {
    closePlaylistMenu();
  }
}

function actionItem(iconName, label, onPick) {
  const item = document.createElement("button");
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.append(icon(iconName), document.createTextNode(label));
  item.addEventListener("click", () => {
    closePlaylistMenu({ refocus: true });
    onPick();
  });
  return item;
}

/* Shared open/position/dismiss plumbing for every popup menu. `at` ({x,y},
 * e.g. a right-click point) takes precedence over the anchor's rect. */
function presentMenu(anchor, at = null) {
  document.body.appendChild(menuNode);
  const rect = at
    ? { left: at.x, right: at.x, top: at.y, bottom: at.y }
    : anchor.getBoundingClientRect();
  const menuRect = menuNode.getBoundingClientRect();
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - menuRect.width - 12);
  const below = rect.bottom + (at ? 2 : 8);
  const top = below + menuRect.height > window.innerHeight - 12
    ? Math.max(12, rect.top - menuRect.height - (at ? 2 : 8))
    : below;
  menuNode.style.left = `${left}px`;
  menuNode.style.top = `${top}px`;

  const onOutsidePointer = (event) => {
    if (!menuNode || menuNode.contains(event.target)) return;
    /* Button anchors stay "inside" so the trigger click can't close-reopen;
     * cursor-positioned menus (at) may have a huge container as anchor and
     * get no such exemption. */
    if (!at && (event.target === anchor || anchor.contains(event.target))) return;
    closePlaylistMenu();
  };
  window.addEventListener("pointerdown", onOutsidePointer);
  cleanupFns.push(() => window.removeEventListener("pointerdown", onOutsidePointer));

  /* The menu is position:fixed and placed once — scrolling or resizing would
   * leave it floating detached from its row, so close it instead. Registered
   * a frame late: the browser may have auto-scrolled the trigger into view
   * just before opening, and that queued scroll event would instantly close
   * the menu it never actually moved. */
  const onReflow = (event) => {
    if (event.type === "scroll" && menuNode?.contains(event.target)) return;
    closePlaylistMenu();
  };
  const armReflow = window.requestAnimationFrame(() => {
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
  });
  cleanupFns.push(() => {
    window.cancelAnimationFrame(armReflow);
    window.removeEventListener("scroll", onReflow, true);
    window.removeEventListener("resize", onReflow);
  });

  focusItem(0);
}

/* actions: { onToggle(playlistId, track), onCreate(name, track),
 *            onQueueNext(track), onQueueLast(track),
 *            onOpen(track), onCopyLink(track), onCopyAppLink(track) }
 * includeActions:false renders the playlist section only (hero + button).
 * queueControls replaces the default queue entries (e.g. a card already in
 * the queue offers "Remove from queue" instead of "Play next"). */
export function openTrackMenu(anchor, track, actions, { includeActions = true, at = null, queueControls = null } = {}) {
  closePlaylistMenu();
  triggerNode = anchor;
  menuNode = document.createElement("div");
  menuNode.className = "playlist-menu";
  menuNode.setAttribute("role", "menu");
  menuNode.setAttribute("aria-label", includeActions ? "Song options" : "Add to playlist");
  menuNode.addEventListener("keydown", handleMenuKeydown);

  if (includeActions) {
    const queueItems = queueControls || [
      { icon: "next", label: "Play next", onPick: () => actions.onQueueNext(track) },
      { icon: "queue", label: "Add to queue", onPick: () => actions.onQueueLast(track) }
    ];
    queueItems.forEach((entry) => {
      const item = actionItem(entry.icon, entry.label, entry.onPick);
      if (entry.danger) item.classList.add("menu-danger");
      menuNode.appendChild(item);
    });
    menuNode.append(
      actionItem("external", "Open on YouTube", () => actions.onOpen(track)),
      actionItem("copy", "Copy YouTube link", () => actions.onCopyLink(track)),
      actionItem("link", "Copy ShiiTunes link", () => actions.onCopyAppLink(track))
    );
    const label = document.createElement("span");
    label.className = "playlist-menu-label";
    label.textContent = "Add to playlist";
    menuNode.appendChild(label);
  }

  const customPlaylists = state.playlists.custom;
  if (!customPlaylists.length && !includeActions) {
    const empty = document.createElement("span");
    empty.className = "playlist-menu-empty";
    empty.textContent = "No playlists yet";
    menuNode.appendChild(empty);
  }

  customPlaylists.forEach((playlist) => {
    const hasTrack = playlist.trackIds.includes(track.id);
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitemcheckbox");
    item.setAttribute("aria-checked", String(hasTrack));
    item.className = hasTrack ? "active" : "";
    item.append(icon(hasTrack ? "check" : "plus"), document.createTextNode(playlist.name));
    item.addEventListener("click", () => {
      closePlaylistMenu({ refocus: true });
      actions.onToggle(playlist.id, track);
    });
    menuNode.appendChild(item);
  });

  /* "New playlist" doesn't leave the menu: the row turns into an inline
   * name input right where it sits; Enter creates the playlist with this
   * song already in it. Escape puts the button back. */
  const create = document.createElement("button");
  create.type = "button";
  create.className = "playlist-menu-create";
  create.setAttribute("role", "menuitem");
  create.append(icon("plus"), document.createTextNode("New playlist"));
  create.addEventListener("click", () => {
    const form = inlineNameForm({
      placeholder: "Name your playlist",
      onSubmit: (name) => {
        closePlaylistMenu({ refocus: true });
        actions.onCreate(name, track);
      },
      onCancel: () => {
        if (!form.isConnected) return;
        form.replaceWith(create);
        create.focus({ preventScroll: true });
      }
    });
    create.replaceWith(form);
    form.querySelector("input").focus({ preventScroll: true });
  });
  menuNode.appendChild(create);

  presentMenu(anchor, at);
}

export function openPlaylistMenu(anchor, track, actions) {
  openTrackMenu(anchor, track, actions, { includeActions: false });
}

/* Small generic action menu (used by right-click on sidebar playlists).
 * entries: [{ icon, label, danger?, onPick }] */
export function openContextMenu(anchor, entries, { at = null, label = "Options" } = {}) {
  closePlaylistMenu();
  triggerNode = anchor;
  menuNode = document.createElement("div");
  menuNode.className = "playlist-menu";
  menuNode.setAttribute("role", "menu");
  menuNode.setAttribute("aria-label", label);
  menuNode.addEventListener("keydown", handleMenuKeydown);
  entries.forEach((entry) => {
    const item = actionItem(entry.icon, entry.label, entry.onPick);
    if (entry.danger) item.classList.add("menu-danger");
    menuNode.appendChild(item);
  });
  presentMenu(anchor, at);
}
