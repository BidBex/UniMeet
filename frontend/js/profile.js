/**
 * Profile overview, editing, interest picker, upcoming events/groups, and blocked users management (profile.html).
 */
import { API, setFallbackToken } from "./api.js";
import { renderDashboardShell, requireAuthenticatedUser } from "./navigation.js";
import { escapeHtml, formatDateTime, getInitials, qs, qsa, showToast } from "./utils.js";

const profileState = {
  user: null,
  activeTab: "overview",
  selectedInterestIds: new Set(),
  availableInterests: [],
};

async function renderOverviewTab() {
  const container = qs("#profile-content");
  const u = profileState.user;

  let upcomingHtml = `<p class="muted-small">Loading your outings...</p>`;
  let myGroupsHtml = `<p class="muted-small">Loading your groups...</p>`;
  try {
    const [eventsRes, groupsRes] = await Promise.all([API.listEvents({ limit: 30 }), API.listGroups()]);
    const joinedEvents = (eventsRes.items || []).filter((e) => e.is_joined);
    const myGroups = (groupsRes || []).filter((g) => g.is_member);

    upcomingHtml = joinedEvents.length
      ? joinedEvents
          .map(
            (ev) => `
          <div style="padding:0.55rem 0;border-bottom:1px solid var(--color-border);">
            <strong>${escapeHtml(ev.title)}</strong>
            <div class="muted-small tabular-num">${escapeHtml(formatDateTime(ev.start_datetime))} · ${escapeHtml(ev.city)}</div>
          </div>
        `
          )
          .join("")
      : `<p class="muted-small">You haven't joined any upcoming events yet.</p>`;

    myGroupsHtml = myGroups.length
      ? myGroups
          .map(
            (g) => `
          <div style="padding:0.55rem 0;border-bottom:1px solid var(--color-border);">
            <strong>${escapeHtml(g.name)}</strong>
            <div class="muted-small tabular-num">${g.member_count}/${g.max_members} members</div>
          </div>
        `
          )
          .join("")
      : `<p class="muted-small">You are not in any groups yet.</p>`;
  } catch {
    // Keep clean defaults
  }

  container.innerHTML = `
    <div class="cards-grid-2">
      <section class="card">
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem;">
            <div class="avatar-circle avatar-lg">${escapeHtml(getInitials(u.first_name, u.last_name))}</div>
            <div>
              <h2 style="margin-bottom:0.2rem;">${escapeHtml(u.first_name)} ${escapeHtml(u.last_name)}${u.age ? `, ${u.age}` : ""}</h2>
              <div class="muted-small">@${escapeHtml(u.username)} · ${u.is_verified ? "Verified account" : "Email account (unverified)"}</div>
              <div class="muted-small">${escapeHtml(u.university || "No university set")} · ${escapeHtml(u.city || "No city set")}</div>
            </div>
          </div>

          <form id="profile-edit-form" class="stack-form">
            <div class="field-row">
              <div class="field">
                <label for="pe-first">First name</label>
                <input id="pe-first" type="text" required value="${escapeHtml(u.first_name)}">
              </div>
              <div class="field">
                <label for="pe-last">Last name</label>
                <input id="pe-last" type="text" required value="${escapeHtml(u.last_name)}">
              </div>
            </div>

            <div class="field-row">
              <div class="field">
                <label for="pe-username">Username</label>
                <input id="pe-username" type="text" required minlength="3" maxlength="50" pattern="[A-Za-z0-9_.\\-]+" value="${escapeHtml(u.username)}">
              </div>
              <div class="field">
                <label for="pe-email">Email</label>
                <input id="pe-email" type="email" required value="${escapeHtml(u.email)}">
              </div>
            </div>

            <div class="field-row">
              <div class="field">
                <label for="pe-age">Age (optional)</label>
                <input id="pe-age" type="number" min="16" max="120" value="${u.age ?? ""}">
              </div>
              <div class="field">
                <label for="pe-city">City</label>
                <input id="pe-city" type="text" value="${escapeHtml(u.city || "")}">
              </div>
            </div>

            <div class="field">
              <label for="pe-uni">University</label>
              <input id="pe-uni" type="text" value="${escapeHtml(u.university || "")}">
            </div>

            <div class="field">
              <label for="pe-pic">Profile picture URL (optional)</label>
              <input id="pe-pic" type="url" value="${escapeHtml(u.profile_picture || "")}" placeholder="Leave blank to use initials avatar">
            </div>

            <div class="field">
              <label for="pe-bio">Bio</label>
              <textarea id="pe-bio" rows="3" maxlength="1000" placeholder="Tell students what events you enjoy...">${escapeHtml(u.bio || "")}</textarea>
            </div>

            <button type="submit" class="btn btn-primary" id="pe-save-btn">Save profile</button>
          </form>
        </div>
      </section>

      <div style="display:flex;flex-direction:column;gap:1.25rem;">
        <section class="card">
          <div class="card-body">
            <h3>Your Interests</h3>
            <p class="muted-small">${escapeHtml((u.interests || []).map((i) => i.name).join(", ") || "No interests selected yet.")}</p>
            <div class="card-actions">
              <button type="button" class="btn btn-secondary btn-sm" id="goto-interests-btn">Edit interests</button>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-body">
            <h3>Upcoming Events</h3>
            ${upcomingHtml}
          </div>
        </section>

        <section class="card">
          <div class="card-body">
            <h3>Your Groups</h3>
            ${myGroupsHtml}
          </div>
        </section>
      </div>
    </div>
  `;

  qs("#goto-interests-btn", container)?.addEventListener("click", () => {
    qsa("[data-profile-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.profileTab === "interests"));
    profileState.activeTab = "interests";
    loadProfileTab();
  });

  qs("#profile-edit-form", container).addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = qs("#pe-save-btn", container);
    btn.disabled = true;
    btn.textContent = "Saving...";

    const ageRaw = qs("#pe-age", container).value.trim();
    try {
      profileState.user = await API.updateMyProfile({
        first_name: qs("#pe-first", container).value.trim(),
        last_name: qs("#pe-last", container).value.trim(),
        username: qs("#pe-username", container).value.trim(),
        email: qs("#pe-email", container).value.trim(),
        age: ageRaw ? Number(ageRaw) : null,
        city: qs("#pe-city", container).value.trim() || null,
        university: qs("#pe-uni", container).value.trim() || null,
        profile_picture: qs("#pe-pic", container).value.trim() || null,
        bio: qs("#pe-bio", container).value.trim() || null,
      });
      renderDashboardShell(profileState.user);
      showToast("Profile updated!", "success");
      renderOverviewTab();
    } catch (err) {
      showToast(err.message, "error");
      btn.disabled = false;
      btn.textContent = "Save profile";
    }
  });
}

async function renderInterestsTab() {
  const container = qs("#profile-content");
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading interests...</p></div>`;

  try {
    const res = await API.getMyInterests();
    profileState.availableInterests = res.available_interests || [];
    profileState.selectedInterestIds = new Set((res.selected_interests || []).map((i) => i.id));

    const chips = profileState.availableInterests
      .map((item) => {
        const selected = profileState.selectedInterestIds.has(item.id);
        return `
          <button type="button" class="choice-chip ${selected ? "is-selected" : ""}" data-interest-id="${item.id}">
            ${escapeHtml(item.name)}
          </button>
        `;
      })
      .join("");

    container.innerHTML = `
      <section class="card">
        <div class="card-body">
          <h2>Select your interests</h2>
          <p>Interests power 60% of your UniMeet compatibility score.</p>
          <div class="chip-grid" style="margin:1.25rem 0;">${chips}</div>
          <button type="button" class="btn btn-primary" id="save-interests-btn">Save interests</button>
        </div>
      </section>
    `;

    qsa("[data-interest-id]", container).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.interestId);
        if (profileState.selectedInterestIds.has(id)) {
          profileState.selectedInterestIds.delete(id);
          btn.classList.remove("is-selected");
        } else {
          profileState.selectedInterestIds.add(id);
          btn.classList.add("is-selected");
        }
      });
    });

    qs("#save-interests-btn", container).addEventListener("click", async () => {
      const btn = qs("#save-interests-btn", container);
      btn.disabled = true;
      btn.textContent = "Saving...";
      try {
        const updated = await API.updateMyInterests(Array.from(profileState.selectedInterestIds));
        profileState.user.interests = updated.selected_interests;
        showToast("Interests saved!", "success");
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Save interests";
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function renderBlockedTab() {
  const container = qs("#profile-content");
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading safety settings...</p></div>`;

  try {
    const blocked = await API.listBlocked();
    const listHtml = blocked.length
      ? blocked
          .map(
            (b) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0.75rem 0;border-bottom:1px solid var(--color-border);">
            <div>
              <strong>${escapeHtml(b.blocked_user.first_name)} ${escapeHtml(b.blocked_user.last_name)}</strong>
              <div class="muted-small">@${escapeHtml(b.blocked_user.username)}</div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" data-unblock-id="${b.blocked_id}">Unblock</button>
          </div>
        `
          )
          .join("")
      : `<p class="muted-small">You haven't blocked any users.</p>`;

    container.innerHTML = `
      <div class="cards-grid-2">
        <section class="card">
          <div class="card-body">
            <h2>Blocked Users</h2>
            <p>Blocked users cannot see your profile, match with you, or send you messages.</p>
            <div>${listHtml}</div>
          </div>
        </section>
        <section class="card">
          <div class="card-body">
            <h2>Safety &amp; Meeting Guidelines</h2>
            <p>Meet in busy public places like university campuses or Piata Unirii cafes for first outings.</p>
            <p class="muted-small">Use the Safety button on any profile, Going Solo post, or chat to report inappropriate behavior or block an account immediately.</p>
          </div>
        </section>
      </div>
    `;

    qsa("[data-unblock-id]", container).forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await API.unblockUser(Number(btn.dataset.unblockId));
          showToast("User unblocked.", "success");
          renderBlockedTab();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function loadProfileTab() {
  if (profileState.activeTab === "overview") return renderOverviewTab();
  if (profileState.activeTab === "interests") return renderInterestsTab();
  return renderBlockedTab();
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.body?.dataset?.page !== "profile") return;
  profileState.user = await requireAuthenticatedUser();
  if (!profileState.user) return;

  qsa("[data-profile-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa("[data-profile-tab]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      profileState.activeTab = btn.dataset.profileTab;
      loadProfileTab();
    });
  });

  qs("#profile-logout-btn").addEventListener("click", async () => {
    try {
      await API.logout();
    } catch {
      // Ignore
    }
    setFallbackToken("");
    window.location.href = "login.html";
  });

  await loadProfileTab();
});
