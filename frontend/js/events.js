/**
 * Event discovery browser (events.html) and outing/Going Solo creation (create-event.html).
 * Uses Cloud Firestore real-time updates, string IDs, Sample badges, owner editing,
 * and Firebase Storage cover image uploads.
 */
import { API } from "./api.js";
import { CONFIG } from "./config.js";
import {
  getCurrentUser,
  openPublicProfileModal,
  renderAvatarHtml,
  requireAuthenticatedUser,
} from "./navigation.js";
import {
  escapeHtml,
  formatDateTime,
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
  allItems: [],
  itemsById: new Map(),
  unsubEvents: null,
  filters: { q: "", category: "", timeframe: "all", city: "", university: "", date: "" },
};

function heartSvg(filled) {
  return filled
    ? `<svg class="heart-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
    : `<svg class="heart-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
}

function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function updateLikeButtonVisual(btn, isLiked, likeCount) {
  if (!btn) return;
  btn.classList.toggle("is-liked", Boolean(isLiked));
  btn.dataset.liked = isLiked ? "true" : "false";
  btn.setAttribute("aria-pressed", isLiked ? "true" : "false");
  btn.setAttribute("aria-label", isLiked ? `Unlike event (${likeCount} likes)` : `Like event (${likeCount} likes)`);
  btn.innerHTML = `${heartSvg(isLiked)}<span class="tabular-num">${likeCount}</span>`;
}

async function handleEventLikeToggle(eventId, btn) {
  if (!eventsState.user) {
    requireAuthenticatedUser();
    return null;
  }
  if (btn.dataset.busy === "true") return null;

  btn.dataset.busy = "true";
  const currentlyLiked = btn.dataset.liked === "true";

  try {
    const updatedEv = currentlyLiked
      ? await API.unlikeEvent(eventId)
      : await API.likeEvent(eventId);
    eventsState.itemsById.set(updatedEv.id, updatedEv);

    const cardBtn = qs(`[data-quick-like="${CSS.escape(eventId)}"]`);
    if (cardBtn) {
      updateLikeButtonVisual(cardBtn, updatedEv.is_liked, updatedEv.like_count);
    }
    updateLikeButtonVisual(btn, updatedEv.is_liked, updatedEv.like_count);
    return updatedEv;
  } catch (err) {
    showToast(err.message || "Could not update like.", "error");
    return null;
  } finally {
    delete btn.dataset.busy;
  }
}

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
    eventsState.itemsById.set(ev.id, ev);

    const capText = ev.max_participants
      ? `${ev.participant_count} / ${ev.max_participants} participants`
      : `${ev.participant_count} participants`;

    const participantsHtml = participants.length
      ? participants
          .map(
            (p) => `
          <div style="display:flex;align-items:center;gap:0.75rem;padding:0.45rem 0;border-bottom:1px solid var(--color-border);">
            <button type="button" class="feed-author-btn" data-participant-uid="${escapeHtml(p.user_id)}">
              ${renderAvatarHtml(p.user)}
              <div>
                <strong>${escapeHtml(p.user.first_name)} ${escapeHtml(p.user.last_name)}</strong>
                <div class="muted-small">${escapeHtml(p.user.university || p.user.city || `@${p.user.username}`)}</div>
              </div>
            </button>
          </div>
        `
          )
          .join("")
      : `<p class="muted-small">No participants yet — be the first to join.</p>`;

    const isOwner = eventsState.user && eventsState.user.id === ev.creator_id;
    const categoryOptions = CONFIG.EVENT_CATEGORIES.map(
      (cat) =>
        `<option value="${escapeHtml(cat)}" ${cat === ev.category ? "selected" : ""}>${escapeHtml(cat)}</option>`
    ).join("");

    openModal({
      title: ev.title,
      bodyHtml: `
        <div>
          ${renderMediaWithFallback(ev.image_url, ev.title, ev.category)}
          <div class="meta-line" style="margin-top:1rem;">
            ${ev.is_sample ? `<span class="badge-sample">Sample</span><span aria-hidden="true">·</span>` : ""}
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
            <button
              type="button"
              class="btn like-toggle-btn ${ev.is_liked ? "is-liked" : ""}"
              id="modal-like-btn"
              data-liked="${ev.is_liked ? "true" : "false"}"
              aria-pressed="${ev.is_liked ? "true" : "false"}"
            >
              ${heartSvg(ev.is_liked)}<span class="tabular-num">${ev.like_count}</span>
            </button>
            ${
              isOwner
                ? `<button type="button" class="btn btn-secondary" id="modal-edit-ev-btn">Edit event</button>
                   <button type="button" class="btn btn-danger" id="modal-delete-ev-btn">Delete event</button>`
                : ""
            }
          </div>

          ${
            isOwner
              ? `
            <form id="modal-edit-event-form" class="stack-form" hidden style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--color-border);">
              <h3>Edit Event Details</h3>
              <div id="modal-edit-feedback" class="form-alert" hidden></div>
              <div class="field">
                <label for="me-title">Title</label>
                <input id="me-title" type="text" required minlength="3" maxlength="160" value="${escapeHtml(ev.title)}">
              </div>
              <div class="field-row">
                <div class="field">
                  <label for="me-category">Category</label>
                  <select id="me-category" required>${categoryOptions}</select>
                </div>
                <div class="field">
                  <label for="me-max">Max participants</label>
                  <input id="me-max" type="number" min="2" max="5000" value="${ev.max_participants ?? ""}">
                </div>
              </div>
              <div class="field-row">
                <div class="field">
                  <label for="me-location">Venue / Spot</label>
                  <input id="me-location" type="text" required value="${escapeHtml(ev.location)}">
                </div>
                <div class="field">
                  <label for="me-city">City</label>
                  <input id="me-city" type="text" required value="${escapeHtml(ev.city)}">
                </div>
              </div>
              <div class="field">
                <label for="me-start">Start date &amp; time</label>
                <input id="me-start" type="datetime-local" required value="${escapeHtml(toDatetimeLocalValue(ev.start_datetime))}">
              </div>
              <div class="field">
                <label for="me-description">Description</label>
                <textarea id="me-description" rows="3" required minlength="10">${escapeHtml(ev.description)}</textarea>
              </div>
              <div class="card-actions" style="margin-top:0;">
                <button type="submit" class="btn btn-primary btn-sm" id="me-save-btn">Save changes</button>
                <button type="button" class="btn btn-secondary btn-sm" id="me-cancel-btn">Cancel</button>
              </div>
            </form>
          `
              : ""
          }

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
            } else {
              await API.joinEvent(ev.id);
            }
            close();
            await loadEventsList();
          } catch (err) {
            showToast(err.message, "error");
          }
        });

        const modalLikeBtn = qs("#modal-like-btn", root);
        modalLikeBtn.addEventListener("click", async () => {
          await handleEventLikeToggle(ev.id, modalLikeBtn);
        });

        qsa("[data-participant-uid]", root).forEach((btn) => {
          btn.addEventListener("click", () => {
            openPublicProfileModal(btn.dataset.participantUid);
          });
        });

        const editBtn = qs("#modal-edit-ev-btn", root);
        const editForm = qs("#modal-edit-event-form", root);
        if (editBtn && editForm) {
          editBtn.addEventListener("click", () => {
            editForm.hidden = !editForm.hidden;
          });
          qs("#me-cancel-btn", root)?.addEventListener("click", () => {
            editForm.hidden = true;
          });
          editForm.addEventListener("submit", async (submitEv) => {
            submitEv.preventDefault();
            const fb = qs("#modal-edit-feedback", root);
            const saveBtn = qs("#me-save-btn", root);
            fb.hidden = true;
            saveBtn.disabled = true;
            saveBtn.textContent = "Saving...";
            const maxVal = qs("#me-max", root).value.trim();
            try {
              await API.updateEvent(ev.id, {
                title: qs("#me-title", root).value.trim(),
                category: qs("#me-category", root).value,
                location: qs("#me-location", root).value.trim(),
                city: qs("#me-city", root).value.trim(),
                start_datetime: new Date(qs("#me-start", root).value).toISOString(),
                max_participants: maxVal ? Number(maxVal) : null,
                description: qs("#me-description", root).value.trim(),
              });
              close();
              showToast("Event updated.", "success");
              await loadEventsList();
            } catch (err) {
              fb.hidden = false;
              fb.className = "form-alert form-alert-error";
              fb.textContent = err.message || "Could not update event.";
              saveBtn.disabled = false;
              saveBtn.textContent = "Save changes";
            }
          });
        }

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
              close();
              await loadEventsList();
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

function applyClientFilters(items) {
  const qLow = (eventsState.filters.q || "").trim().toLowerCase();
  const catLow = (eventsState.filters.category || "").trim().toLowerCase();
  const cityLow = (eventsState.filters.city || "").trim().toLowerCase();
  const uniLow = (eventsState.filters.university || "").trim().toLowerCase();
  const dateFilter = (eventsState.filters.date || "").trim();
  const timeframe = eventsState.filters.timeframe || "all";
  const nowMs = Date.now();

  return (items || []).filter((ev) => {
    if (qLow && !`${ev.title} ${ev.description} ${ev.location}`.toLowerCase().includes(qLow)) return false;
    if (catLow && (ev.category || "").toLowerCase() !== catLow) return false;
    if (cityLow && !(ev.city || "").toLowerCase().includes(cityLow)) return false;
    if (uniLow && !(ev.university || "").toLowerCase().includes(uniLow)) return false;
    if (dateFilter && ev.date !== dateFilter) return false;
    const evMs = new Date(ev.start_datetime).getTime();
    if (timeframe === "upcoming" && evMs < nowMs) return false;
    if (timeframe === "past" && evMs >= nowMs) return false;
    return true;
  });
}

function renderEventsFromItems(allItems) {
  const container = qs("#events-container");
  const pagEl = qs("#events-pagination");
  if (!container) return;

  eventsState.allItems = allItems || [];
  const filtered = applyClientFilters(eventsState.allItems);
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / eventsState.limit));
  eventsState.page = Math.min(Math.max(1, eventsState.page), pages);
  const start = (eventsState.page - 1) * eventsState.limit;
  const pageItems = filtered.slice(start, start + eventsState.limit);

  eventsState.itemsById.clear();
  pageItems.forEach((ev) => eventsState.itemsById.set(ev.id, ev));

  if (!pageItems.length) {
    const hasFilters = Object.values(eventsState.filters).some((v) => String(v || "").trim() !== "");
    container.innerHTML = `
      <div class="empty-state">
        <h2>${hasFilters ? "No events match those filters" : "No events posted yet"}</h2>
        <p>${hasFilters ? "Try widening your city/date filter or host a new outing yourself." : "Be the first student to host an outing or load sample outings to explore."}</p>
        <div class="card-actions" style="justify-content:center;">
          <a href="create-event.html" class="btn btn-primary">Create an outing</a>
          ${
            !hasFilters && eventsState.user
              ? `<button type="button" class="btn btn-secondary" id="seed-sample-events-btn">Load sample outings</button>`
              : !hasFilters
                ? `<a href="login.html" class="btn btn-secondary">Sign in to load samples</a>`
                : ""
          }
        </div>
      </div>
    `;
    pagEl.innerHTML = "";

    const seedBtn = qs("#seed-sample-events-btn", container);
    if (seedBtn) {
      seedBtn.addEventListener("click", async () => {
        seedBtn.disabled = true;
        seedBtn.textContent = "Loading sample outings...";
        try {
          await API.seedSampleEvents();
          showToast("Sample outings added.", "success");
          await loadEventsList();
        } catch (err) {
          showToast(err.message || "Could not load sample outings.", "error");
          seedBtn.disabled = false;
          seedBtn.textContent = "Load sample outings";
        }
      });
    }
    return;
  }

  container.innerHTML = `<div class="cards-grid">${pageItems
    .map((ev) => {
      const cap = ev.max_participants
        ? `${ev.participant_count}/${ev.max_participants} spots`
        : `${ev.participant_count} going`;
      const isPast = ev.is_past || new Date(ev.start_datetime).getTime() < Date.now();
      const statusBadge = isPast
        ? `<span class="badge-sample">Past</span>`
        : ev.is_soon
        ? `<span class="badge-inline">Soon</span>`
        : ev.is_joined
        ? `<span class="badge-inline">Joined</span>`
        : "";
      return `
        <article class="card">
          ${renderMediaWithFallback(ev.image_url, ev.title, ev.category)}
          <div class="card-body">
            <div class="meta-line">
              ${ev.is_sample ? `<span class="badge-sample">Sample</span><span aria-hidden="true">·</span>` : ""}
              ${statusBadge ? `${statusBadge}<span aria-hidden="true">·</span>` : ""}
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
              <button type="button" class="btn btn-primary btn-sm" data-view-event="${escapeHtml(ev.id)}">Details &amp; Join</button>
              <button
                type="button"
                class="btn btn-sm like-toggle-btn ${ev.is_liked ? "is-liked" : ""}"
                data-quick-like="${escapeHtml(ev.id)}"
                data-liked="${ev.is_liked ? "true" : "false"}"
                aria-pressed="${ev.is_liked ? "true" : "false"}"
                aria-label="${ev.is_liked ? `Unlike event (${ev.like_count} likes)` : `Like event (${ev.like_count} likes)`}"
              >
                ${heartSvg(ev.is_liked)}<span class="tabular-num">${ev.like_count}</span>
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("")}</div>`;

  qsa("[data-view-event]", container).forEach((btn) => {
    btn.addEventListener("click", () => openEventDetailsModal(btn.dataset.viewEvent));
  });

  qsa("[data-quick-like]", container).forEach((btn) => {
    btn.addEventListener("click", async () => {
      await handleEventLikeToggle(btn.dataset.quickLike, btn);
    });
  });

  pagEl.innerHTML = "";
  if (pages > 1) {
    pagEl.innerHTML = `
      <button type="button" class="btn btn-secondary btn-sm" id="prev-page-btn" ${eventsState.page <= 1 ? "disabled" : ""}>Previous</button>
      <span class="muted-small tabular-num" style="align-self:center;">Page ${eventsState.page} of ${pages}</span>
      <button type="button" class="btn btn-secondary btn-sm" id="next-page-btn" ${eventsState.page >= pages ? "disabled" : ""}>Next</button>
    `;
    qs("#prev-page-btn", pagEl)?.addEventListener("click", () => {
      eventsState.page = Math.max(1, eventsState.page - 1);
      renderEventsFromItems(eventsState.allItems);
    });
    qs("#next-page-btn", pagEl)?.addEventListener("click", () => {
      eventsState.page = Math.min(pages, eventsState.page + 1);
      renderEventsFromItems(eventsState.allItems);
    });
  }
}

async function loadEventsList() {
  const container = qs("#events-container");
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
      limit: 100,
    });
    renderEventsFromItems(res.items || []);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function startEventsRealtimeSync() {
  if (eventsState.unsubEvents) {
    eventsState.unsubEvents();
    eventsState.unsubEvents = null;
  }
  eventsState.unsubEvents = API.subscribeToEvents(
    (items) => {
      renderEventsFromItems(items);
    },
    () => {
      // Fallback already covered by initial loadEventsList if listener fails
    }
  );
}

async function initCreateEventPage() {
  const user = await requireAuthenticatedUser();
  if (!user) return;

  populateCategories(qs("#ce-category"), false);

  const presetSelect = qs("#ce-image-preset");
  presetSelect.innerHTML = CONFIG.EVENT_IMAGE_PRESETS.map(
    (p) => `<option value="${escapeHtml(p.url)}">${escapeHtml(p.label)}</option>`
  ).join("");

  let uploadedImageUrl = null;
  let isUploadingCover = false;

  const fileInput = qs("#ce-image-file");
  const clearUploadBtn = qs("#ce-image-clear-btn");
  const progressTrack = qs("#ce-upload-progress");
  const progressBar = qs("#ce-upload-progress-bar");
  const uploadStatus = qs("#ce-upload-status");
  const previewBox = qs("#ce-image-preview");
  const submitBtn = qs("#ce-submit-btn");

  const clearCustomUpload = () => {
    uploadedImageUrl = null;
    if (fileInput) fileInput.value = "";
    if (clearUploadBtn) clearUploadBtn.hidden = true;
    if (progressTrack) progressTrack.hidden = true;
    if (progressBar) progressBar.style.width = "0%";
    if (uploadStatus) {
      uploadStatus.hidden = true;
      uploadStatus.textContent = "";
    }
    if (previewBox) {
      previewBox.hidden = true;
      previewBox.innerHTML = "";
    }
  };

  clearUploadBtn?.addEventListener("click", clearCustomUpload);

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    isUploadingCover = true;
    submitBtn.disabled = true;
    progressTrack.hidden = false;
    progressBar.style.width = "0%";
    uploadStatus.hidden = false;
    uploadStatus.className = "muted-small";
    uploadStatus.textContent = "Uploading image (0%)...";

    try {
      const url = await API.uploadEventImage(file, (pct) => {
        progressBar.style.width = `${pct}%`;
        uploadStatus.textContent = `Uploading image (${pct}%)...`;
      });
      uploadedImageUrl = url;
      uploadStatus.className = "muted-small status-text-success";
      uploadStatus.textContent = "Custom cover image uploaded.";
      clearUploadBtn.hidden = false;
      previewBox.hidden = false;
      previewBox.innerHTML = `<img src="${escapeHtml(url)}" alt="Uploaded event cover preview">`;
    } catch (err) {
      uploadedImageUrl = null;
      fileInput.value = "";
      progressTrack.hidden = true;
      uploadStatus.className = "field-error";
      uploadStatus.textContent = err.message || "Could not upload image.";
    } finally {
      isUploadingCover = false;
      submitBtn.disabled = false;
    }
  });

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
      ? evList.items
          .map((ev) => `<option value="${escapeHtml(ev.id)}">${escapeHtml(ev.title)} (${escapeHtml(ev.city)})</option>`)
          .join("")
      : `<option value="">Create an event first</option>`;
  } catch {
    soloSelect.innerHTML = `<option value="">Unable to load events</option>`;
  }

  qs("#create-event-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (isUploadingCover) {
      showToast("Please wait for the image upload to finish.", "info");
      return;
    }
    const feedback = qs("#create-event-feedback");
    feedback.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Publishing...";

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
        image_url: uploadedImageUrl || presetSelect.value,
        description: qs("#ce-description").value.trim(),
      });
      feedback.hidden = false;
      feedback.className = "form-alert form-alert-success";
      feedback.textContent = `"${created.title}" published! Redirecting to Events...`;
      window.setTimeout(() => {
        window.location.href = "events.html";
      }, 650);
    } catch (err) {
      feedback.hidden = false;
      feedback.className = "form-alert form-alert-error";
      feedback.textContent = err.message;
      submitBtn.disabled = false;
      submitBtn.textContent = "Publish outing";
    }
  });

  qs("#create-solo-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const feedback = qs("#create-solo-feedback");
    feedback.hidden = true;
    const eventId = String(soloSelect.value || "").trim();
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
        timeframe: qs("#ev-timeframe")?.value || "all",
        city: qs("#ev-city").value.trim(),
        university: qs("#ev-university").value.trim(),
        date: qs("#ev-date").value,
      };
      renderEventsFromItems(eventsState.allItems);
    });
    await loadEventsList();
    const initialEventId = new URLSearchParams(window.location.search).get("event");
    if (initialEventId) {
      await openEventDetailsModal(initialEventId);
    }
    startEventsRealtimeSync();
    window.addEventListener("beforeunload", () => {
      if (eventsState.unsubEvents) eventsState.unsubEvents();
    });
  } else if (page === "create-event") {
    await initCreateEventPage();
  }
});
