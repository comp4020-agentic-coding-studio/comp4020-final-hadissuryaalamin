// Small shared UI helpers: busy buttons, in-row confirm, empty table rows.

async function withBusy(button, task) {
  if (!button || button.disabled) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

// First click arms the button ("Confirm?"), second click within 4s runs it.
const armedResets = new WeakMap();
function armConfirm(button, label, onConfirm) {
  const pending = armedResets.get(button);
  if (pending) {
    pending();
    onConfirm();
    return;
  }
  const original = { html: button.innerHTML, cls: button.className, aria: button.getAttribute("aria-label") };
  button.className = original.cls.replace("icon-btn", "").trim();
  button.textContent = label;
  button.setAttribute("aria-label", label);
  let timer;
  const reset = () => {
    clearTimeout(timer);
    button.removeEventListener("blur", reset);
    armedResets.delete(button);
    button.innerHTML = original.html;
    button.className = original.cls;
    if (original.aria) button.setAttribute("aria-label", original.aria);
  };
  timer = setTimeout(reset, 4000);
  button.addEventListener("blur", reset);
  armedResets.set(button, reset);
}

function emptyRow(tbody, colspan, text) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = colspan;
  td.className = "muted";
  td.textContent = text;
  tr.appendChild(td);
  tbody.appendChild(tr);
}
