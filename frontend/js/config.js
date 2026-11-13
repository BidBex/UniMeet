/**
 * Centralized frontend configuration for UniMeet.
 * Supports both same-origin FastAPI serving (http://localhost:8000) and standalone static server.
 */
const standaloneStaticPorts = new Set(["5500", "5173", "3000", "4173"]);
const isSameOriginServer =
  window.location.protocol.startsWith("http") &&
  !standaloneStaticPorts.has(window.location.port);

const defaultApiBase = isSameOriginServer
  ? `${window.location.origin}/api`
  : "http://localhost:8000/api";

const defaultWsBase = defaultApiBase.replace(/^http/, "ws");

export const CONFIG = {
  APP_NAME: "UniMeet",
  API_BASE_URL: window.UNIMEET_API_BASE_URL || defaultApiBase,
  WS_BASE_URL: window.UNIMEET_WS_BASE_URL || defaultWsBase,
  USE_MOCK_API: false,
  REQUEST_TIMEOUT_MS: 12000,
  EVENT_CATEGORIES: [
    "Concerts",
    "Parties",
    "Cinema",
    "Theatre",
    "Festivals",
    "Sports",
    "Food",
    "Travel",
    "Gaming",
    "Other",
  ],
  EVENT_IMAGE_PRESETS: [
    { label: "Live Courtyard Concert", url: "assets/images/hero-concert.jpg" },
    { label: "Square Music Festival", url: "assets/images/event-festival.jpg" },
    { label: "Rooftop Indie Cinema", url: "assets/images/event-cinema.jpg" },
    { label: "Cafe & Board Games", url: "assets/images/event-boardgames.jpg" },
  ],
  REPORT_REASONS: [
    { value: "harassment", label: "Harassment or unwanted behavior" },
    { value: "spam", label: "Spam or promotion" },
    { value: "inappropriate_content", label: "Inappropriate content" },
    { value: "fake_profile", label: "Impersonation or misleading profile" },
    { value: "safety_concern", label: "Personal safety concern" },
    { value: "other", label: "Other" },
  ],
};
