/**
 * Event discovery browser (events.html) and outing/Going Solo creation (create-event.html).
 */
import { API } from "./api.js";
import { CONFIG } from "./config.js";
import { getCurrentUser, requireAuthenticatedUser } from "./navigation.js";
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

const eventsState = {
  user: null,
  page: 1,
  limit: 9,
  filters: { q: "", category: "", city: "", university: "", date: "" },
};

function populateCategories(selectEl, includeAll = true) {
  if (!selectEl) return;
  const opts = CONFIG.EVENT_CATEGORIES.map(
    (cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`
  ).join("");
  selectEl.innerHTML = includeAll ? `<option value="">All categories</option>${opts}` : opts;
}

async function openEventDetailsModal(eventId) {
  try {
    const [ev, participants] = await Promise.all([
      API.getEvent(eventId),
      API.getEventParticipants(eventId),
    ]);

    const capText = ev.max_participants
      ? `${ev.participant_count} / ${ev.max_participants} participants`
      : `${ev.participant_count} participants`;

    const participantsHtml = participants.length
      ? participants
          .map(
            (p) => `
          <div style="display:flex;align-items:center;gap:0.75rem;padding:0.45rem 0;border-bottom:1px solid var(--color-border);">
            <div class="avatar-circle">${escapeHtml(getInitials(p.user.first_name, p.user.last_name))}</div>
            <div>
              <strong>${escapeHtml(p.user.first_name)} ${escapeHtml(p.user.last_name)}</strong>
              <div class="muted-small">${escapeHtml(p.user.university || p.user.city || `@${p.user.username}`)}</div>
            </div>
          </div>
        `
          )
          .join("")
      : `<p class="muted-small">No participants yet — be the first to join.</p>`;

    const isOwner = eventsState.user && eventsState.user.id === ev.creator_id;

    openModal({
      title: ev.title,
      bodyHtml: `
        <div>
          ${renderMediaWithFallback(ev.image_url, ev.title, ev.category)}
          <div class="meta-line" style="margin-top:1rem;">
            <span>${escapeHtml(ev.category)}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(ev.city)}</span>
            <span aria-hidden="true">·</span>
            <span class="tabular-num">${escapeHtml(capText)}</span>
          </div>
          <p><strong>When:</strong> ${escapeHtml(formatDateTime(ev.start_datetime))}</p>
          <p><strong>Where:</strong> ${escapeHtml(ev.location)}${ev.university ? ` (${escapeHtml(ev.university)})` : ""}</p>
          <p>${escapeHtml(ev.description)}</p>

          <div class="card-actions">
            <button type="button" class="btn ${ev.is_joined ? "btn-secondary" : "btn-primary"}" id="modal-join-btn">
              ${ev.is_joined ? "Leave event" : "Join event"}
            </button>
            <button type="button" class="btn btn-coral" id="modal-like-btn" ${ev.is_liked ? "disabled" : ""}>
              ${ev.is_liked ? `Liked (${ev.like_count})` : `Like (${ev.like_count})`}
            </button>
            ${
              isOwner
                ? `<button type="button" class="btn btn-danger" id="modal-delete-ev-btn">Delete event</button>`
                : ""
            }
          </div>

          <div class="divider-line"></div>
          <h3>Participants (${participants.length})</h3>
          <div>${participantsHtml}</div>
        </div>
      `,
      onMount: (root, close) => {
        qs("#modal-join-btn", root).addEventListener("click", async () => {
          if (!eventsState.user) {
            requireAuthenticatedUser();
            return;
          }
          try {
            if (ev.is_joined) {
              await API.leaveEvent(ev.id);
              showToast("You left the event.", "info");
            } else {
              await API.joinEvent(ev.id);
              showToast("Joined event!", "success");
            }
            close();
            loadEventsList();
          } catch (err) {
            showToast(err.message, "error");
          }
        });

        qs("#modal-like-btn", root).addEventListener("click", async () => {
          if (!eventsState.user) {
            requireAuthenticatedUser();
            return;
          }
          try {
            await API.likeEvent(ev.id);
            showToast("Event liked!", "success");
            close();
            loadEventsList();
          } catch (err) {
            showToast(err.message, "error");
          }
        });

        const delBtn = qs("#modal-delete-ev-btn", root);
        if (delBtn) {
          delBtn.addEventListener("click", async () => {
            if (delBtn.dataset.armed !== "true") {
              delBtn.dataset.armed = "true";
              delBtn.textContent = "Confirm delete";
              return;
            }
            try {
              await API.deleteEvent(ev.id);
              showToast("Event deleted.", "success");
              close();
              loadEventsList();
            } catch (err) {
              showToast(err.message, "error");
            }
          });
        }
      },
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function loadEventsList() {
  const container = qs("#events-container");
  const pagEl = qs("#events-pagination");
  if (!container) return;

  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading events...</p>
    </div>
  `;

  try {
    const res = await API.listEvents({
      ...eventsState.filters,
      page: eventsState.page,
      limit: eventsState.limit,
    });

    if (!res.items.length) {
      container.innerHTML = `
        <div class="empty-state">
          <h2>No events match those filters</h2>
          <p>Try widening your city/date filter or host a new outing yourself.</p>
          <a href="create-event.html" class="btn btn-primary">Create an outing</a>
        </div>
      `;
      pagEl.innerHTML = "";
      return;
    }

    container.innerHTML = `<div class="cards-grid">${res.items
      .map((ev) => {
        const cap = ev.max_participants
          ? `${ev.participant_count}/${ev.max_participants} spots`
          : `${ev.participant_count} going`;
        return `
          <article class="card">
            ${renderMediaWithFallback(ev.image_url, ev.title, ev.category)}
            <div class="card-body">
              <div class="meta-line">
                <span>${escapeHtml(ev.category)}</span>
                <span aria-hidden="true">·</span>
                <span>${escapeHtml(ev.city)}</span>
                <span aria-hidden="true">·</span>
                <span class="tabular-num">${escapeHtml(cap)}</span>
              </div>
              <h3>${escapeHtml(ev.title)}</h3>
              <p class="muted-small tabular-num" style="margin-bottom:0.5rem;">${escapeHtml(formatDateTime(ev.start_datetime))} · ${escapeHtml(ev.location)}</p>
              <p>${escapeHtml(ev.description.slice(0, 120))}${ev.description.length > 120 ? "..." : ""}</p>
              <div class="card-actions">
                <button type="button" class="btn btn-primary btn-sm" data-view-event="${ev.id}">Details &amp; Join</button>
                <button type="button" class="btn btn-secondary btn-sm" data-quick-like="${ev.id}" ${ev.is_liked ? "disabled" : ""}>
                  ${ev.is_liked ? `Liked (${ev.like_count})` : `Like (${ev.like_count})`}
                </button>
              </div>
            </div>
          </article>
        `;
      })
      .join("")}</div>`;

    qsa("[data-view-event]", container).forEach((btn) => {
      btn.addEventListener("click", () => openEventDetailsModal(Number(btn.dataset.viewEvent)));
    });

    qsa("[data-quick-like]", container).forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!eventsState.user) {
          requireAuthenticatedUser();
          return;
        }
        try {
          await API.likeEvent(Number(btn.dataset.quickLike));
          showToast("Event liked!", "success");
          loadEventsList();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });

    pagEl.innerHTML = "";
    if (res.pages > 1) {
      pagEl.innerHTML = `
        <button type="button" class="btn btn-secondary btn-sm" id="prev-page-btn" ${res.page <= 1 ? "disabled" : ""}>Previous</button>
        <span class="muted-small tabular-num" style="align-self:center;">Page ${res.page} of ${res.pages}</span>
        <button type="button" class="btn btn-secondary btn-sm" id="next-page-btn" ${res.page >= res.pages ? "disabled" : ""}>Next</button>
      `;
      qs("#prev-page-btn", pagEl)?.addEventListener("click", () => {
        eventsState.page = Math.max(1, eventsState.page - 1);
        loadEventsList();
      });
      qs("#next-page-btn", pagEl)?.addEventListener("click", () => {
        eventsState.page = Math.min(res.pages, eventsState.page + 1);
        loadEventsList();
      });
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function initCreateEventPage() {
  const user = await requireAuthenticatedUser();
  if (!user) return;

  populateCategories(qs("#ce-category"), false);

  const presetSelect = qs("#ce-image-preset");
  presetSelect.innerHTML = CONFIG.EVENT_IMAGE_PRESETS.map(
    (p) => `<option value="${escapeHtml(p.url)}">${escapeHtml(p.label)}</option>`
  ).join("");

  // Default start datetime to tomorrow 19:00
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  tomorrow.setHours(19, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  qs("#ce-start").value = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T19:00`;
  if (user.university) qs("#ce-university").value = user.university;
  if (user.city) qs("#ce-city").value = user.city;

  const soloSelect = qs("#solo-event-select");
  try {
    const evList = await API.listEvents({ limit: 30 });
    soloSelect.innerHTML = (evList.items || []).length
      ? evList.items.map((ev) => `<option value="${ev.id}">${escapeHtml(ev.title)} (${escapeHtml(ev.city)})</option>`).join("")
      : `<option value="">Create an event first</option>`;
  } catch {
    soloSelect.innerHTML = `<option value="">Unable to load events</option>`;
  }

  qs("#create-event-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const feedback = qs("#create-event-feedback");
    feedback.hidden = true;
    const btn = qs("#ce-submit-btn");
    btn.disabled = true;
    btn.textContent = "Publishing...";

    const maxRaw = qs("#ce-max").value.trim();
    const endRaw = qs("#ce-end").value.trim();

    try {
      const created = await API.createEvent({
        title: qs("#ce-title").value.trim(),
        category: qs("#ce-category").value,
        location: qs("#ce-location").value.trim(),
        city: qs("#ce-city").value.trim(),
        university: qs("#ce-university").value.trim() || null,
        start_datetime: new Date(qs("#ce-start").value).toISOString(),
        end_datetime: endRaw ? new Date(endRaw).toISOString() : null,
        max_participants: maxRaw ? Number(maxRaw) : null,
        image_url: presetSelect.value,
        description: qs("#ce-description").value.trim(),
      });
      showToast(`"${created.title}" published!`, "success");
      window.setTimeout(() => {
        window.location.href = "events.html";
      }, 600);
    } catch (err) {
      feedback.hidden = false;
      feedback.className = "form-alert form-alert-error";
      feedback.textContent = err.message;
      btn.disabled = false;
      btn.textContent = "Publish outing";
    }
  });

  qs("#create-solo-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const feedback = qs("#create-solo-feedback");
    feedback.hidden = true;
    const eventId = Number(soloSelect.value);
    if (!eventId) {
      showToast("Please select an event.", "error");
      return;
    }

    const btn = qs("#solo-submit-btn");
    btn.disabled = true;
    btn.textContent = "Posting...";
    try {
      await API.createSolo({
        event_id: eventId,
        message: qs("#solo-message").value.trim(),
        expires_hours: Number(qs("#solo-expires").value),
      });
      feedback.hidden = false;
      feedback.className = "form-alert form-alert-success";
      feedback.textContent = "Your Going Solo announcement is now live in Discover & Groups!";
      qs("#solo-message").value = "";
    } catch (err) {
      feedback.hidden = false;
      feedback.className = "form-alert form-alert-error";
      feedback.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Post Going Solo status";
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const page = document.body?.dataset?.page;
  if (page === "events") {
    eventsState.user = await getCurrentUser();
    populateCategories(qs("#ev-category"), true);
    qs("#events-filter-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      eventsState.page = 1;
      eventsState.filters = {
        q: qs("#ev-q").value.trim(),
        category: qs("#ev-category").value,
        city: qs("#ev-city").value.trim(),
        university: qs("#ev-university").value.trim(),
        date: qs("#ev-date").value,
      };
      loadEventsList();
    });
    await loadEventsList();
  } else if (page === "create-event") {
    await initCreateEventPage();
  }
});
