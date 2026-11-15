/**
 * In-app update notice for the sideloaded Android APK (website visitors never see it).
 *
 * The APK workflow builds the web bundle with VITE_APP_VERSION set from the release tag
 * (e.g. "1.1.3"). Inside the app we compare it with the latest GitHub release and, if a newer
 * one exists, show a small banner with a download link. Checks are throttled, and "Later"
 * hides the banner for that release.
 */
import { isNativeApp } from "./native.js";

const REPO = "BidBex/UniMeet";
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const FALLBACK_APK_URL = `https://github.com/${REPO}/releases/latest/download/UniMeet-release.apk`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STORAGE_KEY = "unimeet-update-check";

const APP_VERSION = String(import.meta.env.VITE_APP_VERSION || "").trim();

/** Parses "v1.2.3" / "1.2.3" into [1, 2, 3]; returns null for anything else. */
function parseVersion(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || "").trim());
  return m ? m.slice(1).map(Number) : null;
}

/** True when version `a` is newer than version `b`. */
export function isNewerVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the check simply runs again next time.
  }
}

function bottomOffsetPx() {
  const nav = document.querySelector("#mobile-bottom-nav");
  if (nav && getComputedStyle(nav).display !== "none") {
    return Math.round(nav.getBoundingClientRect().height) + 10;
  }
  return 16;
}

function showUpdateBanner({ version, apkUrl }) {
  if (document.querySelector("#app-update-banner")) return;
  const banner = document.createElement("div");
  banner.id = "app-update-banner";
  banner.className = "app-update-banner";
  banner.setAttribute("role", "status");
  banner.style.bottom = `${bottomOffsetPx()}px`;

  const text = document.createElement("div");
  text.className = "app-update-text";
  const title = document.createElement("strong");
  title.textContent = "New version available";
  const detail = document.createElement("span");
  detail.textContent = `UniMeet ${version} is ready. You have ${APP_VERSION}.`;
  text.append(title, detail);

  const actions = document.createElement("div");
  actions.className = "app-update-actions";
  const later = document.createElement("button");
  later.type = "button";
  later.className = "btn btn-secondary btn-sm";
  later.textContent = "Later";
  later.addEventListener("click", () => {
    writeState({ ...readState(), dismissedVersion: version });
    banner.remove();
  });
  const update = document.createElement("a");
  update.className = "btn btn-primary btn-sm";
  update.href = apkUrl;
  update.textContent = "Update";
  actions.append(later, update);

  banner.append(text, actions);
  document.body.append(banner);
}

/** Runs the update check inside the Android app; does nothing on the website or in dev builds. */
export async function checkForAppUpdate({ force = false } = {}) {
  if (!isNativeApp() || !parseVersion(APP_VERSION)) return;

  const state = readState();
  const now = Date.now();
  let latest = state.latestVersion;
  let apkUrl = state.apkUrl || FALLBACK_APK_URL;

  if (force || !state.checkedAt || now - state.checkedAt > CHECK_INTERVAL_MS || !latest) {
    try {
      const res = await fetch(LATEST_RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) return;
      const release = await res.json();
      latest = String(release.tag_name || "").replace(/^v/, "");
      const asset = (release.assets || []).find((a) => a.name === "UniMeet-release.apk");
      apkUrl = asset?.browser_download_url || FALLBACK_APK_URL;
      writeState({ ...state, checkedAt: now, latestVersion: latest, apkUrl });
    } catch {
      return; // Offline or rate-limited: try again next time.
    }
  }

  if (isNewerVersion(latest, APP_VERSION) && readState().dismissedVersion !== latest) {
    showUpdateBanner({ version: latest, apkUrl });
  }
}
