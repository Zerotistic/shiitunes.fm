/* Transient feedback messages. Errors stay up longer so they can be read;
 * anything persistent belongs in the hero status area, not here. */

const INFO_MS = 1800;
const ERROR_MS = 4200;

let toastTimer = null;

export function showToast(message, { error = false } = {}) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), error ? ERROR_MS : INFO_MS);
}
