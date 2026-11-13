/**
 * Centralized REST API module for UniMeet.
 * Handles HttpOnly cookie + CSRF token headers, loading feedback, session expiration, and error formatting.
 */
import { CONFIG } from "./config.js";
import { getCookie, showToast } from "./utils.js";

const TOKEN_STORAGE_KEY = "unimeet_bearer_fallback";

export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function setFallbackToken(token) {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage unavailability
  }
}

export function getFallbackToken() {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

  const method = (options.method || "GET").toUpperCase();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const csrfToken = getCookie("unimeet_csrf_token");
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  // Send fallback Bearer header only when cross-origin cookies aren't present
  const fallbackToken = getFallbackToken();
  if (fallbackToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${fallbackToken}`;
  }

  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
      credentials: "include",
      ...options,
      method,
      headers,
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      if (payload && typeof payload === "object") {
        if (typeof payload.detail === "string") {
          message = payload.detail;
        } else if (Array.isArray(payload.detail)) {
          message = payload.detail.map((d) => d.msg || d.message).filter(Boolean).join("; ");
        } else if (payload.message) {
          message = payload.message;
        }
      }

      if (response.status === 401 && !options.skipAuthRedirect) {
        setFallbackToken("");
        const currentPage = document.body?.dataset?.page;
        if (currentPage && !["landing", "login", "register", "events"].includes(currentPage)) {
          showToast("Your session expired. Please sign in again.", "error");
          window.setTimeout(() => {
            window.location.href = "login.html";
          }, 900);
        }
      }

      throw new ApiError(message, response.status, payload);
    }

    return payload;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.name === "AbortError") {
      throw new ApiError("Request timed out. Check your connection.", 408);
    }
    throw new ApiError("Unable to reach the UniMeet backend server.", 0);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const API = {
  // Auth
  register: (data) => apiRequest("/auth/register", { method: "POST", body: JSON.stringify(data), skipAuthRedirect: true }),
  login: (data) => apiRequest("/auth/login", { method: "POST", body: JSON.stringify(data), skipAuthRedirect: true }),
  logout: () => apiRequest("/auth/logout", { method: "POST", skipAuthRedirect: true }),
  me: (opts = {}) => apiRequest("/auth/me", opts),

  // Users & Interests & Compatibility
  getMyProfile: () => apiRequest("/users/me"),
  updateMyProfile: (data) => apiRequest("/users/me", { method: "PUT", body: JSON.stringify(data) }),
  getUserProfile: (userId) => apiRequest(`/users/${userId}`),
  discoverUsers: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return apiRequest(`/users/discover${qs.toString() ? `?${qs}` : ""}`);
  },
  getCompatibility: (userId) => apiRequest(`/users/${userId}/compatibility`),
  getMyInterests: () => apiRequest("/users/interests"),
  updateMyInterests: (interestIds) =>
    apiRequest("/users/interests", { method: "PUT", body: JSON.stringify({ interest_ids: interestIds }) }),
  listInterests: () => apiRequest("/interests", { skipAuthRedirect: true }),

  // Events
  listEvents: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return apiRequest(`/events${qs.toString() ? `?${qs}` : ""}`, { skipAuthRedirect: true });
  },
  getEvent: (eventId) => apiRequest(`/events/${eventId}`, { skipAuthRedirect: true }),
  createEvent: (data) => apiRequest("/events", { method: "POST", body: JSON.stringify(data) }),
  updateEvent: (eventId, data) => apiRequest(`/events/${eventId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEvent: (eventId) => apiRequest(`/events/${eventId}`, { method: "DELETE" }),
  joinEvent: (eventId) => apiRequest(`/events/${eventId}/join`, { method: "POST" }),
  leaveEvent: (eventId) => apiRequest(`/events/${eventId}/leave`, { method: "DELETE" }),
  likeEvent: (eventId) => apiRequest(`/events/${eventId}/like`, { method: "POST" }),
  unlikeEvent: (eventId) => apiRequest(`/events/${eventId}/like`, { method: "DELETE" }),
  getEventParticipants: (eventId) => apiRequest(`/events/${eventId}/participants`, { skipAuthRedirect: true }),

  // Matching
  likeUser: (receiverId, eventId) =>
    apiRequest("/matches/like", {
      method: "POST",
      body: JSON.stringify({ receiver_id: receiverId, event_id: eventId }),
    }),
  listMatches: () => apiRequest("/matches"),
  listLikedEvents: () => apiRequest("/matches/liked-events"),
  getMatch: (matchId) => apiRequest(`/matches/${matchId}`),
  deleteMatch: (matchId) => apiRequest(`/matches/${matchId}`, { method: "DELETE" }),

  // Groups
  listGroups: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return apiRequest(`/groups${qs.toString() ? `?${qs}` : ""}`, { skipAuthRedirect: true });
  },
  getGroup: (groupId) => apiRequest(`/groups/${groupId}`, { skipAuthRedirect: true }),
  createGroup: (data) => apiRequest("/groups", { method: "POST", body: JSON.stringify(data) }),
  updateGroup: (groupId, data) => apiRequest(`/groups/${groupId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteGroup: (groupId) => apiRequest(`/groups/${groupId}`, { method: "DELETE" }),
  joinGroup: (groupId) => apiRequest(`/groups/${groupId}/join`, { method: "POST" }),
  leaveGroup: (groupId) => apiRequest(`/groups/${groupId}/leave`, { method: "DELETE" }),
  getGroupMembers: (groupId) => apiRequest(`/groups/${groupId}/members`, { skipAuthRedirect: true }),
  approveGroupMember: (groupId, userId) =>
    apiRequest(`/groups/${groupId}/members/${userId}/approve`, { method: "POST" }),

  // Going Solo
  listSolo: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return apiRequest(`/solo${qs.toString() ? `?${qs}` : ""}`, { skipAuthRedirect: true });
  },
  createSolo: (data) => apiRequest("/solo", { method: "POST", body: JSON.stringify(data) }),
  deleteSolo: (soloId) => apiRequest(`/solo/${soloId}`, { method: "DELETE" }),
  expressSoloInterest: (soloId, message = "") =>
    apiRequest(`/solo/${soloId}/interest`, {
      method: "POST",
      body: JSON.stringify({ message: message || null }),
    }),

  // Messaging
  getWsTicket: () => apiRequest("/messages/ws-ticket", { method: "POST" }),
  listConversations: () => apiRequest("/messages/conversations"),
  getConversation: (id) => apiRequest(`/messages/conversations/${id}`),
  sendMessage: (id, content) =>
    apiRequest(`/messages/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  markMessageRead: (messageId) => apiRequest(`/messages/${messageId}/read`, { method: "PUT" }),

  // University Community
  getCommunity: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return apiRequest(`/community${qs.toString() ? `?${qs}` : ""}`, { skipAuthRedirect: true });
  },
  listUniversities: () => apiRequest("/community/universities", { skipAuthRedirect: true }),

  // Safety & Moderation
  blockUser: (userId) => apiRequest(`/safety/block/${userId}`, { method: "POST" }),
  unblockUser: (userId) => apiRequest(`/safety/block/${userId}`, { method: "DELETE" }),
  listBlocked: () => apiRequest("/safety/blocked"),
  reportUser: (data) => apiRequest("/safety/report", { method: "POST", body: JSON.stringify(data) }),
};
