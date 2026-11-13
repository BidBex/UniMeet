/**
 * Mutual matches screen: view event matches, compatibility, open chat, unmatch, or report/block.
 */
import { API } from "./api.js";
import { openSafetyModal, requireAuthenticatedUser } from "./navigation.js";
import { escapeHtml, formatDateTime, getInitials, qs, qsa, showToast } from "./utils.js";

async function loadMatches() {
  const container = qs("#matches-container");
  if (!container) return;

  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading your matches...</p>
    </div>
  `;

  try {
    const matches = await API.listMatches();
    if (!matches.length) {
      container.innerHTML = `
        <div class="empty-state">
          <h2>No mutual matches yet</h2>
          <p>Head over to Discover and like people interested in the same events as you.</p>
          <a href="discover.html" class="btn btn-primary">Explore Discover</a>
        </div>
      `;
      return;
    }

    container.innerHTML = `<div class="cards-grid">${matches
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
                    ? `<span aria-hidden="true">·</span><span class="tabular-num">${compat.compatibility}% match</span>`
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
      .join("")}</div>`;

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
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.body?.dataset?.page !== "matches") return;
  const user = await requireAuthenticatedUser();
  if (!user) return;
  await loadMatches();
});
