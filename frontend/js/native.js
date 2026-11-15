/** True when running inside the Capacitor Android app (its WebView injects window.Capacitor). */
export function isNativeApp() {
  const cap = window.Capacitor;
  if (cap && typeof cap.isNativePlatform === "function") return cap.isNativePlatform();
  return Boolean(cap?.platform && cap.platform !== "web");
}
