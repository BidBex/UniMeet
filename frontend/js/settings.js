/**
 * Settings screen controller: Light/Dark mode switching and secondary color selection.
 */
import {
  getThemePreferences,
  resetThemePreferences,
  SECONDARY_COLORS,
  setSecondaryColor,
  setThemeMode,
} from "./theme.js";
import { escapeHtml, qs, qsa, showToast } from "./utils.js";

function renderSettingsUI() {
  const { mode, secondaryId } = getThemePreferences();

  qsa("[data-theme-mode]").forEach((btn) => {
    const active = btn.dataset.themeMode === mode;
    btn.classList.toggle("is-selected", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  const grid = qs("#secondary-color-grid");
  if (grid) {
    grid.innerHTML = SECONDARY_COLORS.map((swatch) => {
      const active = swatch.id === secondaryId;
      return `
        <button
          type="button"
          class="color-swatch-btn ${active ? "is-selected" : ""}"
          data-secondary-id="${escapeHtml(swatch.id)}"
          aria-pressed="${active ? "true" : "false"}"
        >
          <span class="color-swatch-circle" style="background:${escapeHtml(swatch.hex)};"></span>
          <span>${escapeHtml(swatch.name)}</span>
        </button>
      `;
    }).join("");

    qsa("[data-secondary-id]", grid).forEach((btn) => {
      btn.addEventListener("click", () => {
        const updated = setSecondaryColor(btn.dataset.secondaryId);
        renderSettingsUI();
        const chosen = SECONDARY_COLORS.find((c) => c.id === updated.secondaryId);
        showToast(`Secondary color set to ${chosen ? chosen.name : updated.secondaryId}.`, "success");
      });
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.body?.dataset?.page !== "settings") return;

  qsa("[data-theme-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = setThemeMode(btn.dataset.themeMode);
      renderSettingsUI();
      showToast(`Switched to ${next.mode === "dark" ? "Dark" : "Light"} mode.`, "success");
    });
  });

  qs("#settings-reset-btn")?.addEventListener("click", () => {
    resetThemePreferences();
    renderSettingsUI();
    showToast("Appearance reset to default Light mode & Coral Flame.", "info");
  });

  renderSettingsUI();
});
