/**
 * Shared ES6+ utilities: DOM helpers, XSS escaping, toast notifications, image fallbacks, and safety modals.
 */
import "./theme.js";

export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

export function qsa(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatDateTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return String(isoString);
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatTimeShort(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatSmartDateTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDate) / 86400000);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  if (dayDiff === 0) return timePart;
  if (dayDiff === 1) return `Yesterday ${timePart}`;
  if (dayDiff > 1 && dayDiff < 7) {
    const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date);
    return `${weekday} ${timePart}`;
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(date);
}

export function formatRelativeTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

export function getInitials(firstName, lastName, fallback = "U") {
  const a = (firstName || "").trim().charAt(0).toUpperCase();
  const b = (lastName || "").trim().charAt(0).toUpperCase();
  return a + b || fallback;
}

export function getCookie(name) {
  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (const raw of cookies) {
    const [key, ...rest] = raw.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return "";
}

export function ensureToastContainer() {
  let container = qs("#toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = "info", durationMs = 4000) {
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
    <span class="toast-text">${escapeHtml(message)}</span>
    <button type="button" class="toast-close" aria-label="Dismiss notification">&times;</button>
  `;
  toast.querySelector(".toast-close").addEventListener("click", () => toast.remove());
  container.appendChild(toast);

  window.setTimeout(() => {
    if (toast.isConnected) toast.remove();
  }, durationMs);
}

export function renderMediaWithFallback(imageUrl, altText, fallbackTitle, extraClass = "") {
  const safeAlt = escapeHtml(altText || fallbackTitle || "UniMeet image");
  const safeLabel = escapeHtml((fallbackTitle || "UniMeet").slice(0, 2).toUpperCase());
  const hasImg = Boolean(imageUrl && String(imageUrl).trim());

  if (!hasImg) {
    return `
      <div class="media-fallback ${extraClass}" aria-label="${safeAlt}">
        <span class="media-fallback-mark">${safeLabel}</span>
      </div>
    `;
  }

  return `
    <div class="media-frame ${extraClass}">
      <img
        src="${escapeHtml(imageUrl)}"
        alt="${safeAlt}"
        referrerpolicy="no-referrer"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      >
      <div class="media-fallback" style="display:none;" aria-hidden="true">
        <span class="media-fallback-mark">${safeLabel}</span>
      </div>
    </div>
  `;
}

export function openModal({ title, bodyHtml, headerActionsHtml = "", onMount }) {
  closeActiveModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "active-modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title-text">
      <div class="modal-header">
        <h2 id="modal-title-text" class="modal-title">${escapeHtml(title)}</h2>
        <div class="modal-header-actions">
          ${headerActionsHtml}
          <button type="button" class="icon-btn" id="modal-close-btn" aria-label="Close modal">&times;</button>
        </div>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>
  `;

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", escHandler);
  };
  const escHandler = (ev) => {
    if (ev.key === "Escape") close();
  };

  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  document.addEventListener("keydown", escHandler);
  document.body.appendChild(backdrop);

  if (typeof onMount === "function") {
    onMount(backdrop, close);
  }
  return close;
}

export function openConfirmDialog({
  title = "Confirm action",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
}) {
  return openModal({
    title,
    bodyHtml: `
      <div>
        <p style="margin-bottom: 1.25rem;">${escapeHtml(message)}</p>
        <div id="confirm-dialog-error" class="form-alert form-alert-error" hidden style="margin-bottom: 1rem;"></div>
        <div class="card-actions" style="justify-content: flex-end; margin-top: 0;">
          <button type="button" class="btn btn-secondary" id="confirm-cancel-btn">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn ${destructive ? "btn-danger" : "btn-primary"}" id="confirm-proceed-btn">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `,
    onMount: (root, close) => {
      const cancelBtn = qs("#confirm-cancel-btn", root);
      const proceedBtn = qs("#confirm-proceed-btn", root);
      const errEl = qs("#confirm-dialog-error", root);

      cancelBtn.addEventListener("click", close);
      proceedBtn.addEventListener("click", async () => {
        if (typeof onConfirm !== "function") {
          close();
          return;
        }
        proceedBtn.disabled = true;
        cancelBtn.disabled = true;
        const originalText = proceedBtn.textContent;
        proceedBtn.textContent = "Working...";
        errEl.hidden = true;
        try {
          await onConfirm(close);
        } catch (err) {
          errEl.hidden = false;
          errEl.textContent = err?.message || "Could not complete action.";
          proceedBtn.disabled = false;
          cancelBtn.disabled = false;
          proceedBtn.textContent = originalText;
        }
      });
    },
  });
}

export function closeActiveModal() {
  const existing = qs("#active-modal-backdrop");
  if (existing) existing.remove();
}
