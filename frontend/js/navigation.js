/**
 * Navigation shell (Landing header/footer + Dashboard desktop sidebar, mobile top/bottom bars,
 * and slide-out mobile drawer), shared Firebase Auth session state, Public Profile modal,
 * Safety Block/Report modal, and shared Group 3-dot options menu.
 */
import { onAuthStateChanged } from "firebase/auth";
import { API, setFallbackToken } from "./api.js";
import { CONFIG } from "./config.js";
import { DemoStore } from "./demo-store.js";
import { auth, waitForAuthInit } from "./firebase-client.js";
import { checkForAppUpdate } from "./update-check.js";
import {
  escapeHtml,
  formatRelativeTime,
  getInitials,
  openConfirmDialog,
  openModal,
  qs,
  qsa,
  showToast,
} from "./utils.js";

export const NAV_ITEMS = [
  { id: "discover", label: "Discover", href: "discover.html", icon: "compass", group: "Explore" },
  { id: "feed", label: "Feed", href: "feed.html", icon: "feed", group: "Explore" },
  { id: "events", label: "Events", href: "events.html", icon: "calendar", group: "Explore" },
  { id: "groups", label: "Groups", href: "groups.html", icon: "users", group: "Explore" },
  { id: "matches", label: "Matches", href: "matches.html", icon: "heart", group: "Social" },
  { id: "messages", label: "Messages", href: "messages.html", icon: "message", group: "Social" },
  { id: "profile", label: "Profile", href: "profile.html", icon: "user", group: "Account" },
  { id: "settings", label: "Settings", href: "settings.html", icon: "settings", group: "Account" },
];

export const MOBILE_NAV_ITEMS = [
  { id: "discover", label: "Discover", href: "discover.html", icon: "compass" },
  { id: "feed", label: "Feed", href: "feed.html", icon: "feed" },
  { id: "events", label: "Events", href: "events.html", icon: "calendar" },
  { id: "messages", label: "Messages", href: "messages.html", icon: "message" },
  { id: "profile", label: "Profile", href: "profile.html", icon: "user" },
];

const PROTECTED_PAGES = new Set(["create-event", "matches", "messages", "profile"]);

const ICONS = {
  compass:
    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
  feed:
    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/><line x1="7" y1="17" x2="12" y2="17"/></svg>',
  bell:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  heart:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  message:
    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  user:
    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.79 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  menu:
    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
  dotsVertical:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  leave:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  block:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  flag:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
};

let cachedUserPromise = null;

export async function getCurrentUser(forceRefresh = false) {
  const fbUser = await waitForAuthInit();
  if (!fbUser && !DemoStore.isDemoSession()) {
    cachedUserPromise = null;
    return null;
  }
  if (!cachedUserPromise || forceRefresh) {
    cachedUserPromise = API.me({ skipAuthRedirect: true }).catch(() => null);
  }
  return cachedUserPromise;
}

export async function requireAuthenticatedUser() {
  const user = await getCurrentUser(true);
  if (!user) {
    showToast("Please sign in to access this page.", "info");
    window.location.href = "login.html";
    return null;
  }
  return user;
}

export function renderAvatarHtml(user, large = false) {
  const cls = `avatar-circle${large ? " avatar-lg" : ""}`;
  if (user?.profile_picture) {
    return `<div class="${cls}" style="overflow:hidden;"><img src="${escapeHtml(user.profile_picture)}" alt="${escapeHtml(user.first_name || "User")}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>`;
  }
  return `<div class="${cls}">${escapeHtml(getInitials(user?.first_name, user?.last_name))}</div>`;
}

export function renderHobbyTags(hobbies, maxVisible = 3) {
  if (!Array.isArray(hobbies) || !hobbies.length) return "";
  const shown = maxVisible > 0 ? hobbies.slice(0, maxVisible) : hobbies;
  const remaining = maxVisible > 0 ? Math.max(0, hobbies.length - maxVisible) : 0;
  const tagsHtml = shown
    .map((h) => `<span class="hobby-tag">${escapeHtml(h)}</span>`)
    .join("");
  const moreHtml = remaining > 0 ? `<span class="hobby-tag-more">+${remaining} more</span>` : "";
  return `${tagsHtml}${moreHtml}`;
}

export async function openPublicProfileModal(userIdOrObj, onChanged = null) {
  let profile = typeof userIdOrObj === "object" ? userIdOrObj : null;
  const uid = typeof userIdOrObj === "string" ? userIdOrObj : profile?.id;
  if (uid) {
    try {
      profile = await API.getUserProfile(uid);
    } catch {
      if (!profile) {
        showToast("Could not load public profile.", "error");
        return;
      }
    }
  }
  if (!profile) return;

  const me = await getCurrentUser().catch(() => null);
  const isSelf = me && profile.id === me.id;
  const fullName = `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || profile.username;
  const hobbiesHtml =
    Array.isArray(profile.hobbies) && profile.hobbies.length
      ? `
        <div style="margin-top:1rem;">
          <h3 style="margin-bottom:0.45rem;">Hobbies</h3>
          <div class="hobby-tag-list">${renderHobbyTags(profile.hobbies, 0)}</div>
        </div>
      `
      : "";

  const interestsText =
    Array.isArray(profile.interests) && profile.interests.length
      ? profile.interests.map((i) => i.name).join(" · ")
      : "No interests listed yet";

  const statsHtml =
    typeof profile.followers_count === "number" || typeof profile.following_count === "number"
      ? `
        <div class="profile-stats-row">
          <div class="profile-stat-item">
            <strong class="tabular-num" id="modal-followers-count">${profile.followers_count ?? 0}</strong>
            <span>Followers</span>
          </div>
          <div class="profile-stat-item">
            <strong class="tabular-num">${profile.following_count ?? 0}</strong>
            <span>Following</span>
          </div>
          ${
            profile.follows_me && !isSelf
              ? `<div class="profile-stat-item" style="align-self:center;margin-left:auto;"><span class="badge-inline">Follows you</span></div>`
              : ""
          }
        </div>
      `
      : "";

  const actionsHtml =
    me && !isSelf
      ? `
        <div class="card-actions" style="margin-top:1.15rem;">
          <button type="button" class="btn ${profile.is_following ? "btn-secondary" : "btn-primary"} btn-sm" id="modal-follow-btn">
            ${profile.is_following ? "Following" : "Follow"}
          </button>
          <button type="button" class="btn btn-coral btn-sm" id="modal-message-btn">Message</button>
          <button type="button" class="btn btn-secondary btn-sm" id="modal-safety-btn">Safety</button>
        </div>
      `
      : "";

  openModal({
    title: `${fullName}'s Public Profile`,
    bodyHtml: `
      <div>
        <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;">
          ${renderAvatarHtml(profile, true)}
          <div>
            <h2 style="margin-bottom:0.2rem;">${escapeHtml(fullName)}${profile.age ? `, ${profile.age}` : ""}</h2>
            <div class="muted-small">@${escapeHtml(profile.username)} · ${profile.is_verified ? "Verified student" : "Student account"}</div>
            <div class="muted-small">${escapeHtml(profile.university || "Open student community")}${profile.city ? ` · ${escapeHtml(profile.city)}` : ""}</div>
          </div>
        </div>
        ${statsHtml}
        ${
          profile.compatibility && !isSelf
            ? `
          <div style="padding:0.85rem 1rem;border-radius:var(--radius-md);background:var(--color-primary-tint);border:1px solid var(--color-border);margin-bottom:1rem;">
            <strong class="tabular-num" style="color:var(--color-primary);">${profile.compatibility.compatibility}% compatibility</strong>
            <p class="muted-small" style="margin-top:0.25rem;">${escapeHtml(profile.compatibility.explanation)}</p>
          </div>
        `
            : ""
        }
        <p>${escapeHtml(profile.bio || "Looking forward to concerts, films, and local campus outings.")}</p>
        ${hobbiesHtml}
        <div style="margin-top:1rem;">
          <h3 style="margin-bottom:0.35rem;">Interests</h3>
          <p class="muted-small">${escapeHtml(interestsText)}</p>
        </div>
        ${actionsHtml}
      </div>
    `,
    onMount: (root, close) => {
      const followBtn = qs("#modal-follow-btn", root);
      followBtn?.addEventListener("click", async () => {
        followBtn.disabled = true;
        try {
          const res = await API.toggleFollowUser(profile.id);
          profile.is_following = res.is_following;
          if (typeof res.target_followers_count === "number") {
            const countEl = qs("#modal-followers-count", root);
            if (countEl) countEl.textContent = String(res.target_followers_count);
          }
          followBtn.textContent = res.is_following ? "Following" : "Follow";
          followBtn.className = `btn ${res.is_following ? "btn-secondary" : "btn-primary"} btn-sm`;
          showToast(res.is_following ? `Now following ${fullName}` : `Unfollowed ${fullName}`, "info");
          if (typeof onChanged === "function") onChanged(res);
        } catch (err) {
          showToast(err.message || "Could not update follow status.", "error");
        } finally {
          followBtn.disabled = false;
        }
      });

      const msgBtn = qs("#modal-message-btn", root);
      msgBtn?.addEventListener("click", async () => {
        msgBtn.disabled = true;
        try {
          const res = await API.startDirectChatWithUser(profile.id);
          close();
          window.location.href = `messages.html?conversation=${encodeURIComponent(res.conversation_id)}`;
        } catch (err) {
          showToast(err.message || "Could not open chat.", "error");
          msgBtn.disabled = false;
        }
      });

      qs("#modal-safety-btn", root)?.addEventListener("click", () => {
        openSafetyModal(profile, () => {
          close();
          if (typeof onChanged === "function") onChanged();
        });
      });
    },
  });
}

export function renderLandingHeader(user) {
  const header = qs("#site-header");
  if (header) {
    const desktopActions = user
      ? `
        <a href="profile.html" class="landing-nav-login">Profile</a>
        <a href="discover.html" class="btn btn-primary landing-nav-cta">Open App</a>
      `
      : `
        <a href="login.html" class="landing-nav-login">Log In</a>
        <a href="register.html" class="btn btn-primary landing-nav-cta">Create Account</a>
      `;

    const mobileActions = user
      ? `
        <a href="profile.html" class="btn btn-secondary btn-full">Profile</a>
        <a href="discover.html" class="btn btn-primary btn-full">Open App</a>
      `
      : `
        <a href="login.html" class="btn btn-secondary btn-full">Log In</a>
        <a href="register.html" class="btn btn-primary btn-full">Create Account</a>
      `;

    header.innerHTML = `
      <div class="landing-top-bar container">
        <a href="index.html" class="brand-wordmark">
          <img src="assets/icons/unimeet-logo.svg" alt="" width="28" height="28">
          <span>UniMeet</span>
        </a>
        <nav class="landing-nav-links" aria-label="Main navigation">
          <a href="events.html">Explore Events</a>
          <a href="discover.html?tab=people">Discover People</a>
          <a href="groups.html?tab=solo">Going Solo</a>
          <a href="#how-it-works">How It Works</a>
        </nav>
        <div class="landing-nav-actions">
          ${desktopActions}
        </div>
        <button
          type="button"
          class="landing-menu-btn"
          id="landing-menu-toggle"
          aria-label="Open menu"
          aria-controls="landing-mobile-panel"
          aria-expanded="false"
        >
          ${ICONS.menu}
        </button>
      </div>
      <div class="landing-mobile-panel" id="landing-mobile-panel" hidden>
        <div class="container">
          <nav class="landing-mobile-links" aria-label="Mobile navigation">
            <a href="events.html">Explore Events</a>
            <a href="discover.html?tab=people">Discover People</a>
            <a href="groups.html?tab=solo">Going Solo</a>
            <a href="#how-it-works">How It Works</a>
          </nav>
          <div class="landing-mobile-auth">
            ${mobileActions}
          </div>
        </div>
      </div>
    `;

    const menuBtn = qs("#landing-menu-toggle", header);
    const mobilePanel = qs("#landing-mobile-panel", header);
    if (menuBtn && mobilePanel) {
      const closeMenu = () => {
        mobilePanel.hidden = true;
        menuBtn.setAttribute("aria-expanded", "false");
        menuBtn.setAttribute("aria-label", "Open menu");
      };

      menuBtn.addEventListener("click", () => {
        const nextHidden = !mobilePanel.hidden;
        mobilePanel.hidden = nextHidden;
        menuBtn.setAttribute("aria-expanded", String(!nextHidden));
        menuBtn.setAttribute("aria-label", nextHidden ? "Open menu" : "Close menu");
      });

      qsa("a", mobilePanel).forEach((link) => {
        link.addEventListener("click", closeMenu);
      });

      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && !mobilePanel.hidden) {
          closeMenu();
        }
      });
    }
  }

  const finalCta = qs("#landing-final-account-cta");
  if (finalCta && user) {
    finalCta.href = "discover.html";
    finalCta.textContent = "Open Discover";
  }

  const footer = qs("#site-footer");
  if (footer) {
    footer.innerHTML = `
      <div class="container">
        <div class="landing-footer-grid">
          <div class="landing-footer-brand">
            <a href="index.html" class="brand-wordmark">
              <img src="assets/icons/unimeet-logo.svg" alt="" width="24" height="24">
              <span>UniMeet</span>
            </a>
            <p class="muted-small" style="margin-top:0.55rem;">
              Find your people. Make plans. Go together. Built for university students in Timisoara and beyond.
            </p>
          </div>
          <div class="landing-footer-columns">
            <div class="landing-footer-col">
              <span class="landing-footer-heading">Platform</span>
              <a href="events.html">Explore Events</a>
              <a href="discover.html?tab=people">Discover People</a>
              <a href="groups.html?tab=solo">Going Solo</a>
            </div>
            <div class="landing-footer-col">
              <span class="landing-footer-heading">Account</span>
              ${
                user
                  ? `<a href="discover.html">Open App</a><a href="profile.html">My Profile</a><a href="settings.html">Settings</a>`
                  : `<a href="login.html">Log In</a><a href="register.html">Create Account</a>`
              }
            </div>
            <div class="landing-footer-col">
              <span class="landing-footer-heading">Info</span>
              <button type="button" class="landing-footer-link-btn" data-legal-modal="privacy">Privacy Policy</button>
              <button type="button" class="landing-footer-link-btn" data-legal-modal="terms">Terms of Service</button>
            </div>
          </div>
        </div>
        <div class="landing-footer-bottom">
          <span class="muted-small">UniMeet · Student Event Companion</span>
          <span class="muted-small">Safe, respectful campus &amp; city meetups</span>
        </div>
      </div>
    `;
  }
}

function renderMobileDrawer(user, activePage) {
  let backdrop = qs("#mobile-nav-backdrop");
  let drawer = qs("#mobile-nav-drawer");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "mobile-nav-backdrop";
    backdrop.className = "mobile-nav-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    document.body.appendChild(backdrop);
  }
  if (!drawer) {
    drawer = document.createElement("aside");
    drawer.id = "mobile-nav-drawer";
    drawer.className = "mobile-nav-drawer";
    drawer.setAttribute("aria-label", "Mobile menu");
    drawer.setAttribute("aria-hidden", "true");
    document.body.appendChild(drawer);
  }

  const isCreateOutingPage = activePage === "create-event";
  const sections = ["Explore", "Social", "Account"];
  const sectionHtml = sections
    .map((sec) => {
      const links = NAV_ITEMS.filter((i) => i.group === sec)
        .map(
          (item) => `
          <a href="${item.href}" class="mobile-drawer-link ${activePage === item.id ? "is-active" : ""}">
            ${ICONS[item.icon] || ""}
            <span>${item.label}</span>
          </a>
        `
        )
        .join("");
      return `
        <div class="mobile-drawer-section">
          <div class="mobile-drawer-section-label">${sec}</div>
          ${links}
        </div>
      `;
    })
    .join("");

  const drawerFooter = user
    ? `
      <div class="mobile-drawer-footer">
        <div style="display:flex;align-items:center;gap:0.65rem;min-width:0;">
          ${renderAvatarHtml(user)}
          <div style="min-width:0;">
            <strong class="truncate" style="display:block;font-size:0.9rem;">${escapeHtml(user.first_name)} ${escapeHtml(user.last_name)}</strong>
            <span class="muted-small truncate" style="display:block;">${escapeHtml(user.university || user.city || `@${user.username}`)}</span>
          </div>
        </div>
        <button type="button" class="btn-text-danger" id="drawer-logout-btn">Sign out</button>
      </div>
    `
    : `
      <div class="mobile-drawer-footer">
        <a href="login.html" class="btn btn-primary btn-full">Sign in</a>
      </div>
    `;

  drawer.innerHTML = `
    <div class="mobile-drawer-header">
      <a href="index.html" class="brand-wordmark">
        <img src="assets/icons/unimeet-logo.svg" alt="" width="26" height="26">
        <span>UniMeet</span>
      </a>
      <button type="button" class="icon-btn" id="mobile-drawer-close-btn" aria-label="Close navigation menu">&times;</button>
    </div>
    ${
      isCreateOutingPage
        ? ""
        : `<a href="create-event.html" class="btn btn-primary btn-full" id="drawer-create-outing-btn">Create an outing</a>`
    }
    ${sectionHtml}
    ${drawerFooter}
  `;

  const closeDrawer = () => {
    drawer.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
    qs("#mobile-menu-toggle-btn")?.setAttribute("aria-expanded", "false");
  };

  const openDrawer = () => {
    drawer.classList.add("is-open");
    backdrop.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
    qs("#mobile-menu-toggle-btn")?.setAttribute("aria-expanded", "true");
  };

  qs("#mobile-drawer-close-btn", drawer)?.addEventListener("click", closeDrawer);
  backdrop.onclick = closeDrawer;
  qsa("a", drawer).forEach((link) => {
    link.addEventListener("click", closeDrawer);
  });
  qs("#drawer-logout-btn", drawer)?.addEventListener("click", handleLogout);

  if (!document.body.dataset.drawerEscBound) {
    document.body.dataset.drawerEscBound = "true";
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && qs("#mobile-nav-drawer")?.classList.contains("is-open")) {
        closeDrawer();
      }
    });
  }

  return { openDrawer, closeDrawer };
}

export function updateNavUnreadBadges() {
  const unreadNotifs = API.getUnreadNotificationCount ? API.getUnreadNotificationCount() : 0;
  const unreadMsgs = API.getUnreadMessageCount ? API.getUnreadMessageCount() : 0;

  qsa("[data-badge-notifs]").forEach((el) => {
    if (unreadNotifs > 0) {
      el.hidden = false;
      el.textContent = unreadNotifs > 99 ? "99+" : String(unreadNotifs);
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  });

  qsa("[data-badge-messages]").forEach((el) => {
    if (unreadMsgs > 0) {
      el.hidden = false;
      el.textContent = unreadMsgs > 99 ? "99+" : String(unreadMsgs);
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  });
}

export async function openNotificationsModal() {
  const user = await getCurrentUser();
  if (!user) {
    requireAuthenticatedUser();
    return;
  }

  const renderBody = async () => {
    const list = await API.listNotifications();
    if (!list.length) {
      return `<div class="empty-state"><p>You're all caught up — no notifications right now.</p></div>`;
    }
    const itemsHtml = list
      .map((n) => {
        const avatarHtml = n.actor
          ? renderAvatarHtml(n.actor)
          : `<div class="avatar-circle">UM</div>`;
        const inviteActions =
          n.type === "group_invite"
            ? `
              <div class="card-actions" style="margin-top:0.55rem;">
                <button type="button" class="btn btn-primary btn-sm" data-accept-invite="${escapeHtml(n.target_id)}" data-notif-id="${escapeHtml(n.id)}">Accept invite</button>
                <button type="button" class="btn btn-secondary btn-sm" data-decline-invite="${escapeHtml(n.target_id)}" data-notif-id="${escapeHtml(n.id)}">Decline</button>
              </div>
            `
            : "";

        return `
          <div class="notif-item ${n.is_read ? "" : "is-unread"}" data-notif-row="${escapeHtml(n.id)}">
            ${avatarHtml}
            <div class="notif-item-body">
              <div style="display:flex;align-items:baseline;justify-content:space-between;gap:0.5rem;">
                <span class="notif-item-title">${escapeHtml(n.title)}</span>
                <span class="muted-small tabular-num" style="flex-shrink:0;">${escapeHtml(formatRelativeTime(n.created_at))}</span>
              </div>
              <p class="muted-small" style="margin:0.2rem 0 0;">${escapeHtml(n.body)}</p>
              ${inviteActions}
              <div class="card-actions" style="margin-top:0.45rem;">
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  data-open-notif="${escapeHtml(n.id)}"
                  data-target-type="${escapeHtml(n.target_type || "")}"
                  data-target-id="${escapeHtml(n.target_id || "")}"
                >Open</button>
                ${
                  !n.is_read
                    ? `<button type="button" class="btn btn-secondary btn-sm" data-mark-notif="${escapeHtml(n.id)}">Mark read</button>`
                    : ""
                }
              </div>
            </div>
            ${n.is_read ? "" : `<span class="notif-unread-dot" aria-label="Unread"></span>`}
          </div>
        `;
      })
      .join("");

    return `<div class="notif-list">${itemsHtml}</div>`;
  };

  const initialHtml = await renderBody();

  openModal({
    title: "Notifications & Activity",
    headerActionsHtml: `<button type="button" class="btn btn-secondary btn-sm" id="mark-all-notifs-btn">Mark all read</button>`,
    bodyHtml: `<div id="notifications-modal-body">${initialHtml}</div>`,
    onMount: (root, close) => {
      const bindEvents = () => {
        qsa("[data-mark-notif]", root).forEach((btn) => {
          btn.addEventListener("click", async () => {
            await API.markNotificationRead(btn.dataset.markNotif);
            qs("#notifications-modal-body", root).innerHTML = await renderBody();
            updateNavUnreadBadges();
            bindEvents();
          });
        });

        qsa("[data-accept-invite]", root).forEach((btn) => {
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            try {
              await API.joinGroup(btn.dataset.acceptInvite);
              await API.markNotificationRead(btn.dataset.notifId);
              showToast("Joined group!", "success");
              qs("#notifications-modal-body", root).innerHTML = await renderBody();
              updateNavUnreadBadges();
              bindEvents();
            } catch (err) {
              showToast(err.message || "Could not accept invite.", "error");
              btn.disabled = false;
            }
          });
        });

        qsa("[data-decline-invite]", root).forEach((btn) => {
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            try {
              await API.declineGroupInvite(btn.dataset.declineInvite);
              showToast("Invitation declined.", "info");
              qs("#notifications-modal-body", root).innerHTML = await renderBody();
              updateNavUnreadBadges();
              bindEvents();
            } catch (err) {
              showToast(err.message || "Could not decline invite.", "error");
              btn.disabled = false;
            }
          });
        });

        qsa("[data-open-notif]", root).forEach((btn) => {
          btn.addEventListener("click", async () => {
            const notifId = btn.dataset.openNotif;
            const targetType = btn.dataset.targetType;
            const targetId = btn.dataset.targetId;
            await API.markNotificationRead(notifId);
            updateNavUnreadBadges();
            close();
            if (targetType === "conversation" && targetId) {
              window.location.href = `messages.html?conversation=${encodeURIComponent(targetId)}`;
            } else if (targetType === "post" && targetId) {
              window.location.href = `feed.html?post=${encodeURIComponent(targetId)}`;
            } else if (targetType === "event" && targetId) {
              window.location.href = `events.html?event=${encodeURIComponent(targetId)}`;
            } else if (targetType === "group" && targetId) {
              window.location.href = `groups.html?group=${encodeURIComponent(targetId)}`;
            } else if (targetType === "profile" && targetId) {
              openPublicProfileModal(targetId);
            }
          });
        });
      };

      bindEvents();

      qs("#mark-all-notifs-btn", root)?.addEventListener("click", async () => {
        await API.markAllNotificationsRead();
        qs("#notifications-modal-body", root).innerHTML = await renderBody();
        updateNavUnreadBadges();
        bindEvents();
      });
    },
  });
}

export function renderDashboardShell(user) {
  const sidebar = qs("#app-sidebar");
  const bottomNav = qs("#mobile-bottom-nav");
  const activePage = document.body?.dataset?.page || "";
  const isCreateOutingPage = activePage === "create-event";

  if (sidebar) {
    const navLinks = NAV_ITEMS.map((item) => {
      const msgBadge =
        item.id === "messages"
          ? `<span class="nav-unread-badge" data-badge-messages hidden></span>`
          : "";
      return `
      <a href="${item.href}" class="sidebar-link ${activePage === item.id ? "is-active" : ""}">
        ${ICONS[item.icon] || ""}
        <span>${item.label}</span>
        ${msgBadge}
      </a>
    `;
    }).join("");

    const notifButtonHtml = user
      ? `
      <button type="button" class="sidebar-link sidebar-notif-btn" id="sidebar-notifications-btn">
        ${ICONS.bell}
        <span>Notifications</span>
        <span class="nav-unread-badge" data-badge-notifs hidden></span>
      </button>
    `
      : "";

    const userCard = user
      ? `
      <div class="sidebar-user">
        ${renderAvatarHtml(user)}
        <div class="sidebar-user-meta">
          <strong class="truncate">${escapeHtml(user.first_name)} ${escapeHtml(user.last_name)}</strong>
          <span class="muted-small truncate">${escapeHtml(user.university || user.city || `@${user.username}`)}</span>
        </div>
        <button type="button" class="btn-text-danger" id="logout-btn">Sign out</button>
      </div>
    `
      : `
      <div class="sidebar-user">
        <a href="login.html" class="btn btn-secondary btn-full">Sign in</a>
      </div>
    `;

    sidebar.innerHTML = `
      <div class="sidebar-inner">
        <a href="index.html" class="brand-wordmark">
          <img src="assets/icons/unimeet-logo.svg" alt="" width="28" height="28">
          <span>UniMeet</span>
        </a>
        ${
          isCreateOutingPage
            ? ""
            : `<a href="create-event.html" class="btn btn-primary btn-full sidebar-cta" id="sidebar-create-outing-btn">Create an outing</a>`
        }
        <nav class="sidebar-nav" aria-label="Dashboard sections">
          ${navLinks}
          ${notifButtonHtml}
        </nav>
        ${userCard}
      </div>
    `;

    qs("#sidebar-notifications-btn", sidebar)?.addEventListener("click", openNotificationsModal);

    const logoutBtn = qs("#logout-btn", sidebar);
    if (logoutBtn) {
      logoutBtn.addEventListener("click", handleLogout);
    }
  }

  const drawerControls = renderMobileDrawer(user, activePage);

  const appMain = qs("#main-content");
  if (appMain) {
    let mobileHeader = qs(".mobile-top-bar", appMain);
    const pageTitle = document.title.split("—")[0].trim() || "UniMeet";
    if (!mobileHeader) {
      mobileHeader = document.createElement("header");
      mobileHeader.className = "mobile-top-bar";
      appMain.prepend(mobileHeader);
    }
    mobileHeader.innerHTML = `
      <div class="mobile-top-left">
        <button
          type="button"
          class="mobile-hamburger-btn"
          id="mobile-menu-toggle-btn"
          aria-label="Open navigation menu"
          aria-controls="mobile-nav-drawer"
          aria-expanded="false"
        >
          ${ICONS.menu}
        </button>
        <a href="index.html" class="brand-wordmark" aria-label="UniMeet home">
          <img src="assets/icons/unimeet-logo.svg" alt="" width="24" height="24">
        </a>
        <span class="mobile-page-title truncate">${escapeHtml(pageTitle)}</span>
      </div>
      <div class="mobile-top-actions">
        ${
          user
            ? `<button type="button" class="mobile-icon-link" id="mobile-notifications-btn" aria-label="Notifications" title="Notifications" style="background:transparent;border:none;cursor:pointer;">
                 ${ICONS.bell}
                 <span class="mobile-badge-dot" data-badge-notifs hidden></span>
               </button>`
            : ""
        }
        <a href="matches.html" class="mobile-icon-link ${activePage === "matches" ? "is-active" : ""}" aria-label="Matches" title="Matches">
          ${ICONS.heart}
        </a>
        <a href="settings.html" class="mobile-icon-link ${activePage === "settings" ? "is-active" : ""}" aria-label="Settings" title="Settings">
          ${ICONS.settings}
        </a>
        ${
          isCreateOutingPage
            ? ""
            : `<a href="create-event.html" class="mobile-icon-link" id="mobile-create-outing-btn" aria-label="Create outing" title="Create outing">${ICONS.plus}</a>`
        }
      </div>
    `;
    qs("#mobile-menu-toggle-btn", mobileHeader)?.addEventListener("click", drawerControls.openDrawer);
    qs("#mobile-notifications-btn", mobileHeader)?.addEventListener("click", openNotificationsModal);
  }

  if (bottomNav) {
    bottomNav.innerHTML = MOBILE_NAV_ITEMS.map(
      (item) => `
      <a href="${item.href}" class="bottom-nav-link ${activePage === item.id ? "is-active" : ""}">
        ${ICONS[item.icon] || ""}
        <span>${item.label}</span>
      </a>
    `
    ).join("");
  }

  if (user) {
    updateNavUnreadBadges();
  }
}

async function handleLogout() {
  try {
    await API.logout();
  } catch {
    // Clear local state regardless
  }
  cachedUserPromise = null;
  setFallbackToken("");
  window.location.href = "login.html";
}

export function buildGroupMenuHtml(group, currentUser) {
  const isMember = Boolean(group?.is_member);
  const canLeave = isMember;
  const targetable = Boolean(currentUser);
  if (!targetable) return "";

  return `
    <div class="options-menu-wrap" data-group-menu-wrap>
      <button
        type="button"
        class="options-dots-btn is-header-btn"
        id="group-options-trigger"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-label="Group options"
        title="Group options"
      >
        ${ICONS.dotsVertical}
      </button>
      <div class="options-dropdown" id="group-options-dropdown" role="menu" hidden>
        ${
          canLeave
            ? `
          <button type="button" class="options-dropdown-item" role="menuitem" data-group-action="leave">
            ${ICONS.leave}
            <span>Leave group</span>
          </button>
        `
            : ""
        }
        <button type="button" class="options-dropdown-item" role="menuitem" data-group-action="block">
          ${ICONS.block}
          <span>Block</span>
        </button>
        <button type="button" class="options-dropdown-item is-danger" role="menuitem" data-group-action="report">
          ${ICONS.flag}
          <span>Report</span>
        </button>
      </div>
    </div>
  `;
}

export function wireGroupMenuActions({
  container,
  groupId,
  groupName,
  creatorId,
  currentUser,
  onLeft,
  onBlocked,
}) {
  const wrap = qs("[data-group-menu-wrap]", container);
  if (!wrap) return;

  const trigger = qs("#group-options-trigger", wrap);
  const dropdown = qs("#group-options-dropdown", wrap);

  const closeMenu = () => {
    dropdown.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };

  trigger.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const nextHidden = !dropdown.hidden;
    dropdown.hidden = nextHidden;
    trigger.setAttribute("aria-expanded", String(!nextHidden));
  });

  document.addEventListener(
    "click",
    (ev) => {
      if (!wrap.isConnected) return;
      if (!wrap.contains(ev.target)) closeMenu();
    },
    { capture: true }
  );

  const resolveCandidates = async () => {
    const members = await API.getGroupMembers(groupId).catch(() => []);
    const candidates = (members || [])
      .map((m) => m.user)
      .filter((u) => u && (!currentUser || u.id !== currentUser.id));
    if (!candidates.length && creatorId && (!currentUser || creatorId !== currentUser.id)) {
      const creatorProfile = await API.getUserProfile(creatorId).catch(() => null);
      if (creatorProfile) candidates.push(creatorProfile);
    }
    return candidates;
  };

  qs('[data-group-action="leave"]', dropdown)?.addEventListener("click", () => {
    closeMenu();
    openConfirmDialog({
      title: `Leave ${groupName || "group"}?`,
      message: "You will be removed from this group and its group conversation. You can rejoin later if the group is open.",
      confirmLabel: "Leave group",
      destructive: true,
      onConfirm: async (close) => {
        await API.leaveGroup(groupId);
        close();
        if (typeof onLeft === "function") onLeft();
      },
    });
  });

  qs('[data-group-action="block"]', dropdown)?.addEventListener("click", async () => {
    closeMenu();
    if (!currentUser) {
      requireAuthenticatedUser();
      return;
    }
    const candidates = await resolveCandidates();
    if (!candidates.length) {
      showToast("No other group member is available to block.", "error");
      return;
    }

    const defaultTarget = candidates.find((c) => c.id === creatorId) || candidates[0];
    const optionsHtml = candidates
      .map((u) => {
        const label = `${u.first_name || ""} ${u.last_name || ""}`.trim() || `@${u.username}`;
        const tag = u.id === creatorId ? " (Group host)" : "";
        return `<option value="${escapeHtml(u.id)}">${escapeHtml(label)}${tag}</option>`;
      })
      .join("");

    openModal({
      title: `Block from ${groupName || "group"}`,
      bodyHtml: `
        <form id="group-block-form" class="stack-form">
          <p class="muted-small">Blocking prevents this person from messaging you or appearing in your discovery, matches, and groups.</p>
          ${
            candidates.length > 1
              ? `
            <div class="field">
              <label for="group-block-select">Select member to block</label>
              <select id="group-block-select">${optionsHtml}</select>
            </div>
          `
              : `<p><strong>Member:</strong> ${escapeHtml(`${defaultTarget.first_name} ${defaultTarget.last_name}`)}</p>`
          }
          <div id="group-block-error" class="form-alert form-alert-error" hidden></div>
          <div class="card-actions" style="justify-content:flex-end;margin-top:0;">
            <button type="button" class="btn btn-secondary" id="group-block-cancel">Cancel</button>
            <button type="submit" class="btn btn-danger" id="group-block-submit">Block user</button>
          </div>
        </form>
      `,
      onMount: (modalRoot, close) => {
        qs("#group-block-cancel", modalRoot).addEventListener("click", close);
        qs("#group-block-form", modalRoot).addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const selectEl = qs("#group-block-select", modalRoot);
          const targetId = selectEl ? selectEl.value : defaultTarget.id;
          const submitBtn = qs("#group-block-submit", modalRoot);
          const errEl = qs("#group-block-error", modalRoot);
          submitBtn.disabled = true;
          submitBtn.textContent = "Blocking...";
          errEl.hidden = true;
          try {
            await API.blockUser(targetId);
            close();
            if (typeof onBlocked === "function") onBlocked(targetId);
          } catch (err) {
            errEl.hidden = false;
            errEl.textContent = err?.message || "Could not block user.";
            submitBtn.disabled = false;
            submitBtn.textContent = "Block user";
          }
        });
      },
    });
  });

  qs('[data-group-action="report"]', dropdown)?.addEventListener("click", async () => {
    closeMenu();
    if (!currentUser) {
      requireAuthenticatedUser();
      return;
    }
    const candidates = await resolveCandidates();
    if (!candidates.length) {
      showToast("No group member is available to report.", "error");
      return;
    }

    const defaultTarget = candidates.find((c) => c.id === creatorId) || candidates[0];
    const memberOptions = candidates
      .map((u) => {
        const label = `${u.first_name || ""} ${u.last_name || ""}`.trim() || `@${u.username}`;
        const tag = u.id === creatorId ? " (Group host)" : "";
        return `<option value="${escapeHtml(u.id)}">${escapeHtml(label)}${tag}</option>`;
      })
      .join("");
    const reasonsOptions = CONFIG.REPORT_REASONS.map(
      (r) => `<option value="${escapeHtml(r.value)}">${escapeHtml(r.label)}</option>`
    ).join("");

    openModal({
      title: `Report ${groupName || "Group"}`,
      bodyHtml: `
        <form id="group-report-form" class="stack-form">
          <p class="muted-small">Send a moderation report for review. Reports remain confidential.</p>
          ${
            candidates.length > 1
              ? `
            <div class="field">
              <label for="group-report-user">Account to report</label>
              <select id="group-report-user">${memberOptions}</select>
            </div>
          `
              : ""
          }
          <div class="field">
            <label for="group-report-reason">Reason</label>
            <select id="group-report-reason" required>${reasonsOptions}</select>
          </div>
          <div class="field">
            <label for="group-report-desc">Additional details (optional)</label>
            <textarea id="group-report-desc" rows="3" maxlength="1500" placeholder="Share context for our moderation team..."></textarea>
          </div>
          <div id="group-report-feedback" class="form-alert" hidden></div>
          <div class="card-actions" style="justify-content:flex-end;margin-top:0;">
            <button type="button" class="btn btn-secondary" id="group-report-cancel">Close</button>
            <button type="submit" class="btn btn-danger" id="group-report-submit">Submit report</button>
          </div>
        </form>
      `,
      onMount: (modalRoot, close) => {
        qs("#group-report-cancel", modalRoot).addEventListener("click", close);
        qs("#group-report-form", modalRoot).addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const selectEl = qs("#group-report-user", modalRoot);
          const reportedId = selectEl ? selectEl.value : defaultTarget.id;
          const reason = qs("#group-report-reason", modalRoot).value;
          const rawDesc = qs("#group-report-desc", modalRoot).value.trim();
          const feedback = qs("#group-report-feedback", modalRoot);
          const submitBtn = qs("#group-report-submit", modalRoot);

          submitBtn.disabled = true;
          submitBtn.textContent = "Submitting...";
          feedback.hidden = true;
          try {
            await API.reportUser({
              reported_user_id: reportedId,
              reason,
              description: rawDesc ? `[Group: ${groupName}] ${rawDesc}` : `Reported from group: ${groupName}`,
            });
            feedback.hidden = false;
            feedback.className = "form-alert form-alert-success";
            feedback.textContent = "Your report has been submitted for moderation review.";
            submitBtn.hidden = true;
            qs("#group-report-cancel", modalRoot).textContent = "Done";
          } catch (err) {
            feedback.hidden = false;
            feedback.className = "form-alert form-alert-error";
            feedback.textContent = err?.message || "Could not submit report.";
            submitBtn.disabled = false;
            submitBtn.textContent = "Submit report";
          }
        });
      },
    });
  });
}

export function openSafetyModal(targetUser, onBlocked) {
  const fullName = `${targetUser.first_name || ""} ${targetUser.last_name || ""}`.trim() || targetUser.username;
  const reasonsOptions = CONFIG.REPORT_REASONS.map(
    (r) => `<option value="${escapeHtml(r.value)}">${escapeHtml(r.label)}</option>`
  ).join("");

  openModal({
    title: `Safety options for ${fullName}`,
    bodyHtml: `
      <div class="safety-modal-stack">
        <div class="safety-tips-box">
          <h3>Safe meeting reminders</h3>
          <p style="margin-bottom:0;">Always choose public campus or city-center venues for a first meetup, let a friend know where you are going, and keep chats inside UniMeet until you feel comfortable.</p>
        </div>

        <form id="safety-report-form" class="stack-form">
          <h3>Report ${escapeHtml(fullName)}</h3>
          <div id="safety-report-feedback" class="form-alert" hidden></div>
          <div class="field">
            <label for="report-reason">Reason</label>
            <select id="report-reason" required>${reasonsOptions}</select>
          </div>
          <div class="field">
            <label for="report-desc">Details (optional)</label>
            <textarea id="report-desc" rows="3" maxlength="1500" placeholder="Describe what happened so moderators can review..."></textarea>
          </div>
          <button type="submit" class="btn btn-secondary" id="safety-report-submit">Submit report</button>
        </form>

        <div class="divider-line"></div>

        <div class="safety-block-zone">
          <h3>Block ${escapeHtml(fullName)}</h3>
          <p class="muted-small" style="margin-bottom:0.75rem;">Blocking hides you from each other across discovery, groups, solo posts, and messaging. You can manage blocked accounts later in Profile.</p>
          <button type="button" class="btn btn-danger" id="confirm-block-btn">Block user</button>
        </div>
      </div>
    `,
    onMount: (root, close) => {
      qs("#safety-report-form", root).addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const reason = qs("#report-reason", root).value;
        const description = qs("#report-desc", root).value.trim();
        const feedback = qs("#safety-report-feedback", root);
        const submitBtn = qs("#safety-report-submit", root);
        submitBtn.disabled = true;
        try {
          await API.reportUser({
            reported_user_id: targetUser.id,
            reason,
            description: description || null,
          });
          feedback.hidden = false;
          feedback.className = "form-alert form-alert-success";
          feedback.textContent = "Report submitted for moderation review.";
          submitBtn.textContent = "Report submitted";
        } catch (err) {
          feedback.hidden = false;
          feedback.className = "form-alert form-alert-error";
          feedback.textContent = err.message;
          submitBtn.disabled = false;
        }
      });

      const blockBtn = qs("#confirm-block-btn", root);
      blockBtn.addEventListener("click", async () => {
        if (blockBtn.dataset.armed !== "true") {
          blockBtn.dataset.armed = "true";
          blockBtn.textContent = `Confirm block ${fullName}`;
          return;
        }
        try {
          await API.blockUser(targetUser.id);
          close();
          if (typeof onBlocked === "function") onBlocked(targetUser.id);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    },
  });
}

export async function initNavigation() {
  const page = document.body?.dataset?.page || "";
  if (page === "landing") {
    const user = await getCurrentUser();
    renderLandingHeader(user);
    return;
  }
  if (page === "login" || page === "register" || page === "reset-password") {
    return;
  }

  let authSettled = false;
  onAuthStateChanged(auth, (fbUser) => {
    if (!authSettled) {
      authSettled = true;
      return;
    }
    if (!fbUser && !DemoStore.isDemoSession() && PROTECTED_PAGES.has(page)) {
      window.location.href = "login.html";
    }
  });

  const user = await getCurrentUser();
  renderDashboardShell(user);

  if (user && !document.body.dataset.demoBadgesSubscribed) {
    document.body.dataset.demoBadgesSubscribed = "true";
    API.subscribeToNotifications(() => updateNavUnreadBadges());
    API.subscribeToConversations(user, () => updateNavUnreadBadges());
  }
}

document.addEventListener("DOMContentLoaded", initNavigation);
// Android app only: tell the user when a newer APK release is available.
document.addEventListener("DOMContentLoaded", () => {
  checkForAppUpdate().catch(() => {});
});
