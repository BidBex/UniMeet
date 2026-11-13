/**
 * Centralized REST API client scaffold (expanded in Stage 10 using Developer 1 API contracts).
 */
import { CONFIG } from "./config.js";

export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message =
        (payload && typeof payload === "object" && (payload.detail || payload.message)) ||
        `Request failed (${response.status})`;
      throw new ApiError(message, response.status, payload);
    }

    return payload;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
