/**
 * Tinder-style swipe discovery interface for Events, People, Groups, and Going Solo.
 * Supports touch/pointer drag gestures, keyboard ArrowLeft/ArrowRight, animated exits,
 * duplicate-like prevention, and real backend match confirmation animations.
 */
import { API } from "./api.js";
import { getCurrentUser, openSafetyModal, requireAuthenticatedUser } from "./navigation.js";
import {
  escapeHtml,
  formatDateTime,
  getInitials,
  openModal,
  qs,
  qsa,
  renderMediaWithFallback,
  showToast,
} from "./utils.js";

const state = {
  user: null,
  activeTab: "events",
  cards: [],
  actedIds: new Set(),
  eventsForContext: [],
  filters: { city: "", university: "" },
  busy: false,
};

function currentCard() {
  return state.cards[0] || null;
}

function renderLoading() {
  qs("#swipe-actions").hidden = true;
  qs("#deck-container").innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading ${escapeHtml(state.activeTab)}...</p>
    </div>
  `;
}

function renderEmptyState() {
  qs("#swipe-actions").hidden = true;
  qs("#deck-container").innerHTML = `
    <div class="empty-state">
      <h2>You're all caught up</h2>
      <p>No more ${escapeHtml(state.activeTab)} match your current filters right now.</p>
      <div class="card-actions" style="justify-content:center;">
        <button type="button" class="btn btn-secondary" id="empty-reset-btn">Clear filters &amp; reload</button>
        <a href="create-event.html" class="btn btn-primary">Create an outing</a>
      </div>
    </div>
  `;
  qs("#empty-reset-btn")?.addEventListener("click", () => {
    state.filters = { city: "", university: "" };
    qs("#disc-city").value = "";
    qs("#disc-uni").value = "";
    state.actedIds.clear();
    loadDeck();
  });
}

function renderCardMarkup(item) {
  if (state.activeTab === "events") {
    const capText = item.max_participants
      ? `${item.participant_count}/${item.max_participants} going`
      : `${item.participant_count} going`;
    return `
      <article class="swipe-card" id="active-swipe-card">
        <div class="swipe-card-media">
          ${renderMediaWithFallback(item.image_url, item.title, item.category)}
          <div class="swipe-stamp swipe-stamp-like">LIKE</div>
          <div class="swipe-stamp swipe-stamp-skip">SKIP</div>
          <div class="swipe-card-scrim">
            <h2>${escapeHtml(item.title)}</h2>
            <div class="meta-line">
              <span>${escapeHtml(item.category)}</span>
              <span aria-hidden="true">·</span>
              <span>${escapeHtml(item.city)}</span>
            </div>
          </div>
        </div>
        <div class="card-body">
          <div class="meta-line tabular-num">
            <span>${escapeHtml(formatDateTime(item.start_datetime))}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(item.location)}</span>
          </div>
          <p>${escapeHtml(item.description)}</p>
          <div class="meta-line tabular-num">
            <span>${escapeHtml(capText)}</span>
            <span aria-hidden="true">·</span>
            <span>${item.like_count} interested</span>
            ${item.university ? `<span aria-hidden="true">·</span><span>${escapeHtml(item.university)}</span>` : ""}
          </div>
        </div>
      </article>
    `;
  }

  if (state.activeTab === "people") {
    const compat = item.compatibility;
    const score = compat ? compat.compatibility : 0;
    const shared = compat?.shared_interests?.length
      ? compat.shared_interests.join(", ")
      : (item.interests || []).slice(0, 3).map((i) => i.name).join(", ") || "Open to new outings";
    const fullName = `${item.first_name} ${item.last_name}`;

    return `
      <article class="swipe-card" id="active-swipe-card">
        <div class="swipe-card-media">
          ${
            item.profile_picture
              ? renderMediaWithFallback(item.profile_picture, fullName, getInitials(item.first_name, item.last_name))
              : `<div class="media-fallback"><span class="media-fallback-mark">${escapeHtml(getInitials(item.first_name, item.last_name))}</span></div>`
          }
          <div class="swipe-stamp swipe-stamp-like">LIKE</div>
          <div class="swipe-stamp swipe-stamp-skip">SKIP</div>
          <div class="swipe-card-scrim">
            <h2>${escapeHtml(fullName)}${item.age ? `, ${item.age}` : ""}</h2>
            <div class="meta-line">
              <span>${escapeHtml(item.university || "Student community")}</span>
              ${item.city ? `<span aria-hidden="true">·</span><span>${escapeHtml(item.city)}</span>` : ""}
            </div>
          </div>
        </div>
        <div class="card-body">
          ${
            compat
              ? `
            <div class="meta-line tabular-num">
              <strong style="color: var(--color-primary);">${score}% compatibility</strong>
              <span aria-hidden="true">·</span>
              <span>${escapeHtml(item.is_verified ? "Verified student" : "Email account")}</span>
            </div>
            <div class="compat-bar"><div class="compat-bar-fill" style="width:${score}%"></div></div>
            <p class="muted-small" style="margin-bottom:0.75rem;">${escapeHtml(compat.explanation)}</p>
          `
              : ""
          }
          <p>${escapeHtml(item.bio || "Looking for companions for upcoming concerts, films, or campus events.")}</p>
          <div class="meta-line">
            <span>Interests: ${escapeHtml(shared)}</span>
          </div>
          <div class="card-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="card-safety-btn">Report / Block</button>
          </div>
        </div>
      </article>
    `;
  }

  if (state.activeTab === "groups") {
    return `
      <article class="swipe-card" id="active-swipe-card">
        <div class="swipe-card-media">
          <div class="media-fallback">
            <span class="media-fallback-mark">${escapeHtml(item.name.slice(0, 2).toUpperCase())}</span>
          </div>
          <div class="swipe-stamp swipe-stamp-like">JOIN</div>
          <div class="swipe-stamp swipe-stamp-skip">SKIP</div>
          <div class="swipe-card-scrim">
            <h2>${escapeHtml(item.name)}</h2>
            <div class="meta-line">
              <span>${item.is_public ? "Public group" : "Private group"}</span>
              <span aria-hidden="true">·</span>
              <span class="tabular-num">${item.member_count}/${item.max_members} members</span>
            </div>
          </div>
        </div>
        <div class="card-body">
          <div class="meta-line">
            ${item.event_title ? `<span>For: ${escapeHtml(item.event_title)}</span>` : "<span>Open student crew</span>"}
            ${item.location ? `<span aria-hidden="true">·</span><span>${escapeHtml(item.location)}</span>` : ""}
          </div>
          <p>${escapeHtml(item.description)}</p>
          <div class="meta-line">
            <span>${escapeHtml(item.university || "All universities")}</span>
            ${item.interests_summary ? `<span aria-hidden="true">·</span><span>${escapeHtml(item.interests_summary)}</span>` : ""}
          </div>
        </div>
      </article>
    `;
  }

  // Going Solo tab
  const authorName = `${item.user.first_name} ${item.user.last_name}`;
  return `
    <article class="swipe-card" id="active-swipe-card">
      <div class="swipe-card-media">
        <div class="media-fallback">
          <span class="media-fallback-mark">${escapeHtml(getInitials(item.user.first_name, item.user.last_name))}</span>
        </div>
        <div class="swipe-stamp swipe-stamp-like">TEAM UP</div>
        <div class="swipe-stamp swipe-stamp-skip">SKIP</div>
        <div class="swipe-card-scrim">
          <h2>${escapeHtml(authorName)} is going solo</h2>
          <div class="meta-line">
            <span>${escapeHtml(item.event_title)}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(item.event_city)}</span>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="meta-line tabular-num">
          <span>${escapeHtml(formatDateTime(item.event_start_datetime))}</span>
          <span aria-hidden="true">·</span>
          <span>${item.interest_count} interested</span>
        </div>
        <p>${escapeHtml(item.message)}</p>
        <div class="meta-line">
          <span>${escapeHtml(item.user.university || "Open student community")}</span>
          ${
            item.user.compatibility
              ? `<span aria-hidden="true">·</span><span>${item.user.compatibility.compatibility}% compatibility</span>`
              : ""
          }
        </div>
        <div class="card-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="card-safety-btn">Report / Block</button>
        </div>
      </div>
    </article>
  `;
}

function attachDragHandlers(cardEl) {
  let startX = 0;
  let currentX = 0;
  let dragging = false;
  const likeStamp = qs(".swipe-stamp-like", cardEl);
  const skipStamp = qs(".swipe-stamp-skip", cardEl);

  cardEl.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("button, a") || state.busy) return;
    dragging = true;
    startX = ev.clientX;
    currentX = 0;
    cardEl.classList.add("is-dragging");
    cardEl.setPointerCapture(ev.pointerId);
  });

  cardEl.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    currentX = ev.clientX - startX;
    const rotate = currentX * 0.05;
    cardEl.style.transform = `translateX(${currentX}px) rotate(${rotate}deg)`;
    if (currentX > 25) {
      likeStamp.style.opacity = String(Math.min(1, currentX / 110));
      skipStamp.style.opacity = "0";
    } else if (currentX < -25) {
      skipStamp.style.opacity = String(Math.min(1, Math.abs(currentX) / 110));
      likeStamp.style.opacity = "0";
    } else {
      likeStamp.style.opacity = "0";
      skipStamp.style.opacity = "0";
    }
  });

  const finishDrag = () => {
    if (!dragging) return;
    dragging = false;
    cardEl.classList.remove("is-dragging");
    if (currentX > 100) {
      handleSwipe("right");
    } else if (currentX < -100) {
      handleSwipe("left");
    } else {
      cardEl.style.transform = "";
      likeStamp.style.opacity = "0";
      skipStamp.style.opacity = "0";
    }
  };

  cardEl.addEventListener("pointerup", finishDrag);
  cardEl.addEventListener("pointercancel", finishDrag);
}

function renderTopCard() {
  const item = currentCard();
  if (!item) {
    renderEmptyState();
    return;
  }

  const container = qs("#deck-container");
  container.innerHTML = renderCardMarkup(item);
  qs("#swipe-actions").hidden = false;

  const likeBtn = qs("#btn-like");
  likeBtn.textContent =
    state.activeTab === "groups"
      ? "Join"
      : state.activeTab === "solo"
      ? "Team up"
      : "Like";

  const cardEl = qs("#active-swipe-card", container);
  attachDragHandlers(cardEl);

  const safetyBtn = qs("#card-safety-btn", cardEl);
  if (safetyBtn) {
    const targetUser = state.activeTab === "solo" ? item.user : item;
    safetyBtn.addEventListener("click", () => {
      openSafetyModal(targetUser, (blockedId) => {
        state.cards = state.cards.filter((c) => {
          const uid = state.activeTab === "solo" ? c.user.id : c.id;
          return uid !== blockedId;
        });
        renderTopCard();
      });
    });
  }
}

function showMatchCelebration(match) {
  const other = match.other_user;
  openModal({
    title: "It's a Match!",
    bodyHtml: `
      <div style="text-align:center;">
        <div class="avatar-circle avatar-lg" style="margin:0 auto 1rem;">
          ${escapeHtml(getInitials(other.first_name, other.last_name))}
        </div>
        <h3>You and ${escapeHtml(other.first_name)} ${escapeHtml(other.last_name)} both liked each other</h3>
        <p>Event: <strong>${escapeHtml(match.event_title)}</strong></p>
        <div class="card-actions" style="justify-content:center;">
          <a href="messages.html?conversation=${match.conversation_id || ""}" class="btn btn-primary">Send a message</a>
          <button type="button" class="btn btn-secondary" id="keep-swiping-btn">Keep discovering</button>
        </div>
      </div>
    `,
    onMount: (root, close) => {
      qs("#keep-swiping-btn", root).addEventListener("click", close);
    },
  });
}

async function handleSwipe(direction) {
  const item = currentCard();
  if (!item || state.busy) return;

  const key = `${state.activeTab}:${item.id}`;
  if (direction === "right" && state.actedIds.has(key)) {
    showToast("Already liked this item.", "info");
    state.cards.shift();
    renderTopCard();
    return;
  }

  state.busy = true;
  const likeBtn = qs("#btn-like");
  const skipBtn = qs("#btn-skip");
  likeBtn.disabled = true;
  skipBtn.disabled = true;

  const cardEl = qs("#active-swipe-card");
  if (cardEl) {
    cardEl.classList.add(direction === "right" ? "exit-right" : "exit-left");
  }

  try {
    if (direction === "right") {
      if (!state.user) {
        showToast("Sign in to like events, match with people, or join groups.", "info");
        window.location.href = "login.html";
        return;
      }

      if (state.activeTab === "events") {
        await API.likeEvent(item.id);
        showToast(`Liked "${item.title}"!`, "success");
      } else if (state.activeTab === "people") {
        const eventId = Number(qs("#disc-event-context").value);
        if (!eventId) {
          showToast("Create or choose an event context in Filters to match.", "error");
          if (cardEl) cardEl.classList.remove("exit-right");
          return;
        }
        const res = await API.likeUser(item.id, eventId);
        if (res.is_match && res.match) {
          showMatchCelebration(res.match);
        } else {
          showToast(`Like sent to ${item.first_name}. Waiting for mutual like!`, "success");
        }
      } else if (state.activeTab === "groups") {
        const grp = await API.joinGroup(item.id);
        showToast(
          grp.membership_status === "pending"
            ? `Join request sent to ${item.name}.`
            : `Joined ${item.name}!`,
          "success"
        );
      } else if (state.activeTab === "solo") {
        const res = await API.expressSoloInterest(item.id);
        showToast("Connected! Opening chat with your solo companion...", "success");
        window.setTimeout(() => {
          window.location.href = `messages.html?conversation=${res.conversation_id}`;
        }, 500);
      }
      state.actedIds.add(key);
    }

    window.setTimeout(() => {
      state.cards.shift();
      renderTopCard();
    }, 180);
  } catch (err) {
    if (cardEl) cardEl.classList.remove("exit-right", "exit-left");
    if (err.status === 409) {
      state.actedIds.add(key);
      showToast(err.message, "info");
      state.cards.shift();
      renderTopCard();
    } else {
      showToast(err.message || "Action could not be completed.", "error");
    }
  } finally {
    state.busy = false;
    likeBtn.disabled = false;
    skipBtn.disabled = false;
  }
}

async function loadDeck() {
  renderLoading();
  const { city, university } = state.filters;

  try {
    if (state.activeTab === "events") {
      const data = await API.listEvents({ city, university, limit: 30 });
      state.cards = (data.items || []).filter(
        (ev) => !ev.is_liked && !state.actedIds.has(`events:${ev.id}`)
      );
    } else if (state.activeTab === "people") {
      if (!state.user) {
        state.cards = [];
        qs("#swipe-actions").hidden = true;
        qs("#deck-container").innerHTML = `
          <div class="empty-state">
            <h2>Sign in to discover companions</h2>
            <p>Compatibility scores and mutual matching require an account.</p>
            <a href="login.html" class="btn btn-primary">Sign in</a>
          </div>
        `;
        return;
      }
      const people = await API.discoverUsers({ city, university, limit: 30 });
      state.cards = people.filter((u) => !state.actedIds.has(`people:${u.id}`));
    } else if (state.activeTab === "groups") {
      const groups = await API.listGroups({ city, university });
      state.cards = groups.filter(
        (g) => !g.is_member && g.membership_status !== "pending" && !state.actedIds.has(`groups:${g.id}`)
      );
    } else if (state.activeTab === "solo") {
      const solos = await API.listSolo({ city, university });
      state.cards = solos.filter(
        (s) =>
          (!state.user || s.user_id !== state.user.id) &&
          !s.has_expressed_interest &&
          !state.actedIds.has(`solo:${s.id}`)
      );
    }

    renderTopCard();
  } catch (err) {
    qs("#deck-container").innerHTML = `
      <div class="empty-state">
        <h2>Could not load discovery deck</h2>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

async function loadEventContextSelect() {
  const select = qs("#disc-event-context");
  if (!select) return;
  try {
    const res = await API.listEvents({ limit: 30 });
    state.eventsForContext = res.items || [];
    if (!state.eventsForContext.length) {
      select.innerHTML = `<option value="">No events available</option>`;
      return;
    }
    select.innerHTML = state.eventsForContext
      .map((ev) => `<option value="${ev.id}">${escapeHtml(ev.title)} (${escapeHtml(ev.city)})</option>`)
      .join("");
  } catch {
    select.innerHTML = `<option value="">Unable to load events</option>`;
  }
}

function openSoloModal() {
  if (!state.user) {
    requireAuthenticatedUser();
    return;
  }
  const options = state.eventsForContext
    .map((ev) => `<option value="${ev.id}">${escapeHtml(ev.title)} — ${escapeHtml(ev.city)}</option>`)
    .join("");

  openModal({
    title: "Announce Going Solo",
    bodyHtml: `
      <form id="modal-solo-form" class="stack-form">
        <p>Let other students know you want to attend an event and are looking for company.</p>
        <div class="field">
          <label for="ms-event">Event</label>
          <select id="ms-event" required>${options}</select>
        </div>
        <div class="field">
          <label for="ms-msg">Personal message</label>
          <textarea id="ms-msg" rows="3" required minlength="5" maxlength="500" placeholder="Heading there solo — want to meet outside 20 minutes early?"></textarea>
        </div>
        <div class="field">
          <label for="ms-exp">Active for</label>
          <select id="ms-exp">
            <option value="24">24 hours</option>
            <option value="48" selected>48 hours</option>
            <option value="72">72 hours</option>
          </select>
        </div>
        <button type="submit" class="btn btn-coral">Post Going Solo</button>
      </form>
    `,
    onMount: (root, close) => {
      qs("#modal-solo-form", root).addEventListener("submit", async (ev) => {
        ev.preventDefault();
        try {
          await API.createSolo({
            event_id: Number(qs("#ms-event", root).value),
            message: qs("#ms-msg", root).value.trim(),
            expires_hours: Number(qs("#ms-exp", root).value),
          });
          showToast("Going Solo announcement posted!", "success");
          close();
          if (state.activeTab === "solo") loadDeck();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    },
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.body?.dataset?.page !== "discover") return;

  state.user = await getCurrentUser();
  await loadEventContextSelect();

  qsa("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa("[data-tab]").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      state.activeTab = btn.dataset.tab;
      loadDeck();
    });
  });

  qs("#btn-like").addEventListener("click", () => handleSwipe("right"));
  qs("#btn-skip").addEventListener("click", () => handleSwipe("left"));
  qs("#open-solo-modal-btn").addEventListener("click", openSoloModal);

  qs("#discover-filter-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    state.filters.city = qs("#disc-city").value.trim();
    state.filters.university = qs("#disc-uni").value.trim();
    loadDeck();
  });

  qs("#disc-reset-btn").addEventListener("click", () => {
    state.actedIds.clear();
    loadDeck();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.target.closest("input, textarea, select") || qs("#active-modal-backdrop")) return;
    if (ev.key === "ArrowRight") handleSwipe("right");
    if (ev.key === "ArrowLeft") handleSwipe("left");
  });

  await loadDeck();
});
