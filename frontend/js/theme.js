/**
 * Centralized theme & secondary color customization engine for UniMeet.
 * Persists user preferences in localStorage and applies CSS custom properties on <html>.
 */

const THEME_STORAGE_KEY = "unimeet_theme_mode";
const SECONDARY_STORAGE_KEY = "unimeet_secondary_color";

export const SECONDARY_COLORS = [
  {
    id: "coral",
    name: "Coral Flame",
    hex: "#ff6b70",
    hover: "#ea5459",
    tintLight: "#fff0f1",
    tintDark: "rgba(255, 107, 112, 0.18)",
  },
  {
    id: "sunset",
    name: "Sunset Orange",
    hex: "#f97316",
    hover: "#ea580c",
    tintLight: "#fff7ed",
    tintDark: "rgba(249, 115, 22, 0.2)",
  },
  {
    id: "teal",
    name: "Mint Teal",
    hex: "#0d9488",
    hover: "#0f766e",
    tintLight: "#f0fdfa",
    tintDark: "rgba(13, 148, 136, 0.22)",
  },
  {
    id: "sky",
    name: "Electric Sky",
    hex: "#2563eb",
    hover: "#1d4ed8",
    tintLight: "#eff6ff",
    tintDark: "rgba(37, 99, 235, 0.22)",
  },
  {
    id: "berry",
    name: "Berry Rose",
    hex: "#db2777",
    hover: "#be185d",
    tintLight: "#fdf2f8",
    tintDark: "rgba(219, 39, 119, 0.22)",
  },
  {
    id: "emerald",
    name: "Emerald Pulse",
    hex: "#059669",
    hover: "#047857",
    tintLight: "#ecfdf5",
    tintDark: "rgba(5, 150, 105, 0.22)",
  },
];

export function getThemePreferences() {
  let mode = "light";
  let secondaryId = "coral";
  try {
    const storedMode = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedMode === "dark" || storedMode === "light") {
      mode = storedMode;
    }
    const storedSecondary = localStorage.getItem(SECONDARY_STORAGE_KEY);
    if (storedSecondary && SECONDARY_COLORS.some((c) => c.id === storedSecondary)) {
      secondaryId = storedSecondary;
    }
  } catch {
    // Ignore storage restriction
  }
  return { mode, secondaryId };
}

export function applyThemePreferences({ mode, secondaryId } = getThemePreferences()) {
  const safeMode = mode === "dark" ? "dark" : "light";
  const swatch = SECONDARY_COLORS.find((c) => c.id === secondaryId) || SECONDARY_COLORS[0];

  const root = document.documentElement;
  root.setAttribute("data-theme", safeMode);
  root.setAttribute("data-secondary", swatch.id);

  root.style.setProperty("--color-secondary", swatch.hex);
  root.style.setProperty("--color-secondary-hover", swatch.hover);
  root.style.setProperty(
    "--color-secondary-tint",
    safeMode === "dark" ? swatch.tintDark : swatch.tintLight
  );
  root.style.setProperty("--color-coral", swatch.hex);
  root.style.setProperty("--color-coral-hover", swatch.hover);
  root.style.setProperty(
    "--color-coral-tint",
    safeMode === "dark" ? swatch.tintDark : swatch.tintLight
  );
}

export function setThemeMode(mode) {
  const safeMode = mode === "dark" ? "dark" : "light";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, safeMode);
  } catch {
    // Ignore
  }
  const prefs = getThemePreferences();
  applyThemePreferences({ mode: safeMode, secondaryId: prefs.secondaryId });
  return { mode: safeMode, secondaryId: prefs.secondaryId };
}

export function setSecondaryColor(secondaryId) {
  const swatch = SECONDARY_COLORS.find((c) => c.id === secondaryId) || SECONDARY_COLORS[0];
  try {
    localStorage.setItem(SECONDARY_STORAGE_KEY, swatch.id);
  } catch {
    // Ignore
  }
  const prefs = getThemePreferences();
  applyThemePreferences({ mode: prefs.mode, secondaryId: swatch.id });
  return { mode: prefs.mode, secondaryId: swatch.id };
}

export function resetThemePreferences() {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
    localStorage.removeItem(SECONDARY_STORAGE_KEY);
  } catch {
    // Ignore
  }
  const defaults = { mode: "light", secondaryId: "coral" };
  applyThemePreferences(defaults);
  return defaults;
}

// Apply immediately when module loads
applyThemePreferences();
