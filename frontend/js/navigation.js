/**
 * Navigation and dashboard shell module (Landing header & Dashboard sidebar/bottom nav in Stages 3 & 5).
 */

export const NAV_ITEMS = [
  { id: "discover", label: "Discover", href: "discover.html" },
  { id: "events", label: "Events", href: "events.html" },
  { id: "groups", label: "Groups", href: "groups.html" },
  { id: "matches", label: "Matches", href: "matches.html" },
  { id: "messages", label: "Messages", href: "messages.html" },
  { id: "profile", label: "Profile", href: "profile.html" },
];

export function initNavigation() {
  const activePage = document.body?.dataset?.page || "";
  document.documentElement.dataset.activePage = activePage;
}

document.addEventListener("DOMContentLoaded", initNavigation);
