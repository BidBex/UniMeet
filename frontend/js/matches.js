/**
 * Mutual matches & liked events screen:
 * view mutual people matches and liked events (with creator chat links), unmatch, unlike, or report/block.
 */
import { API } from "./api.js";
import { openSafetyModal, requireAuthenticatedUser } from "./navigation.js";
import {
  escapeHtml,
  formatDateTime,
  getInitials,
  qs,
  qsa,
  renderMediaWithFallback,
  showToast,
} from "./utils.js";

const matchesState = {
  user: null,
  activeTab: "all",
  matches: [],
  likedEvents: [],
};

function renderPeopleSection(matches) {
  if (!matches.length) {
    return `
      <div class="empty-state" style="margin-bottom:1.5rem;">
        <h2>No mutual people matches yet</h2>
        <p>Head over to Discover and like people interested in the same events as you.</p>
        <a href="discover.html" class="btn btn-primary">Explore Discover</a>
      </div>
    `;
  }

  return `
    <section style="margin-bottom:2rem;">
      <h2 style="margin-bottom:1rem;">People Matches (${matches.length})</h2>
      <div class="cards-grid">
        ${matches
          .map((m) => {
            const u = m.other_user;
            const fullName = `${u.first_name} ${u.last_name}`;
            const compat = u.compatibility;
            return `
              <article class="card">
                <div class="card-body">
                  <div style="display:flex;align-items:center;gap:0.9rem;margin-bottom:0.9rem;">
                    <div class="avatar-circle">${escapeHtml(getInitials(u.first_name, u.last_name))}</div>
                    <div>
                      <h3 style="margin-bottom:0.15rem;">${escapeHtml(fullName)}</h3>
                      <div class="muted-small">${escapeHtml(u.university || u.city || `@${u.username}`)}</div>
                    </div>
                  </div>
                  <div class="meta-line">
                    <span>Event: <strong>${escapeHtml(m.event_title)}</strong></span>
                    ${
                      compat
                        ? `<span aria-hidden="true">·</span><span class="tabular-num accent-highlight">${compat.compatibility}% match</span>`
                        : ""
                    }
                  </div>
                  <p>${escapeHtml(u.bio || "Matched for this outing.")}</p>
                  <p class="muted-small tabular-num">Matched ${escapeHtml(formatDateTime(m.created_at))}</p>
                  <div class="card-actions">
                    <a href="messages.html?conversation=${m.conversation_id || ""}" class="btn btn-primary btn-sm">Open chat</a>
                    <button type="button" class="btn btn-secondary btn-sm" data-safety-id="${u.id}">Safety</button>
                    <button type="button" class="btn btn-text-danger" data-unmatch-id="${m.id}">Unmatch</button>
                  </div>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderLikedEventsSection(likedEvents) {
  if (!likedEvents.length) {
    return `
      <div class="empty-state" style="margin-bottom:1.5rem;">
        <h2>No liked events saved yet</h2>
        <p>Like an event in Discover or Events to save it here and receive a message from its creator.</p>
        <a href="events.html" class="btn btn-primary">Browse Events</a>
      </div>
    `;
  }

  return `
    <section style="margin-bottom:2rem;">
      <h2 style="margin-bottom:1rem;">Liked Events (${likedEvents.length})</h2>
      <div class="cards-grid">
        ${likedEvents
          .map((item) => {
            const ev = item.event;
            const creator = item.creator;
            const isSelfCreator = matchesState.user && creator.id === matchesState.user.id;
            const creatorName = isSelfCreator ? "You" : `${creator.first_name} ${creator.last_name}`;
            const chatHref = item.conversation_id
              ? `messages.html?conversation=${item.conversation_id}`
              : "messages.html";
            return `
              <article class="card">
                ${renderMediaWithFallback(ev.image_url, ev.title, ev.category)}
                <div class="card-body">
                  <div class="meta-line">
                    <span>${escapeHtml(ev.category)}</span>
                    <span aria-hidden="true">·</span>
                    <span>${escapeHtml(ev.city)}</span>
                    <span aria-hidden="true">·</span>
                    <span class="tabular-num">${escapeHtml(formatDateTime(ev.start_datetime))}</span>
                  </div>
                  <h3>${escapeHtml(ev.title)}</h3>
                  <p class="muted-small" style="margin-bottom:0.5rem;">
                    Hosted by <strong>${escapeHtml(creatorName)}</strong>${creator.university ? ` · ${escapeHtml(creator.university)}` : ""}
                  </p>
                  <p>${escapeHtml(ev.description.slice(0, 110))}${ev.description.length > 110 ? "..." : ""}</p>
                  <div class="card-actions">
                    ${
                      isSelfCreator
                        ? `<a href="events.html" class="btn btn-primary btn-sm">View Event</a>`
                        : `<a href="${chatHref}" class="btn btn-coral btn-sm">Message Creator</a>`
                    }
                    <button type="button" class="btn btn-secondary btn-sm" data-unlike-event-id="${ev.id}">Remove</button>
                  </div>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderMatchesView() {
  const container = qs("#matches-container");
  if (!container) return;

  const { activeTab, matches, likedEvents } = matchesState;

  if (activeTab === "events") {
    container.innerHTML = renderLikedEventsSection(likedEvents);
  } else if (activeTab === "people") {
    container.innerHTML = renderPeopleSection(matches);
  } else {
    if (!matches.length && !likedEvents.length) {
      container.innerHTML = `
        <div class="empty-state">
          <h2>No matches or liked events yet</h2>
          <p>Like events or swipe on people in Discover to build your matches and event chats.</p>
          <a href="discover.html" class="btn btn-primary">Explore Discover</a>
        </div>
      `;
      return;
    }
    container.innerHTML = `${renderLikedEventsSection(likedEvents)}${renderPeopleSection(matches)}`;
  }

  qsa("[data-safety-id]", container).forEach((btn) => {
    btn.addEventListener("click", () => {
      const uid = Number(btn.dataset.safetyId);
      const matchObj = matches.find((m) => m.other_user.id === uid);
      if (matchObj) openSafetyModal(matchObj.other_user, loadMatches);
    });
  });

  qsa("[data-unmatch-id]", container).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.armed !== "true") {
        btn.dataset.armed = "true";
        btn.textContent = "Confirm unmatch";
        return;
      }
      try {
        await API.deleteMatch(Number(btn.dataset.unmatchId));
        showToast("Match removed.", "info");
        loadMatches();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  qsa("[data-unlike-event-id]", container).forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await API.unlikeEvent(Number(btn.dataset.unlikeEventId));
        showToast("Removed event from Matches.", "info");
        loadMatches();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

async function loadMatches() {
  const container = qs("#matches-container");
  if (!container) return;

  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading matches &amp; liked events...</p>
    </div>
  `;

  try {
    const [matches, likedEvents] = await Promise.all([
      API.listMatches(),
      API.listLikedEvents(),
    ]);
    matchesState.matches = matches || [];
    matchesState.likedEvents = likedEvents || [];
    renderMatchesView();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.body?.dataset?.page !== "matches") return;
  const user = await requireAuthenticatedUser();
  if (!user) return;
  matchesState.user = user;

  qsa("[data-match-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa("[data-match-tab]").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      matchesState.activeTab = btn.dataset.matchTab;
      renderMatchesView();
    });
  });

  await loadMatches();
});
