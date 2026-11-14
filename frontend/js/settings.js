/**
 * Settings screen controller: Light/Dark mode switching, dynamic harmonious
 * primary + secondary color pair selection, and resetting the demo account.
 */
import { API } from "./api.js";
import { getCurrentUser, renderDashboardShell } from "./navigation.js";
import {
  getActivePalette,
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
  const palette = getActivePalette({ mode, secondaryId });

  qsa("[data-theme-mode]").forEach((btn) => {
    const active = btn.dataset.themeMode === mode;
    btn.classList.toggle("is-selected", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  const activePairLabel = qs("#active-palette-label");
  if (activePairLabel) {
    activePairLabel.textContent = `Active palette: ${palette.swatch.pairLabel}`;
  }

  const grid = qs("#secondary-color-grid");
  if (grid) {
    grid.innerHTML = SECONDARY_COLORS.map((swatch) => {
      const active = swatch.id === secondaryId;
      const primaryDot = mode === "dark" ? swatch.primary.dark : swatch.primary.light;
      return `
        <button
          type="button"
          class="color-swatch-btn ${active ? "is-selected" : ""}"
          data-secondary-id="${escapeHtml(swatch.id)}"
          aria-pressed="${active ? "true" : "false"}"
        >
          <span class="color-swatch-pair" aria-hidden="true">
            <span class="color-swatch-circle" style="background:${escapeHtml(swatch.hex)};"></span>
            <span class="color-swatch-circle is-primary-dot" style="background:${escapeHtml(primaryDot)};"></span>
          </span>
          <span class="color-swatch-meta">
            <span>${escapeHtml(swatch.name)}</span>
            <span class="color-swatch-pair-sub">${escapeHtml(swatch.pairLabel)}</span>
          </span>
        </button>
      `;
    }).join("");

    qsa("[data-secondary-id]", grid).forEach((btn) => {
      btn.addEventListener("click", () => {
        setSecondaryColor(btn.dataset.secondaryId);
        renderSettingsUI();
      });
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.body?.dataset?.page !== "settings") return;

  qsa("[data-theme-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setThemeMode(btn.dataset.themeMode);
      renderSettingsUI();
    });
  });

  qs("#settings-reset-btn")?.addEventListener("click", () => {
    resetThemePreferences();
    renderSettingsUI();
  });

  const user = await getCurrentUser(true);
  renderDemoAccountSection(user);

  const resetDemoBtn = qs("#reset-demo-account-btn");
  resetDemoBtn?.addEventListener("click", async () => {
    resetDemoBtn.disabled = true;
    const originalText = resetDemoBtn.textContent;
    resetDemoBtn.textContent = "Resetting...";
    const feedbackEl = qs("#demo-reset-feedback");
    if (feedbackEl) feedbackEl.hidden = true;
    try {
      const restored = await API.resetDemoAccount();
      renderDashboardShell(restored);
      renderDemoAccountSection(restored);
      if (feedbackEl) {
        feedbackEl.hidden = false;
        feedbackEl.className = "form-alert form-alert-success";
        feedbackEl.textContent = `Demo account restored to defaults (@${restored.username}).`;
      }
    } catch (err) {
      showToast(err.message || "Could not reset demo account.", "error");
    } finally {
      resetDemoBtn.disabled = false;
      resetDemoBtn.textContent = originalText;
    }
  });

  renderSettingsUI();
});
