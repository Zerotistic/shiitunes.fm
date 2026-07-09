/* Transient feedback messages. Errors stay up longer so they can be read;
 * anything persistent belongs in the hero status area, not here. */

const INFO_MS = 1800;
const ERROR_MS = 4200;

let toastTimer = null;

export function showToast(message, { error = false, celebrate = false } = {}) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.toggle("celebrate", celebrate);
  toast.classList.add("show");
  /* Celebrations linger like errors — you read them once a year. */
  toastTimer = window.setTimeout(
    () => toast.classList.remove("show"),
    error || celebrate ? ERROR_MS : INFO_MS
  );
}
