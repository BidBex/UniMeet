/**
 * Student Groups, Going Solo Feed, and University Community Hub (groups.html).
 * Supports category filtering, group cover images, in-group discussions/posts,
 * invitation handling, student directory search, follow/unfollow, and direct messaging.
 */
import { API } from "./api.js";
import { CONFIG } from "./config.js";
import {
  buildGroupMenuHtml,
  getCurrentUser,
  openPublicProfileModal,
  openSafetyModal,
  renderAvatarHtml,
  renderHobbyTags,
  requireAuthenticatedUser,
  wireGroupMenuActions,
} from "./navigation.js";
import {
  escapeHtml,
  formatDateTime,
  formatRelativeTime,
  openModal,
  qs,
  qsa,
  renderMediaWithFallback,
  showToast,
} from "./utils.js";

const groupState = {
  user: null,
  activeTab: "groups",
  communityRelation: "all",
  filters: { q: "", category: "", university: "", city: "" },
};

function populateGroupCategories(selectEl, includeAll = true) {
  if (!selectEl) return;
  const cats = CONFIG.GROUP_CATEGORIES || [];
  const opts = cats
    .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
    .join("");
  selectEl.innerHTML = includeAll ? `<option value="">All categories</option>${opts}` : opts;
}

async function openGroupDetailsModal(group) {
  try {
    const [members, groupPosts] = await Promise.all([
      API.getGroupMembers(group.id),
      API.listPosts({ groupId: group.id }).catch(() => []),
    ]);
    const isAdmin = groupState.user && group.creator_id === groupState.user.id;

    const membersHtml = members
      .map((m) => {
        const name = `${m.user.first_name} ${m.user.last_name}`.trim();
        const pendingBadge =
          m.status === "pending"
            ? ` · <span class="status-text-warn">Pending</span>`
            : ` · <span>${escapeHtml(m.role)}</span>`;
        const approveBtn =
          isAdmin && m.status === "pending"
            ? `<button type="button" class="btn btn-primary btn-sm" data-approve-uid="${escapeHtml(m.user_id)}">Approve</button>`
            : "";
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--color-border);">
            <button type="button" class="feed-author-btn" data-member-profile="${escapeHtml(m.user_id)}">
              ${renderAvatarHtml(m.user)}
              <div>
                <strong>${escapeHtml(name)}</strong>
                <div class="muted-small">${escapeHtml(m.user.university || m.user.city || `@${m.user.username}`)}${pendingBadge}</div>
              </div>
            </button>
            ${approveBtn}
          </div>
        `;
      })
      .join("");

    const renderGroupPostsHtml = (posts) => {
      if (!posts.length) {
        return `<p class="muted-small">No discussions yet — share a kickoff note below!</p>`;
      }
      return `
        <div class="group-discussions-list">
          ${posts
            .map((p) => {
              const authorName = p.author
                ? `${p.author.first_name} ${p.author.last_name}`.trim()
                : "Student";
              return `
                <div class="group-discussion-item">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.35rem;">
                    <strong>${escapeHtml(authorName)}</strong>
                    <span class="muted-small tabular-num">${escapeHtml(formatRelativeTime(p.created_at))}</span>
                  </div>
                  <p style="margin:0 0 0.45rem;font-size:0.92rem;">${escapeHtml(p.content)}</p>
                  <div class="muted-small tabular-num">
                    <button type="button" class="btn btn-secondary btn-sm" data-grp-like-post="${escapeHtml(p.id)}">
                      ${p.is_liked ? "Liked" : "Like"} (${p.like_count})
                    </button>
                    <a href="feed.html?post=${encodeURIComponent(p.id)}" class="btn btn-secondary btn-sm" style="margin-left:0.35rem;">Comments (${p.comment_count})</a>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    };

    const inviteOrJoinButtons =
      group.is_member
        ? `<button type="button" class="btn btn-secondary btn-sm" id="modal-leave-grp">Leave group</button>`
        : group.membership_status === "invited"
        ? `<button type="button" class="btn btn-primary btn-sm" id="modal-join-grp">Accept invitation</button>
           <button type="button" class="btn btn-secondary btn-sm" id="modal-decline-grp">Decline</button>`
        : group.membership_status === "pending"
        ? `<button type="button" class="btn btn-secondary btn-sm" disabled>Request pending</button>`
        : `<button type="button" class="btn btn-primary btn-sm" id="modal-join-grp">${group.is_public ? "Join group" : "Request to join"}</button>`;

    openModal({
      title: group.name,
      headerActionsHtml: buildGroupMenuHtml(group, groupState.user),
      bodyHtml: `
        <div>
          ${group.cover_image ? `<div class="group-cover-frame" style="margin-bottom:0.9rem;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--color-border);">${renderMediaWithFallback(group.cover_image, group.name, group.category || group.name)}</div>` : ""}
          <div class="meta-line">
            ${group.category ? `<span class="badge-inline">${escapeHtml(group.category)}</span><span aria-hidden="true">·</span>` : ""}
            <span>${group.is_public ? "Public group" : "Private group"}</span>
            <span aria-hidden="true">·</span>
            <span class="tabular-num">${group.member_count}/${group.max_members} members</span>
            ${group.location ? `<span aria-hidden="true">·</span><span>${escapeHtml(group.location)}</span>` : ""}
          </div>
          <p>${escapeHtml(group.description)}</p>
          ${group.event_title ? `<p><strong>Event:</strong> ${escapeHtml(group.event_title)}</p>` : ""}
          ${group.university ? `<p><strong>University:</strong> ${escapeHtml(group.university)}</p>` : ""}
          ${group.interests_summary ? `<p><strong>Interests:</strong> ${escapeHtml(group.interests_summary)}</p>` : ""}

          <div class="card-actions">
            ${
              group.is_member && group.conversation_id
                ? `<a href="messages.html?conversation=${encodeURIComponent(group.conversation_id)}" class="btn btn-primary btn-sm">Open group chat</a>`
                : ""
            }
            ${inviteOrJoinButtons}
            ${
              isAdmin
                ? `<button type="button" class="btn btn-danger btn-sm" id="modal-delete-grp">Delete group</button>`
                : ""
            }
          </div>

          <div class="divider-line"></div>
          <h3>Group Discussions (${groupPosts.length})</h3>
          <div id="modal-group-posts">${renderGroupPostsHtml(groupPosts)}</div>
          ${
            groupState.user && group.is_member
              ? `
            <form id="modal-group-post-form" class="feed-comment-form" style="margin-top:0.75rem;">
              <input id="modal-group-post-input" type="text" required minlength="3" maxlength="500" placeholder="Share a message with the group...">
              <button type="submit" class="btn btn-primary btn-sm">Post</button>
            </form>
          `
              : ""
          }

          <div class="divider-line"></div>
          <h3>Members (${members.length})</h3>
          <div>${membersHtml || '<p class="muted-small">No visible members.</p>'}</div>
        </div>
      `,
      onMount: (root, close) => {
        wireGroupMenuActions({
          container: root,
          groupId: group.id,
          groupName: group.name,
          creatorId: group.creator_id,
          currentUser: groupState.user,
          onLeft: () => {
            close();
            loadGroupsTab();
          },
          onBlocked: () => {
            close();
            loadGroupsTab();
          },
        });

        qs("#modal-join-grp", root)?.addEventListener("click", async () => {
          if (!groupState.user) return requireAuthenticatedUser();
          try {
            await API.joinGroup(group.id);
            showToast(`Joined ${group.name}!`, "success");
            close();
            loadGroupsTab();
          } catch (err) {
            showToast(err.message, "error");
          }
        });

        qs("#modal-decline-grp", root)?.addEventListener("click", async () => {
          try {
            await API.declineGroupInvite(group.id);
            showToast("Invitation declined.", "info");
            close();
            loadGroupsTab();
          } catch (err) {
            showToast(err.message, "error");
          }
        });

        qs("#modal-leave-grp", root)?.addEventListener("click", async () => {
          try {
            await API.leaveGroup(group.id);
            showToast(`Left ${group.name}.`, "info");
            close();
            loadGroupsTab();
          } catch (err) {
            showToast(err.message, "error");
          }
        });

        const delBtn = qs("#modal-delete-grp", root);
        delBtn?.addEventListener("click", async () => {
          if (delBtn.dataset.armed !== "true") {
            delBtn.dataset.armed = "true";
            delBtn.textContent = "Confirm delete";
            return;
          }
          try {
            await API.deleteGroup(group.id);
            close();
            loadGroupsTab();
          } catch (err) {
            showToast(err.message, "error");
          }
        });

        const bindPostLikes = () => {
          qsa("[data-grp-like-post]", root).forEach((btn) => {
            btn.addEventListener("click", async () => {
              const res = await API.toggleLikePost(btn.dataset.grpLikePost);
              btn.textContent = `${res.is_liked ? "Liked" : "Like"} (${res.like_count})`;
            });
          });
        };
        bindPostLikes();

        qs("#modal-group-post-form", root)?.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const input = qs("#modal-group-post-input", root);
          const content = input.value.trim();
          if (!content) return;
          try {
            await API.createPost({
              content,
              group_id: group.id,
              tag: group.category || "Campus Life",
            });
            input.value = "";
            const refreshed = await API.listPosts({ groupId: group.id });
            qs("#modal-group-posts", root).innerHTML = renderGroupPostsHtml(refreshed);
            bindPostLikes();
          } catch (err) {
            showToast(err.message || "Could not post in group.", "error");
          }
        });

        qsa("[data-member-profile]", root).forEach((btn) => {
          btn.addEventListener("click", () => {
            openPublicProfileModal(btn.dataset.memberProfile);
          });
        });

        qsa("[data-approve-uid]", root).forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await API.approveGroupMember(group.id, btn.dataset.approveUid);
              close();
              loadGroupsTab();
            } catch (err) {
              showToast(err.message, "error");
            }
          });
        });
      },
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function openCreateGroupModal() {
  if (!groupState.user) return requireAuthenticatedUser();
  let eventOptions = `<option value="">General group (no specific event)</option>`;
  try {
    const evs = await API.listEvents({ limit: 30 });
    eventOptions += (evs.items || [])
      .map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.title)} (${escapeHtml(e.city)})</option>`)
      .join("");
  } catch {
    // Ignore
  }

  const categoryOptions = (CONFIG.GROUP_CATEGORIES || [])
    .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
    .join("");

  openModal({
    title: "Create a Student Group",
    bodyHtml: `
      <form id="create-group-form" class="stack-form">
        <div class="field">
          <label for="cg-name">Group name</label>
          <input id="cg-name" type="text" required minlength="3" maxlength="120" placeholder="e.g. UPT Festival Crew">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="cg-category">Category</label>
            <select id="cg-category">${categoryOptions}</select>
          </div>
          <div class="field">
            <label for="cg-event">Linked event (optional)</label>
            <select id="cg-event">${eventOptions}</select>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="cg-max">Max members</label>
            <input id="cg-max" type="number" min="2" max="100" value="8" required>
          </div>
          <div class="field">
            <label for="cg-public">Visibility</label>
            <select id="cg-public">
              <option value="true">Public (anyone can join)</option>
              <option value="false">Private (approval required)</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="cg-uni">University (optional)</label>
            <input id="cg-uni" type="text" value="${escapeHtml(groupState.user.university || "")}">
          </div>
          <div class="field">
            <label for="cg-city">Location / City</label>
            <input id="cg-city" type="text" value="${escapeHtml(groupState.user.city || "Timisoara")}">
          </div>
        </div>
        <div class="field">
          <label for="cg-interests">Group interests</label>
          <input id="cg-interests" type="text" placeholder="Indie Rock, Board Games, Coffee">
        </div>
        <div class="field">
          <label for="cg-desc">Description</label>
          <textarea id="cg-desc" rows="3" required minlength="5" placeholder="Who is welcome and how do you plan to meet?"></textarea>
        </div>
        <button type="submit" class="btn btn-primary">Create group</button>
      </form>
    `,
    onMount: (root, close) => {
      qs("#create-group-form", root).addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const eventVal = qs("#cg-event", root).value;
        try {
          await API.createGroup({
            name: qs("#cg-name", root).value.trim(),
            category: qs("#cg-category", root).value,
            description: qs("#cg-desc", root).value.trim(),
            event_id: eventVal || null,
            max_members: Number(qs("#cg-max", root).value),
            is_public: qs("#cg-public", root).value === "true",
            university: qs("#cg-uni", root).value.trim() || null,
            location: qs("#cg-city", root).value.trim() || null,
            interests_summary: qs("#cg-interests", root).value.trim() || null,
          });
          close();
          groupState.activeTab = "groups";
          loadGroupsTab();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    },
  });
}

async function loadGroupsTab() {
  const container = qs("#groups-content");
  if (!container) return;
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>`;

  try {
    if (groupState.activeTab === "groups") {
      const groups = await API.listGroups(groupState.filters);
      if (!groups.length) {
        container.innerHTML = `
          <div class="empty-state">
            <h2>No groups found</h2>
            <p>Start the first group for your university or widen your category filter.</p>
            <button type="button" class="btn btn-primary" id="empty-create-grp">Create a group</button>
          </div>
        `;
        qs("#empty-create-grp", container)?.addEventListener("click", openCreateGroupModal);
        return;
      }

      container.innerHTML = `<div class="cards-grid">${groups
        .map(
          (g) => `
          <article class="card">
            ${
              g.cover_image
                ? `<div class="group-cover-frame">${renderMediaWithFallback(g.cover_image, g.name, g.category || g.name)}</div>`
                : ""
            }
            <div class="card-body">
              <div class="meta-line">
                ${g.category ? `<span class="badge-inline">${escapeHtml(g.category)}</span><span aria-hidden="true">·</span>` : ""}
                <span class="tabular-num">${g.member_count}/${g.max_members} members</span>
                ${g.location ? `<span aria-hidden="true">·</span><span>${escapeHtml(g.location)}</span>` : ""}
              </div>
              <h3>
                ${escapeHtml(g.name)}
                ${g.is_sample ? `<span class="badge-sample">Sample</span>` : ""}
                ${g.membership_status === "invited" ? `<span class="badge-inline">Invited</span>` : ""}
              </h3>
              ${g.event_title ? `<p class="muted-small" style="margin-bottom:0.4rem;">Event: <strong>${escapeHtml(g.event_title)}</strong></p>` : ""}
              <p>${escapeHtml(g.description)}</p>
              ${g.university ? `<p class="muted-small">${escapeHtml(g.university)}</p>` : ""}
              <div class="card-actions">
                <button type="button" class="btn btn-primary btn-sm" data-open-group="${escapeHtml(g.id)}">View &amp; Posts</button>
                ${
                  g.is_member && g.conversation_id
                    ? `<a href="messages.html?conversation=${encodeURIComponent(g.conversation_id)}" class="btn btn-secondary btn-sm">Chat</a>`
                    : g.membership_status === "invited"
                    ? `<button type="button" class="btn btn-coral btn-sm" data-quick-join="${escapeHtml(g.id)}">Accept Invite</button>`
                    : !g.is_member && g.membership_status !== "pending"
                    ? `<button type="button" class="btn btn-secondary btn-sm" data-quick-join="${escapeHtml(g.id)}">${g.is_public ? "Join" : "Request"}</button>`
                    : `<span class="muted-small" style="align-self:center;">${g.membership_status === "pending" ? "Pending" : "Member"}</span>`
                }
              </div>
            </div>
          </article>
        `
        )
        .join("")}</div>`;

      qsa("[data-open-group]", container).forEach((btn) => {
        btn.addEventListener("click", () => {
          const grp = groups.find((x) => x.id === btn.dataset.openGroup);
          if (grp) openGroupDetailsModal(grp);
        });
      });

      qsa("[data-quick-join]", container).forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!groupState.user) return requireAuthenticatedUser();
          try {
            await API.joinGroup(btn.dataset.quickJoin);
            showToast("Joined group!", "success");
            loadGroupsTab();
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      });
    } else if (groupState.activeTab === "solo") {
      const solos = await API.listSolo({
        university: groupState.filters.university,
        city: groupState.filters.city,
      });
      if (!solos.length) {
        container.innerHTML = `
          <div class="empty-state">
            <h2>No active Going Solo posts</h2>
            <p>Want to go somewhere without a group yet? Post a Going Solo note.</p>
            <a href="create-event.html" class="btn btn-coral">Announce Going Solo</a>
          </div>
        `;
        return;
      }

      container.innerHTML = `<div class="cards-grid">${solos
        .map((s) => {
          const isMine = groupState.user && groupState.user.id === s.user_id;
          const name = `${s.user.first_name} ${s.user.last_name}`;
          const hobbiesHtml = renderHobbyTags(s.user.hobbies || [], 3);
          return `
            <article class="card">
              <div class="card-body">
                <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.55rem;">
                  ${renderAvatarHtml(s.user)}
                  <div>
                    <h3 style="margin-bottom:0.1rem;">${escapeHtml(name)}</h3>
                    <div class="muted-small">${escapeHtml(s.user.university || s.event_city)}</div>
                  </div>
                </div>
                ${hobbiesHtml ? `<div class="hobby-tag-list" style="margin-bottom:0.65rem;">${hobbiesHtml}</div>` : ""}
                <div class="meta-line">
                  <strong>${escapeHtml(s.event_title)}</strong>
                  <span aria-hidden="true">·</span>
                  <span class="tabular-num">${escapeHtml(formatDateTime(s.event_start_datetime))}</span>
                </div>
                <p>${escapeHtml(s.message)}</p>
                <p class="muted-small tabular-num">Expires ${escapeHtml(formatDateTime(s.expires_at))} · ${s.interest_count} interested</p>
                <div class="card-actions">
                  ${
                    isMine
                      ? `<button type="button" class="btn btn-text-danger" data-deactivate-solo="${escapeHtml(s.id)}">Deactivate</button>`
                      : `<button type="button" class="btn btn-coral btn-sm" data-solo-interest="${escapeHtml(s.id)}" ${s.has_expressed_interest ? "disabled" : ""}>${s.has_expressed_interest ? "Interest sent" : "Team up"}</button>
                         <button type="button" class="btn btn-secondary btn-sm" data-view-profile="${escapeHtml(s.user.id)}">Profile</button>
                         <button type="button" class="btn btn-secondary btn-sm" data-solo-safety="${escapeHtml(s.user.id)}">Safety</button>`
                  }
                </div>
              </div>
            </article>
          `;
        })
        .join("")}</div>`;

      qsa("[data-solo-interest]", container).forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!groupState.user) return requireAuthenticatedUser();
          try {
            const res = await API.expressSoloInterest(btn.dataset.soloInterest);
            window.location.href = `messages.html?conversation=${encodeURIComponent(res.conversation_id)}`;
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      });

      qsa("[data-deactivate-solo]", container).forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await API.deleteSolo(btn.dataset.deactivateSolo);
            loadGroupsTab();
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      });

      qsa("[data-solo-safety]", container).forEach((btn) => {
        btn.addEventListener("click", () => {
          const uid = btn.dataset.soloSafety;
          const item = solos.find((x) => x.user.id === uid);
          if (item) openSafetyModal(item.user, loadGroupsTab);
        });
      });

      qsa("[data-view-profile]", container).forEach((btn) => {
        btn.addEventListener("click", () => {
          const uid = btn.dataset.viewProfile;
          const item = solos.find((x) => x.user.id === uid);
          openPublicProfileModal(item ? item.user : uid);
        });
      });
    } else {
      const [comm, unis] = await Promise.all([
        API.getCommunity({
          university: groupState.filters.university,
          city: groupState.filters.city,
        }),
        API.listUniversities(),
      ]);

      const qLow = (groupState.filters.q || "").trim().toLowerCase();
      const rel = groupState.communityRelation;
      const filteredStudents = (comm.students || []).filter((stu) => {
        if (rel === "following" && !stu.is_following) return false;
        if (rel === "followers" && !stu.follows_me) return false;
        if (rel === "new" && (stu.is_following || stu.follows_me)) return false;
        if (qLow) {
          const interests = (stu.interests || []).map((i) => i.name).join(" ");
          const hobbies = (stu.hobbies || []).join(" ");
          const blob = `${stu.first_name} ${stu.last_name} ${stu.username} ${stu.bio || ""} ${interests} ${hobbies} ${stu.university || ""}`.toLowerCase();
          if (!blob.includes(qLow)) return false;
        }
        return true;
      });

      const uniSummaryHtml = unis
        .map(
          (u) => `
          <button type="button" class="choice-chip ${groupState.filters.university === u.university ? "is-selected" : ""}" data-pick-uni="${escapeHtml(u.university)}">
            ${escapeHtml(u.university)} (${u.student_count})
          </button>
        `
        )
        .join("");

      const relationChips = [
        { id: "all", label: `All students (${(comm.students || []).length})` },
        { id: "following", label: "Following" },
        { id: "followers", label: "Followers" },
        { id: "new", label: "Discover new" },
      ]
        .map(
          (r) => `
          <button type="button" class="choice-chip ${rel === r.id ? "is-selected" : ""}" data-pick-rel="${r.id}">
            ${escapeHtml(r.label)}
          </button>
        `
        )
        .join("");

      const studentsHtml = !groupState.user
        ? `
          <div class="empty-state">
            <h2>Sign in to view student profiles</h2>
            <p>Campus directory and compatibility scores are visible to signed-in students.</p>
            <a href="login.html" class="btn btn-primary">Sign in</a>
          </div>
        `
        : filteredStudents.length
        ? `<div class="cards-grid">${filteredStudents
            .map((stu) => {
              const name = `${stu.first_name} ${stu.last_name}`;
              const hobbiesHtml = renderHobbyTags(stu.hobbies || [], 3);
              return `
                <article class="card">
                  <div class="card-body">
                    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
                      ${renderAvatarHtml(stu)}
                      <div style="min-width:0;">
                        <h3 class="truncate" style="margin-bottom:0.1rem;">${escapeHtml(name)}</h3>
                        <div class="muted-small truncate">${escapeHtml(stu.university || stu.city || `@${stu.username}`)}</div>
                      </div>
                    </div>
                    ${hobbiesHtml ? `<div class="hobby-tag-list" style="margin-bottom:0.65rem;">${hobbiesHtml}</div>` : ""}
                    <div class="meta-line tabular-num">
                      ${stu.compatibility ? `<strong>${stu.compatibility.compatibility}% compatibility</strong>` : ""}
                      ${stu.follows_me ? `<span class="badge-inline">Follows you</span>` : ""}
                    </div>
                    <p>${escapeHtml(stu.bio || "Student on UniMeet.")}</p>
                    <p class="muted-small">${escapeHtml((stu.interests || []).map((i) => i.name).join(", ") || "No interests listed")}</p>
                    <div class="card-actions">
                      <button type="button" class="btn ${stu.is_following ? "btn-secondary" : "btn-primary"} btn-sm" data-follow-uid="${escapeHtml(stu.id)}">
                        ${stu.is_following ? "Following" : "Follow"}
                      </button>
                      <button type="button" class="btn btn-coral btn-sm" data-msg-uid="${escapeHtml(stu.id)}">Message</button>
                      <button type="button" class="btn btn-secondary btn-sm" data-community-profile="${escapeHtml(stu.id)}">Profile</button>
                    </div>
                  </div>
                </article>
              `;
            })
            .join("")}</div>`
        : `<p class="muted-small">No students match this filter.</p>`;

      container.innerHTML = `
        <div class="card" style="margin-bottom:1.25rem;">
          <div class="card-body">
            <h3>Universities &amp; People Filters</h3>
            <div class="chip-grid" style="margin-top:0.75rem;">
              <button type="button" class="choice-chip ${!groupState.filters.university ? "is-selected" : ""}" data-pick-uni="">All universities</button>
              ${uniSummaryHtml}
            </div>
            <div class="chip-grid" style="margin-top:0.75rem;">
              ${relationChips}
            </div>
          </div>
        </div>
        <h2>Students${comm.university ? ` at ${escapeHtml(comm.university)}` : ""}</h2>
        ${studentsHtml}
      `;

      qsa("[data-pick-uni]", container).forEach((btn) => {
        btn.addEventListener("click", () => {
          groupState.filters.university = btn.dataset.pickUni;
          qs("#grp-uni").value = btn.dataset.pickUni;
          loadGroupsTab();
        });
      });

      qsa("[data-pick-rel]", container).forEach((btn) => {
        btn.addEventListener("click", () => {
          groupState.communityRelation = btn.dataset.pickRel;
          loadGroupsTab();
        });
      });

      qsa("[data-follow-uid]", container).forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            const res = await API.toggleFollowUser(btn.dataset.followUid);
            btn.textContent = res.is_following ? "Following" : "Follow";
            btn.className = `btn ${res.is_following ? "btn-secondary" : "btn-primary"} btn-sm`;
            showToast(res.is_following ? "Followed student" : "Unfollowed student", "info");
          } catch (err) {
            showToast(err.message || "Could not update follow status.", "error");
          } finally {
            btn.disabled = false;
          }
        });
      });

      qsa("[data-msg-uid]", container).forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            const res = await API.startDirectChatWithUser(btn.dataset.msgUid);
            window.location.href = `messages.html?conversation=${encodeURIComponent(res.conversation_id)}`;
          } catch (err) {
            showToast(err.message || "Could not open chat.", "error");
            btn.disabled = false;
          }
        });
      });

      qsa("[data-community-profile]", container).forEach((btn) => {
        btn.addEventListener("click", () => {
          const uid = btn.dataset.communityProfile;
          const stu = comm.students.find((x) => x.id === uid);
          openPublicProfileModal(stu || uid, loadGroupsTab);
        });
      });
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.body?.dataset?.page !== "groups") return;
  groupState.user = await getCurrentUser();
  populateGroupCategories(qs("#grp-category"), true);

  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get("tab");
  const requestedGroupId = params.get("group");
  const validGroupTabs = new Set(["groups", "solo", "community"]);
  if (requestedTab && validGroupTabs.has(requestedTab)) {
    groupState.activeTab = requestedTab;
    qsa("[data-group-tab]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.groupTab === requestedTab);
    });
  }

  qsa("[data-group-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa("[data-group-tab]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      groupState.activeTab = btn.dataset.groupTab;
      loadGroupsTab();
    });
  });

  qs("#open-create-group-btn").addEventListener("click", openCreateGroupModal);
  qs("#groups-filter-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    groupState.filters = {
      q: qs("#grp-q").value.trim(),
      category: qs("#grp-category")?.value || "",
      university: qs("#grp-uni").value.trim(),
      city: qs("#grp-city").value.trim(),
    };
    loadGroupsTab();
  });

  await loadGroupsTab();

  if (requestedGroupId) {
    const groups = await API.listGroups().catch(() => []);
    const target = groups.find((g) => g.id === requestedGroupId);
    if (target) {
      await openGroupDetailsModal(target);
    }
  }
});
