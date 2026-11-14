/**
 * Profile overview, editing, Firebase Storage avatar uploads, email verification,
 * Hobbies manager (add/edit/remove + suggested chips), string interest picker,
 * public profile preview, upcoming events/groups, and blocked users management.
 */
import { API, setFallbackToken } from "./api.js";
import {
  openPublicProfileModal,
  renderAvatarHtml,
  renderDashboardShell,
  requireAuthenticatedUser,
} from "./navigation.js";
import { escapeHtml, formatDateTime, qs, qsa, showToast } from "./utils.js";

const DEFAULT_SUGGESTED_HOBBIES = [
  "Photography",
  "Bouldering",
  "Board Games",
  "Specialty Coffee",
  "Guitar",
  "Cycling",
  "Cooking",
  "Sketching",
  "Hiking",
  "Vinyl Collecting",
  "Film Making",
  "Running",
  "Chess",
  "Yoga",
  "Reading",
  "Baking",
  "3D Printing",
  "Gardening",
  "Table Tennis",
  "Volunteering",
];

const profileState = {
  user: null,
  activeTab: "overview",
  selectedInterestIds: new Set(),
  availableInterests: [],
  hobbies: [],
  suggestedHobbies: [...DEFAULT_SUGGESTED_HOBBIES],
  editingHobbyIndex: null,
  hobbySaveQueue: Promise.resolve(),
};

function normalizeHobbyName(raw) {
  return String(raw || "").trim().replace(/\s+/g, " ");
}

function enqueueHobbySync(nextHobbies, feedbackText = "Hobbies updated") {
  const container = qs("#hobbies-section");
  const statusEl = container ? qs("#hobbies-sync-status", container) : null;
  if (statusEl) statusEl.textContent = "Saving...";

  profileState.hobbySaveQueue = profileState.hobbySaveQueue
    .then(async () => {
      const res = await API.updateMyHobbies(nextHobbies);
      profileState.hobbies = res.selected_hobbies || [];
      profileState.suggestedHobbies = res.suggested_hobbies?.length
        ? res.suggested_hobbies
        : [...DEFAULT_SUGGESTED_HOBBIES];
      if (profileState.user) {
        profileState.user.hobbies = [...profileState.hobbies];
      }
      renderHobbiesSection();
      const updatedStatus = qs("#hobbies-sync-status");
      if (updatedStatus) updatedStatus.textContent = feedbackText;
    })
    .catch((err) => {
      showToast(err.message || "Could not update hobbies.", "error");
      if (profileState.user) {
        profileState.hobbies = [...(profileState.user.hobbies || [])];
      }
      renderHobbiesSection();
    });

  return profileState.hobbySaveQueue;
}

function renderHobbiesSection() {
  const host = qs("#hobbies-section");
  if (!host) return;

  const selected = profileState.hobbies || [];
  const selectedKeys = new Set(selected.map((h) => h.toLowerCase()));

  const selectedHtml = selected.length
    ? selected
        .map(
          (hobby, idx) => `
        <span class="hobby-chip-selected">
          <button
            type="button"
            class="hobby-chip-label"
            data-edit-hobby="${idx}"
            title="Click to edit ${escapeHtml(hobby)}"
          >${escapeHtml(hobby)}</button>
          <button
            type="button"
            class="hobby-chip-btn"
            data-edit-hobby="${idx}"
            aria-label="Edit ${escapeHtml(hobby)}"
            title="Edit hobby"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button
            type="button"
            class="hobby-chip-btn"
            data-remove-hobby="${idx}"
            aria-label="Remove ${escapeHtml(hobby)}"
            title="Remove hobby"
          >&times;</button>
        </span>
      `
        )
        .join("")
    : `<p class="muted-small" style="margin:0;">No hobbies added yet. Tap a suggestion below or type your own.</p>`;

  const editValue =
    profileState.editingHobbyIndex !== null && selected[profileState.editingHobbyIndex] !== undefined
      ? selected[profileState.editingHobbyIndex]
      : null;

  const inlineEditHtml =
    editValue !== null
      ? `
      <form id="hobby-inline-edit-form" class="hobby-edit-inline">
        <label class="sr-only" for="hobby-edit-input">Edit hobby</label>
        <input id="hobby-edit-input" type="text" minlength="2" maxlength="40" required value="${escapeHtml(editValue)}" placeholder="Rename hobby">
        <button type="submit" class="btn btn-primary btn-sm">Save</button>
        <button type="button" class="btn btn-secondary btn-sm" id="hobby-edit-cancel">Cancel</button>
      </form>
    `
      : "";

  const suggestedHtml = profileState.suggestedHobbies
    .map((item) => {
      const isSelected = selectedKeys.has(item.toLowerCase());
      return `
        <button
          type="button"
          class="choice-chip ${isSelected ? "is-selected" : ""}"
          data-suggest-hobby="${escapeHtml(item)}"
          aria-pressed="${isSelected ? "true" : "false"}"
        >
          ${isSelected ? "✓ " : "+ "}${escapeHtml(item)}
        </button>
      `;
    })
    .join("");

  host.innerHTML = `
    <div class="card-body">
      <div class="hobbies-card-header">
        <h3 style="margin:0;">Hobbies</h3>
        <span class="hobbies-count-label tabular-num" id="hobbies-sync-status">${selected.length}/20 added</span>
      </div>
      <p class="muted-small">Shown on your public profile and right under your name in Discover. Click any added hobby to edit it.</p>

      <div class="hobby-selected-list" aria-label="Your selected hobbies">${selectedHtml}</div>
      ${inlineEditHtml}

      <form id="hobby-custom-form" class="hobby-add-row">
        <label class="sr-only" for="hobby-custom-input">Add a custom hobby</label>
        <input
          id="hobby-custom-input"
          type="text"
          maxlength="40"
          placeholder="Add a custom hobby (e.g. Ceramics, Climbing)..."
        >
        <button type="submit" class="btn btn-primary">Add</button>
      </form>

      <div class="hobby-suggested-label">Suggested hobbies</div>
      <div class="chip-grid">${suggestedHtml}</div>
    </div>
  `;

  qsa("[data-edit-hobby]", host).forEach((btn) => {
    btn.addEventListener("click", () => {
      profileState.editingHobbyIndex = Number(btn.dataset.editHobby);
      renderHobbiesSection();
      const input = qs("#hobby-edit-input", host);
      if (input) {
        input.focus();
        input.select();
      }
    });
  });

  const editForm = qs("#hobby-inline-edit-form", host);
  if (editForm) {
    editForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const idx = profileState.editingHobbyIndex;
      const nextName = normalizeHobbyName(qs("#hobby-edit-input", host).value);
      if (nextName.length < 2 || nextName.length > 40) {
        showToast("Hobby must be between 2 and 40 characters.", "error");
        return;
      }
      const duplicateIdx = profileState.hobbies.findIndex(
        (h, i) => i !== idx && h.toLowerCase() === nextName.toLowerCase()
      );
      if (duplicateIdx !== -1) {
        const statusEl = qs("#hobbies-sync-status", host);
        if (statusEl) statusEl.textContent = "Already in list";
        return;
      }
      const updated = [...profileState.hobbies];
      updated[idx] = nextName;
      profileState.editingHobbyIndex = null;
      profileState.hobbies = updated;
      renderHobbiesSection();
      enqueueHobbySync(updated, "Saved");
    });

    qs("#hobby-edit-cancel", host)?.addEventListener("click", () => {
      profileState.editingHobbyIndex = null;
      renderHobbiesSection();
    });
  }

  qsa("[data-remove-hobby]", host).forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.removeHobby);
      const updated = profileState.hobbies.filter((_, i) => i !== idx);
      if (profileState.editingHobbyIndex === idx) {
        profileState.editingHobbyIndex = null;
      } else if (profileState.editingHobbyIndex !== null && profileState.editingHobbyIndex > idx) {
        profileState.editingHobbyIndex -= 1;
      }
      profileState.hobbies = updated;
      renderHobbiesSection();
      enqueueHobbySync(updated, "Removed");
    });
  });

  qs("#hobby-custom-form", host).addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = qs("#hobby-custom-input", host);
    const cleaned = normalizeHobbyName(input.value);
    if (!cleaned) return;
    if (cleaned.length < 2 || cleaned.length > 40) {
      showToast("Hobby must be between 2 and 40 characters.", "error");
      return;
    }
    if (profileState.hobbies.some((h) => h.toLowerCase() === cleaned.toLowerCase())) {
      input.value = "";
      const statusEl = qs("#hobbies-sync-status", host);
      if (statusEl) statusEl.textContent = "Already added";
      return;
    }
    if (profileState.hobbies.length >= 20) {
      showToast("You can add up to 20 hobbies.", "error");
      return;
    }
    const updated = [...profileState.hobbies, cleaned];
    profileState.hobbies = updated;
    input.value = "";
    renderHobbiesSection();
    enqueueHobbySync(updated, "Added");
  });

  qsa("[data-suggest-hobby]", host).forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.suggestHobby;
      const existingIdx = profileState.hobbies.findIndex(
        (h) => h.toLowerCase() === name.toLowerCase()
      );
      let updated;
      if (existingIdx !== -1) {
        updated = profileState.hobbies.filter((_, i) => i !== existingIdx);
        profileState.editingHobbyIndex = null;
      } else {
        if (profileState.hobbies.length >= 20) {
          showToast("You can add up to 20 hobbies.", "error");
          return;
        }
        updated = [...profileState.hobbies, name];
      }
      profileState.hobbies = updated;
      renderHobbiesSection();
      enqueueHobbySync(updated, "Saved");
    });
  });
}

async function renderOverviewTab() {
  const container = qs("#profile-content");
  const u = profileState.user;

  let upcomingHtml = `<p class="muted-small">Loading your outings...</p>`;
  let myGroupsHtml = `<p class="muted-small">Loading your groups...</p>`;
  try {
    const [eventsRes, groupsRes, hobbiesRes] = await Promise.all([
      API.listEvents({ limit: 30 }),
      API.listGroups(),
      API.getMyHobbies().catch(() => null),
    ]);
    if (hobbiesRes) {
      profileState.hobbies = hobbiesRes.selected_hobbies || [];
      if (hobbiesRes.suggested_hobbies?.length) {
        profileState.suggestedHobbies = hobbiesRes.suggested_hobbies;
      }
      profileState.user.hobbies = [...profileState.hobbies];
    } else {
      profileState.hobbies = [...(u.hobbies || [])];
    }

    const joinedEvents = (eventsRes.items || []).filter((e) => e.is_joined);
    const myGroups = (groupsRes || []).filter((g) => g.is_member);

    upcomingHtml = joinedEvents.length
      ? joinedEvents
          .map(
            (ev) => `
          <div style="padding:0.55rem 0;border-bottom:1px solid var(--color-border);">
            <a href="events.html?event=${encodeURIComponent(ev.id)}" style="font-weight:600;display:block;">${escapeHtml(ev.title)}</a>
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
            <a href="groups.html?group=${encodeURIComponent(g.id)}" style="font-weight:600;display:block;">${escapeHtml(g.name)}</a>
            <div class="muted-small tabular-num">${g.member_count}/${g.max_members} members</div>
          </div>
        `
          )
          .join("")
      : `<p class="muted-small">You are not in any groups yet.</p>`;
  } catch {
    profileState.hobbies = [...(u.hobbies || [])];
  }

  const verifyBannerHtml = !u.email_verified
    ? `
      <div class="verify-banner" id="email-verify-banner">
        <div>
          <strong>Verify your email address</strong>
          <div class="muted-small" id="verify-banner-msg">Confirm ${escapeHtml(u.email || "your email")} via Firebase Authentication.</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="send-verification-btn">Send verification email</button>
      </div>
    `
    : "";

  const statsRowHtml =
    typeof u.followers_count === "number" || typeof u.following_count === "number"
      ? `
      <div class="profile-stats-row">
        <div class="profile-stat-item">
          <strong class="tabular-num">${u.followers_count ?? 0}</strong>
          <span>Followers</span>
        </div>
        <div class="profile-stat-item">
          <strong class="tabular-num">${u.following_count ?? 0}</strong>
          <span>Following</span>
        </div>
        <div class="profile-stat-item">
          <strong class="tabular-num">${u.posts_count ?? 0}</strong>
          <span>Posts</span>
        </div>
        <div class="profile-stat-item" style="align-self:center;margin-left:auto;">
          <a href="feed.html" class="btn btn-secondary btn-sm">View Feed</a>
        </div>
      </div>
    `
      : "";

  container.innerHTML = `
    <div class="cards-grid-2">
      <section class="card">
        <div class="card-body">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.9rem;margin-bottom:1rem;">
            <div style="display:flex;align-items:center;gap:1rem;min-width:0;">
              <div id="profile-header-avatar">${renderAvatarHtml(u, true)}</div>
              <div style="min-width:0;">
                <h2 style="margin-bottom:0.2rem;">${escapeHtml(u.first_name)} ${escapeHtml(u.last_name)}${u.age ? `, ${u.age}` : ""}</h2>
                <div class="muted-small">@${escapeHtml(u.username)} · ${u.email_verified ? "Verified email" : "Email unverified"}</div>
                <div class="muted-small">${escapeHtml(u.university || "No university set")} · ${escapeHtml(u.city || "No city set")}</div>
              </div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" id="preview-public-profile-btn">View public profile</button>
          </div>

          ${statsRowHtml}
          ${verifyBannerHtml}

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
              <label for="pe-pic-file">Upload profile photo (max 5 MB, JPG/PNG/WebP/GIF)</label>
              <div class="upload-field-row">
                <input id="pe-pic-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
              </div>
              <div id="pe-upload-progress" class="upload-progress-track" hidden>
                <div id="pe-upload-progress-bar" class="upload-progress-bar"></div>
              </div>
              <span id="pe-upload-status" class="muted-small" aria-live="polite" hidden></span>
            </div>

            <div class="field">
              <label for="pe-pic">Profile picture URL (optional)</label>
              <input id="pe-pic" type="url" value="${escapeHtml(u.profile_picture || "")}" placeholder="Leave blank to use initials avatar">
            </div>

            <div class="field">
              <label for="pe-bio">Bio</label>
              <textarea id="pe-bio" rows="3" maxlength="1000" placeholder="Tell students what events you enjoy...">${escapeHtml(u.bio || "")}</textarea>
            </div>

            <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
              <button type="submit" class="btn btn-primary" id="pe-save-btn">Save profile</button>
              <span class="muted-small status-text-success" id="profile-save-status" aria-live="polite"></span>
            </div>
          </form>
        </div>
      </section>

      <div style="display:flex;flex-direction:column;gap:1.25rem;">
        <section class="card" id="hobbies-section"></section>

        <section class="card">
          <div class="card-body">
            <h3>Your Interests</h3>
            <p class="muted-small">${escapeHtml((u.interests || []).map((i) => i.name).join(" · ") || "No interests selected yet.")}</p>
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

  renderHobbiesSection();

  qs("#preview-public-profile-btn", container)?.addEventListener("click", () => {
    openPublicProfileModal(profileState.user.id);
  });

  qs("#send-verification-btn", container)?.addEventListener("click", async () => {
    const btn = qs("#send-verification-btn", container);
    const msgEl = qs("#verify-banner-msg", container);
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      const res = await API.sendVerificationEmail();
      if (msgEl) msgEl.textContent = res.message;
      btn.textContent = "Email sent";
    } catch (err) {
      showToast(err.message || "Could not send verification email.", "error");
      btn.disabled = false;
      btn.textContent = "Send verification email";
    }
  });

  const picFileInput = qs("#pe-pic-file", container);
  const picProgress = qs("#pe-upload-progress", container);
  const picProgressBar = qs("#pe-upload-progress-bar", container);
  const picUploadStatus = qs("#pe-upload-status", container);
  const picUrlInput = qs("#pe-pic", container);
  const saveBtn = qs("#pe-save-btn", container);

  picFileInput?.addEventListener("change", async () => {
    const file = picFileInput.files?.[0];
    if (!file) return;

    saveBtn.disabled = true;
    picProgress.hidden = false;
    picProgressBar.style.width = "0%";
    picUploadStatus.hidden = false;
    picUploadStatus.className = "muted-small";
    picUploadStatus.textContent = "Uploading photo (0%)...";

    try {
      const url = await API.uploadProfilePicture(file, (pct) => {
        picProgressBar.style.width = `${pct}%`;
        picUploadStatus.textContent = `Uploading photo (${pct}%)...`;
      });
      picUrlInput.value = url;
      const avatarHost = qs("#profile-header-avatar", container);
      if (avatarHost) {
        avatarHost.innerHTML = renderAvatarHtml({ ...profileState.user, profile_picture: url }, true);
      }
      picUploadStatus.className = "muted-small status-text-success";
      picUploadStatus.textContent = "Photo uploaded — click Save profile to update.";
    } catch (err) {
      picFileInput.value = "";
      picProgress.hidden = true;
      picUploadStatus.className = "field-error";
      picUploadStatus.textContent = err.message || "Could not upload profile photo.";
    } finally {
      saveBtn.disabled = false;
    }
  });

  qs("#goto-interests-btn", container)?.addEventListener("click", () => {
    qsa("[data-profile-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.profileTab === "interests"));
    profileState.activeTab = "interests";
    loadProfileTab();
  });

  qs("#profile-edit-form", container).addEventListener("submit", async (ev) => {
    ev.preventDefault();
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

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
        hobbies: profileState.hobbies,
      });
      renderDashboardShell(profileState.user);
      await renderOverviewTab();
      const statusEl = qs("#profile-save-status", qs("#profile-content"));
      if (statusEl) statusEl.textContent = "Saved";
    } catch (err) {
      showToast(err.message, "error");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save profile";
    }
  });
}

async function renderInterestsTab() {
  const container = qs("#profile-content");
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading interests...</p></div>`;

  try {
    const res = await API.getMyInterests();
    profileState.availableInterests = res.available_interests || [];
    profileState.selectedInterestIds = new Set((res.selected_interests || []).map((i) => String(i.id)));

    const chips = profileState.availableInterests
      .map((item) => {
        const selected = profileState.selectedInterestIds.has(String(item.id));
        return `
          <button type="button" class="choice-chip ${selected ? "is-selected" : ""}" data-interest-id="${escapeHtml(item.id)}">
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
          <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
            <button type="button" class="btn btn-primary" id="save-interests-btn">Save interests</button>
            <span class="muted-small status-text-success" id="interests-save-status" aria-live="polite"></span>
          </div>
        </div>
      </section>
    `;

    qsa("[data-interest-id]", container).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = String(btn.dataset.interestId);
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
      const statusEl = qs("#interests-save-status", container);
      btn.disabled = true;
      btn.textContent = "Saving...";
      if (statusEl) statusEl.textContent = "";
      try {
        const updated = await API.updateMyInterests(Array.from(profileState.selectedInterestIds));
        profileState.user.interests = updated.selected_interests;
        if (statusEl) statusEl.textContent = "Saved";
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
            <button type="button" class="btn btn-secondary btn-sm" data-unblock-id="${escapeHtml(b.blocked_id)}">Unblock</button>
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
          await API.unblockUser(String(btn.dataset.unblockId));
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
  profileState.hobbies = [...(profileState.user.hobbies || [])];

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
