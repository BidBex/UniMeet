/**
 * Authentication module scaffold (Login & Registration screens implemented in Stage 4).
 */
import { CONFIG } from "./config.js";

export function initAuthPage() {
  const page = document.body?.dataset?.page;
  if (page !== "login" && page !== "register") return;
  document.documentElement.dataset.apiMode = CONFIG.USE_MOCK_API ? "mock" : "live";
}

document.addEventListener("DOMContentLoaded", initAuthPage);
