/**
 * Settings screen controller: Light/Dark mode switching, secondary color selection,
 * and resetting the demo account back to its default data.
 */
import { API } from "./api.js";
import { getCurrentUser, renderDashboardShell } from "./navigation.js";
import {
  getThemePreferences,
  resetThemePreferences,
  SECONDARY_COLORS,
  setSecondaryColor,
  setThemeMode,
} from "./theme.js";
import { escapeHtml, qs, qsa, showToast } from "./utils.js";

function renderDemoAccountSection(user) {
  const statusEl = qs("#demo-account-status");
  const resetBtn = qs("#reset-demo-account-btn");
  if (!statusEl || !resetBtn) return;

  if (!user) {
    statusEl.innerHTML = `Sign in to manage or reset a demo account.`;
    resetBtn.disabled = true;
    return;
  }

  statusEl.innerHTML = `
    <strong>${escapeHtml(user.first_name)} ${escapeHtml(user.last_name)}</strong>
    <div class="muted-small">@${escapeHtml(user.username)} · ${escapeHtml(user.email)}</div>
    <div class="muted-small">${escapeHtml(user.university || "No university")} · ${escapeHtml(user.city || "No city")}</div>
  `;
  resetBtn.disabled = false;
}

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

document.addEventListener("DOMContentLoaded", async () => {
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

  const user = await getCurrentUser(true);
  renderDemoAccountSection(user);

  const resetDemoBtn = qs("#reset-demo-account-btn");
  resetDemoBtn?.addEventListener("click", async () => {
    resetDemoBtn.disabled = true;
    const originalText = resetDemoBtn.textContent;
    resetDemoBtn.textContent = "Resetting...";
    try {
      const restored = await API.resetDemoAccount();
      renderDashboardShell(restored);
      renderDemoAccountSection(restored);
      showToast(`Demo account restored to defaults (@${restored.username}).`, "success");
    } catch (err) {
      showToast(err.message || "Could not reset demo account.", "error");
    } finally {
      resetDemoBtn.disabled = false;
      resetDemoBtn.textContent = originalText;
    }
  });

  renderSettingsUI();
});
