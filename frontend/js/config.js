/**
 * Centralized frontend configuration for UniMeet.
 * Keeps real FastAPI integration clearly separated from optional mock development mode.
 */
export const CONFIG = {
  APP_NAME: "UniMeet",
  API_BASE_URL: window.UNIMEET_API_BASE_URL || "http://localhost:8000/api",
  WS_BASE_URL: window.UNIMEET_WS_BASE_URL || "ws://localhost:8000/ws",
  USE_MOCK_API: true,
  REQUEST_TIMEOUT_MS: 10000,
};
