/* In-app <dialog> replacement for window.confirm: styled, keyboard- and
 * focus-correct, and available in embedded contexts that suppress native
 * dialogs. (Playlist naming is inline — see inlineNameForm in components.js.)
 *
 * returnValue gotcha: closing a <dialog> with Escape does NOT reset
 * returnValue — it keeps the value from the previous close. Every open below
 * clears it first so a stale "confirm" can never leak through. */

function openFresh(dialog) {
  dialog.returnValue = "";
  dialog.showModal();
}

export function confirmDanger({ title, body, confirmLabel = "Delete", danger = true }) {
  const dialog = document.getElementById("confirmDialog");
  dialog.querySelector(".dialog-title").textContent = title;
  dialog.querySelector(".dialog-body").textContent = body;
  const confirm = dialog.querySelector(".dialog-confirm");
  confirm.textContent = confirmLabel;
  /* Non-destructive confirms (e.g. saving a shared playlist) wear the
   * primary style instead of the red one. */
  confirm.classList.toggle("danger-button", danger);
  confirm.classList.toggle("primary-action", !danger);

  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener("close", onClose);
      resolve(dialog.returnValue === "confirm");
    };
    dialog.addEventListener("close", onClose);
    openFresh(dialog);
  });
}
