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
    tintDark: "rgba(255, 107, 112, 0.2)",
    textLight: "#be2430",
    textDark: "#ff9ca0",
    borderLight: "rgba(255, 107, 112, 0.42)",
    borderDark: "rgba(255, 107, 112, 0.48)",
  },
  {
    id: "sunset",
    name: "Sunset Orange",
    hex: "#f97316",
    hover: "#ea580c",
    tintLight: "#fff7ed",
    tintDark: "rgba(249, 115, 22, 0.22)",
    textLight: "#c2410c",
    textDark: "#fdba74",
    borderLight: "rgba(249, 115, 22, 0.42)",
    borderDark: "rgba(249, 115, 22, 0.5)",
  },
  {
    id: "teal",
    name: "Mint Teal",
    hex: "#0d9488",
    hover: "#0f766e",
    tintLight: "#f0fdfa",
    tintDark: "rgba(13, 148, 136, 0.24)",
    textLight: "#0f766e",
    textDark: "#5eead4",
    borderLight: "rgba(13, 148, 136, 0.4)",
    borderDark: "rgba(94, 234, 212, 0.45)",
  },
  {
    id: "sky",
    name: "Electric Sky",
    hex: "#2563eb",
    hover: "#1d4ed8",
    tintLight: "#eff6ff",
    tintDark: "rgba(37, 99, 235, 0.24)",
    textLight: "#1d4ed8",
    textDark: "#93c5fd",
    borderLight: "rgba(37, 99, 235, 0.38)",
    borderDark: "rgba(147, 197, 253, 0.45)",
  },
  {
    id: "berry",
    name: "Berry Rose",
    hex: "#db2777",
    hover: "#be185d",
    tintLight: "#fdf2f8",
    tintDark: "rgba(219, 39, 119, 0.24)",
    textLight: "#be185d",
    textDark: "#f9a8d4",
    borderLight: "rgba(219, 39, 119, 0.38)",
    borderDark: "rgba(249, 168, 212, 0.45)",
  },
  {
    id: "emerald",
    name: "Emerald Pulse",
    hex: "#059669",
    hover: "#047857",
    tintLight: "#ecfdf5",
    tintDark: "rgba(5, 150, 105, 0.24)",
    textLight: "#047857",
    textDark: "#6ee7b7",
    borderLight: "rgba(5, 150, 105, 0.38)",
    borderDark: "rgba(110, 231, 183, 0.45)",
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

  const isDark = safeMode === "dark";
  const tint = isDark ? swatch.tintDark : swatch.tintLight;
  const text = isDark ? swatch.textDark : swatch.textLight;
  const border = isDark ? swatch.borderDark : swatch.borderLight;

  root.style.setProperty("--color-secondary", swatch.hex);
  root.style.setProperty("--color-secondary-hover", swatch.hover);
  root.style.setProperty("--color-secondary-tint", tint);
  root.style.setProperty("--color-secondary-text", text);
  root.style.setProperty("--color-secondary-border", border);
  root.style.setProperty("--color-coral", swatch.hex);
  root.style.setProperty("--color-coral-hover", swatch.hover);
  root.style.setProperty("--color-coral-tint", tint);
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
