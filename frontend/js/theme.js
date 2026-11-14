/**
 * Centralized dynamic theme & harmonious color-pair engine for UniMeet.
 * Selecting a secondary accent color automatically pairs it with a matching,
 * accessible primary color across light and dark modes, persisted in localStorage.
 */

const THEME_STORAGE_KEY = "unimeet_theme_mode";
const SECONDARY_STORAGE_KEY = "unimeet_secondary_color";

export const SECONDARY_COLORS = [
  {
    id: "coral",
    name: "Terracotta",
    pairLabel: "Terracotta + Pine",
    hex: "#c6522f",
    hover: "#a84222",
    onSecondary: "#ffffff",
    tintLight: "#fbf0ec",
    tintDark: "rgba(198, 82, 47, 0.22)",
    textLight: "#9c381a",
    textDark: "#f09578",
    borderLight: "rgba(198, 82, 47, 0.36)",
    borderDark: "rgba(240, 149, 120, 0.42)",
    primary: {
      light: "#1e4d3b",
      lightHover: "#15382b",
      lightTint: "#e7f0ec",
      lightBorder: "rgba(30, 77, 59, 0.22)",
      onLight: "#ffffff",
      dark: "#4da982",
      darkHover: "#3b936e",
      darkTint: "rgba(77, 169, 130, 0.18)",
      darkBorder: "rgba(77, 169, 130, 0.34)",
      onDark: "#0f1713",
      bgLight: "#f6f5f1",
      bgSubtleLight: "#eceae2",
      bgDarkAside: "#162820",
    },
  },
  {
    id: "sunset",
    name: "Amber Orange",
    pairLabel: "Orange + Espresso Brown",
    hex: "#d4621a",
    hover: "#b35012",
    onSecondary: "#ffffff",
    tintLight: "#fdf2ea",
    tintDark: "rgba(212, 98, 26, 0.24)",
    textLight: "#9c430d",
    textDark: "#f5a973",
    borderLight: "rgba(212, 98, 26, 0.36)",
    borderDark: "rgba(245, 169, 115, 0.42)",
    primary: {
      light: "#5a351e",
      lightHover: "#432614",
      lightTint: "#f2ebe5",
      lightBorder: "rgba(90, 53, 30, 0.24)",
      onLight: "#ffffff",
      dark: "#c9926b",
      darkHover: "#b67d54",
      darkTint: "rgba(201, 146, 107, 0.2)",
      darkBorder: "rgba(201, 146, 107, 0.36)",
      onDark: "#1c120b",
      bgLight: "#f8f4ef",
      bgSubtleLight: "#efe7dd",
      bgDarkAside: "#2a1b12",
    },
  },
  {
    id: "sky",
    name: "Light Blue",
    pairLabel: "Light Blue + Navy Blue",
    hex: "#3b82c4",
    hover: "#2d6aa3",
    onSecondary: "#ffffff",
    tintLight: "#ecf4fc",
    tintDark: "rgba(59, 130, 196, 0.24)",
    textLight: "#1e5a94",
    textDark: "#8bc2f5",
    borderLight: "rgba(59, 130, 196, 0.36)",
    borderDark: "rgba(139, 194, 245, 0.42)",
    primary: {
      light: "#1b365d",
      lightHover: "#132642",
      lightTint: "#e7edf5",
      lightBorder: "rgba(27, 54, 93, 0.22)",
      onLight: "#ffffff",
      dark: "#6fa1e0",
      darkHover: "#588dcf",
      darkTint: "rgba(111, 161, 224, 0.2)",
      darkBorder: "rgba(111, 161, 224, 0.36)",
      onDark: "#0c1524",
      bgLight: "#f4f6f9",
      bgSubtleLight: "#e7ecf3",
      bgDarkAside: "#122138",
    },
  },
  {
    id: "emerald",
    name: "Sage Green",
    pairLabel: "Sage Green + Warm Cream",
    hex: "#4c7a57",
    hover: "#3b6244",
    onSecondary: "#ffffff",
    tintLight: "#edf4ee",
    tintDark: "rgba(76, 122, 87, 0.24)",
    textLight: "#2f5739",
    textDark: "#90cca0",
    borderLight: "rgba(76, 122, 87, 0.34)",
    borderDark: "rgba(144, 204, 160, 0.42)",
    primary: {
      light: "#2d4c37",
      lightHover: "#203827",
      lightTint: "#ede7d8",
      lightBorder: "rgba(45, 76, 55, 0.22)",
      onLight: "#f9f6ee",
      dark: "#d8ceb6",
      darkHover: "#c5b99d",
      darkTint: "rgba(216, 206, 182, 0.16)",
      darkBorder: "rgba(216, 206, 182, 0.32)",
      onDark: "#1a231c",
      bgLight: "#f8f5ec",
      bgSubtleLight: "#efe9d8",
      bgDarkAside: "#1f3024",
    },
  },
  {
    id: "berry",
    name: "Burgundy",
    pairLabel: "Burgundy + Warm Beige",
    hex: "#8c2742",
    hover: "#701c33",
    onSecondary: "#ffffff",
    tintLight: "#f9edf0",
    tintDark: "rgba(140, 39, 66, 0.24)",
    textLight: "#761d35",
    textDark: "#e98ea5",
    borderLight: "rgba(140, 39, 66, 0.34)",
    borderDark: "rgba(233, 142, 165, 0.42)",
    primary: {
      light: "#5c4632",
      lightHover: "#453323",
      lightTint: "#f2eadf",
      lightBorder: "rgba(92, 70, 50, 0.24)",
      onLight: "#fbf7f1",
      dark: "#d3bea5",
      darkHover: "#bfa78b",
      darkTint: "rgba(211, 190, 165, 0.18)",
      darkBorder: "rgba(211, 190, 165, 0.34)",
      onDark: "#1c1510",
      bgLight: "#f8f4ed",
      bgSubtleLight: "#eee5d7",
      bgDarkAside: "#2d2118",
    },
  },
  {
    id: "teal",
    name: "Lavender",
    pairLabel: "Lavender + Deep Purple",
    hex: "#8568cf",
    hover: "#6d50b8",
    onSecondary: "#ffffff",
    tintLight: "#f3effb",
    tintDark: "rgba(133, 104, 207, 0.24)",
    textLight: "#5a3fa3",
    textDark: "#c3b1f5",
    borderLight: "rgba(133, 104, 207, 0.34)",
    borderDark: "rgba(195, 177, 245, 0.42)",
    primary: {
      light: "#3b2166",
      lightHover: "#2a164b",
      lightTint: "#efeaf8",
      lightBorder: "rgba(59, 33, 102, 0.22)",
      onLight: "#ffffff",
      dark: "#b197ee",
      darkHover: "#9b7ee3",
      darkTint: "rgba(177, 151, 238, 0.2)",
      darkBorder: "rgba(177, 151, 238, 0.36)",
      onDark: "#160d26",
      bgLight: "#f6f4fa",
      bgSubtleLight: "#eae5f4",
      bgDarkAside: "#23143d",
    },
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

export function getActivePalette({ mode, secondaryId } = getThemePreferences()) {
  const swatch = SECONDARY_COLORS.find((c) => c.id === secondaryId) || SECONDARY_COLORS[0];
  const isDark = mode === "dark";
  return {
    swatch,
    mode: isDark ? "dark" : "light",
    primaryHex: isDark ? swatch.primary.dark : swatch.primary.light,
    secondaryHex: swatch.hex,
  };
}

export function applyThemePreferences({ mode, secondaryId } = getThemePreferences()) {
  const safeMode = mode === "dark" ? "dark" : "light";
  const swatch = SECONDARY_COLORS.find((c) => c.id === secondaryId) || SECONDARY_COLORS[0];

  const root = document.documentElement;
  root.setAttribute("data-theme", safeMode);
  root.setAttribute("data-secondary", swatch.id);

  const isDark = safeMode === "dark";
  const p = swatch.primary;

  // Dynamic harmonious primary color paired to the chosen secondary color
  root.style.setProperty("--color-primary", isDark ? p.dark : p.light);
  root.style.setProperty("--color-primary-hover", isDark ? p.darkHover : p.lightHover);
  root.style.setProperty("--color-primary-tint", isDark ? p.darkTint : p.lightTint);
  root.style.setProperty("--color-primary-border", isDark ? p.darkBorder : p.lightBorder);
  root.style.setProperty("--color-on-primary", isDark ? p.onDark : p.onLight);
  root.style.setProperty("--color-bg-dark", isDark ? "#0c0e0d" : p.bgDarkAside);
  if (!isDark) {
    root.style.setProperty("--color-bg-light", p.bgLight);
    root.style.setProperty("--color-bg-subtle", p.bgSubtleLight);
    root.style.setProperty("--color-header-bg", "rgba(255, 255, 255, 0.88)");
  } else {
    root.style.removeProperty("--color-bg-light");
    root.style.removeProperty("--color-bg-subtle");
    root.style.removeProperty("--color-header-bg");
  }

  // Secondary color tokens
  const tint = isDark ? swatch.tintDark : swatch.tintLight;
  const text = isDark ? swatch.textDark : swatch.textLight;
  const border = isDark ? swatch.borderDark : swatch.borderLight;

  root.style.setProperty("--color-secondary", swatch.hex);
  root.style.setProperty("--color-secondary-hover", swatch.hover);
  root.style.setProperty("--color-secondary-tint", tint);
  root.style.setProperty("--color-secondary-text", text);
  root.style.setProperty("--color-secondary-border", border);
  root.style.setProperty("--color-on-secondary", swatch.onSecondary || "#ffffff");
  root.style.setProperty("--color-coral", swatch.hex);
  root.style.setProperty("--color-coral-hover", swatch.hover);
  root.style.setProperty("--color-coral-tint", tint);

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute("content", isDark ? "#111412" : p.bgLight);
  }
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
