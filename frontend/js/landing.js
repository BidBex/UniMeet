/**
 * UniMeet Landing Page — Real Firestore Event Previews & Legal Info Modals
 * Loads upcoming active events for both logged-out visitors and signed-in students.
 */
import { API } from "./api.js";
import { escapeHtml, formatDateTime, openModal, qs, renderMediaWithFallback } from "./utils.js";

const PRESET_PHOTO_FALLBACKS = new Map([
  ["assets/images/concert-preset.svg", "assets/images/hero-concert.jpg"],
  ["assets/images/cinema-preset.svg", "assets/images/event-cinema.jpg"],
  ["assets/images/games-preset.svg", "assets/images/event-boardgames.jpg"],
  ["assets/images/campus-preset.svg", "assets/images/event-festival.jpg"],
]);

function resolveEventPreviewImage(ev) {
  const raw = String(ev?.image_url || "").trim();
  if (raw && PRESET_PHOTO_FALLBACKS.has(raw)) {
    return PRESET_PHOTO_FALLBACKS.get(raw);
  }
  if (raw) return raw;

  const cat = String(ev?.category || "").toLowerCase();
  if (cat.includes("cinema") || cat.includes("theatre")) return "assets/images/event-cinema.jpg";
  if (cat.includes("board") || cat.includes("gaming")) return "assets/images/event-boardgames.jpg";
  if (cat.includes("festival") || cat.includes("campus")) return "assets/images/event-festival.jpg";
  return "assets/images/hero-concert.jpg";
}

function renderEventPreviewCards(events) {
  const container = qs("#landing-events-preview");
  if (!container) return;

  if (!events || !events.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No upcoming events posted yet</h3>
        <p>Check the events page or sign in to create the first student outing near you.</p>
        <div class="card-actions" style="justify-content:center;">
          <a href="events.html" class="btn btn-primary">Explore events</a>
          <a href="create-event.html" class="btn btn-secondary">Create an outing</a>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="landing-events-grid">
      ${events
        .map((ev) => {
          const imgUrl = resolveEventPreviewImage(ev);
          const countText = ev.max_participants
            ? `${ev.participant_count} / ${ev.max_participants} going`
            : `${ev.participant_count} going`;
          const dateText = formatDateTime(ev.start_datetime);
          const placeText = [ev.location, ev.city].filter(Boolean).join(" · ");

          return `
            <article class="landing-event-card">
              ${renderMediaWithFallback(imgUrl, ev.title, ev.category)}
              <div class="landing-event-body">
                <div class="meta-line">
                  ${ev.is_sample ? `<span class="badge-sample">Sample</span><span class="meta-sep" aria-hidden="true">·</span>` : ""}
                  <span>${escapeHtml(ev.category || "Outing")}</span>
                  <span class="meta-sep" aria-hidden="true">·</span>
                  <span class="tabular-num">${escapeHtml(countText)}</span>
                </div>
                <h3>${escapeHtml(ev.title)}</h3>
                <div class="landing-event-details">
                  <span class="tabular-num">${escapeHtml(dateText)}</span>
                  <span>${escapeHtml(placeText)}</span>
                </div>
                <div class="landing-event-actions">
                  <a href="events.html?event=${encodeURIComponent(ev.id)}" class="btn btn-primary btn-sm">View event</a>
                </div>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

async function loadLandingEventsPreview() {
  const container = qs("#landing-events-preview");
  if (!container) return;

  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading upcoming events near you...</p>
    </div>
  `;

  try {
    const res = await API.listEvents({ limit: 3 });
    renderEventPreviewCards((res.items || []).slice(0, 3));
  } catch {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Events could not be loaded right now</h3>
        <p>Open the full events page to browse or refresh upcoming outings.</p>
        <div class="card-actions" style="justify-content:center;">
          <a href="events.html" class="btn btn-primary">See all events</a>
        </div>
      </div>
    `;
  }
}

export function openLegalModal(kind) {
  if (kind === "privacy") {
    openModal({
      title: "UniMeet Privacy Policy",
      bodyHtml: `
        <div class="stack-form" style="gap:0.75rem;">
          <p>UniMeet stores only the profile, interest, event, group, and messaging data you choose to share in order to help you coordinate outings with other students.</p>
          <p class="muted-small"><strong>Optional campus info:</strong> Adding your university or faculty is optional and can be updated or removed anytime in your Profile.</p>
          <p class="muted-small"><strong>Private account details:</strong> Your account email is kept private and is never displayed on public student cards.</p>
          <p class="muted-small"><strong>Safety &amp; blocking:</strong> Blocking someone immediately hides you from each other across discovery, groups, Going Solo posts, and chat.</p>
        </div>
      `,
    });
    return;
  }

  openModal({
    title: "UniMeet Terms of Service",
    bodyHtml: `
      <div class="stack-form" style="gap:0.75rem;">
        <p>UniMeet is a student social coordination platform for discovering local events, joining groups, and finding people to attend outings with.</p>
        <p class="muted-small"><strong>Respectful conduct:</strong> Harassment, spam, impersonation, and unsafe behavior are not allowed and can be reported from any profile, group, or chat.</p>
        <p class="muted-small"><strong>Real-world meetups:</strong> Accounts are registered by email without identity document verification. Always meet in public places and let a friend know your plans.</p>
      </div>
    `,
  });
}

function wireLandingFooterModals() {
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-legal-modal]");
    if (!btn) return;
    openLegalModal(btn.dataset.legalModal);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.body?.dataset?.page !== "landing") return;
  loadLandingEventsPreview();
  wireLandingFooterModals();
});
