/**
 * Student Groups, Going Solo Feed, and University Community Hub (groups.html).
 */
import { API } from "./api.js";
import { getCurrentUser, openSafetyModal, requireAuthenticatedUser } from "./navigation.js";
import { escapeHtml, formatDateTime, getInitials, openModal, qs, qsa, showToast } from "./utils.js";

const groupState = {
  user: null,
  activeTab: "groups",
  filters: { q: "", university: "", city: "" },
};

async function openGroupDetailsModal(group) {
  try {
    const members = await API.getGroupMembers(group.id);
    const isAdmin = groupState.user && group.creator_id === groupState.user.id;

    const membersHtml = members
      .map((m) => {
        const name = `${m.user.first_name} ${m.user.last_name}`;
        const pendingBadge =
          m.status === "pending"
            ? ` · <span class="status-text-warn">Pending</span>`
            : ` · <span>${escapeHtml(m.role)}</span>`;
        const approveBtn =
          isAdmin && m.status === "pending"
            ? `<button type="button" class="btn btn-primary btn-sm" data-approve-uid="${m.user_id}">Approve</button>`
            : "";
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--color-border);">
            <div style="display:flex;align-items:center;gap:0.75rem;">
              <div class="avatar-circle">${escapeHtml(getInitials(m.user.first_name, m.user.last_name))}</div>
              <div>
                <strong>${escapeHtml(name)}</strong>
                <div class="muted-small">${escapeHtml(m.user.university || m.user.city || `@${m.user.username}`)}${pendingBadge}</div>
              </div>
            </div>
            ${approveBtn}
          </div>
        `;
      })
      .join("");

    openModal({
      title: group.name,
      bodyHtml: `
        <div>
          <div class="meta-line">
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
                ? `<a href="messages.html?conversation=${group.conversation_id}" class="btn btn-primary btn-sm">Open group chat</a>`
                : ""
            }
            ${
              group.is_member
                ? `<button type="button" class="btn btn-secondary btn-sm" id="modal-leave-grp">Leave group</button>`
                : group.membership_status === "pending"
                ? `<button type="button" class="btn btn-secondary btn-sm" disabled>Request pending</button>`
                : `<button type="button" class="btn btn-primary btn-sm" id="modal-join-grp">${group.is_public ? "Join group" : "Request to join"}</button>`
            }
            ${
              isAdmin
                ? `<button type="button" class="btn btn-danger btn-sm" id="modal-delete-grp">Delete group</button>`
                : ""
            }
          </div>

          <div class="divider-line"></div>
          <h3>Members (${members.length})</h3>
          <div>${membersHtml || '<p class="muted-small">No visible members.</p>'}</div>
        </div>
      `,
      onMount: (root, close) => {
        qs("#modal-join-grp", root)?.addEventListener("click", async () => {
          if (!groupState.user) return requireAuthenticatedUser();
          try {
            const updated = await API.joinGroup(group.id);
            showToast(
              updated.membership_status === "pending" ? "Join request sent!" : "Joined group!",
              "success"
            );
            close();
            loadGroupsTab();
          } catch (err) {
            showToast(err.message, "error");
          }
        });

        qs("#modal-leave-grp", root)?.addEventListener("click", async () => {
          try {
            await API.leaveGroup(group.id);
            showToast("Left group.", "info");
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
            showToast("Group deleted.", "success");
            close();
            loadGroupsTab();
          } catch (err) {
            showToast(err.message, "error");
          }
        });

        qsa("[data-approve-uid]", root).forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await API.approveGroupMember(group.id, Number(btn.dataset.approveUid));
              showToast("Member approved!", "success");
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
      .map((e) => `<option value="${e.id}">${escapeHtml(e.title)} (${escapeHtml(e.city)})</option>`)
      .join("");
  } catch {
    // Ignore
  }

  openModal({
    title: "Create a Student Group",
    bodyHtml: `
      <form id="create-group-form" class="stack-form">
        <div class="field">
          <label for="cg-name">Group name</label>
          <input id="cg-name" type="text" required minlength="3" maxlength="120" placeholder="e.g. UPT Festival Crew">
        </div>
        <div class="field">
          <label for="cg-event">Linked event (optional)</label>
          <select id="cg-event">${eventOptions}</select>
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
            description: qs("#cg-desc", root).value.trim(),
            event_id: eventVal ? Number(eventVal) : null,
            max_members: Number(qs("#cg-max", root).value),
            is_public: qs("#cg-public", root).value === "true",
            university: qs("#cg-uni", root).value.trim() || null,
            location: qs("#cg-city", root).value.trim() || null,
            interests_summary: qs("#cg-interests", root).value.trim() || null,
          });
          showToast("Group created!", "success");
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
            <p>Start the first group for your university or favorite upcoming event.</p>
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
            <div class="card-body">
              <div class="meta-line">
                <span>${g.is_public ? "Public" : "Private"}</span>
                <span aria-hidden="true">·</span>
                <span class="tabular-num">${g.member_count}/${g.max_members} members</span>
                ${g.location ? `<span aria-hidden="true">·</span><span>${escapeHtml(g.location)}</span>` : ""}
              </div>
              <h3>${escapeHtml(g.name)}</h3>
              ${g.event_title ? `<p class="muted-small" style="margin-bottom:0.4rem;">Event: <strong>${escapeHtml(g.event_title)}</strong></p>` : ""}
              <p>${escapeHtml(g.description)}</p>
              ${g.university ? `<p class="muted-small">${escapeHtml(g.university)}</p>` : ""}
              <div class="card-actions">
                <button type="button" class="btn btn-primary btn-sm" data-open-group="${g.id}">View &amp; Members</button>
                ${
                  g.is_member && g.conversation_id
                    ? `<a href="messages.html?conversation=${g.conversation_id}" class="btn btn-secondary btn-sm">Chat</a>`
                    : !g.is_member && g.membership_status !== "pending"
                    ? `<button type="button" class="btn btn-secondary btn-sm" data-quick-join="${g.id}">${g.is_public ? "Join" : "Request"}</button>`
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
          const grp = groups.find((x) => x.id === Number(btn.dataset.openGroup));
          if (grp) openGroupDetailsModal(grp);
        });
      });

      qsa("[data-quick-join]", container).forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!groupState.user) return requireAuthenticatedUser();
          try {
            const res = await API.joinGroup(Number(btn.dataset.quickJoin));
            showToast(res.membership_status === "pending" ? "Request sent!" : "Joined group!", "success");
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
          return `
            <article class="card">
              <div class="card-body">
                <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
                  <div class="avatar-circle">${escapeHtml(getInitials(s.user.first_name, s.user.last_name))}</div>
                  <div>
                    <h3 style="margin-bottom:0.1rem;">${escapeHtml(name)}</h3>
                    <div class="muted-small">${escapeHtml(s.user.university || s.event_city)}</div>
                  </div>
                </div>
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
                      ? `<button type="button" class="btn btn-text-danger" data-deactivate-solo="${s.id}">Deactivate</button>`
                      : `<button type="button" class="btn btn-coral btn-sm" data-solo-interest="${s.id}" ${s.has_expressed_interest ? "disabled" : ""}>${s.has_expressed_interest ? "Interest sent" : "Team up"}</button>
                         <button type="button" class="btn btn-secondary btn-sm" data-solo-safety="${s.user.id}">Safety</button>`
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
            const res = await API.expressSoloInterest(Number(btn.dataset.soloInterest));
            showToast("Connected! Opening chat...", "success");
            window.setTimeout(() => {
              window.location.href = `messages.html?conversation=${res.conversation_id}`;
            }, 450);
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      });

      qsa("[data-deactivate-solo]", container).forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await API.deleteSolo(Number(btn.dataset.deactivateSolo));
            showToast("Going Solo post deactivated.", "info");
            loadGroupsTab();
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      });

      qsa("[data-solo-safety]", container).forEach((btn) => {
        btn.addEventListener("click", () => {
          const uid = Number(btn.dataset.soloSafety);
          const item = solos.find((x) => x.user.id === uid);
          if (item) openSafetyModal(item.user, loadGroupsTab);
        });
      });
    } else {
      // University Community Hub
      const [comm, unis] = await Promise.all([
        API.getCommunity({
          university: groupState.filters.university,
          city: groupState.filters.city,
        }),
        API.listUniversities(),
      ]);

      const uniSummaryHtml = unis
        .map(
          (u) => `
          <button type="button" class="choice-chip ${groupState.filters.university === u.university ? "is-selected" : ""}" data-pick-uni="${escapeHtml(u.university)}">
            ${escapeHtml(u.university)} (${u.student_count})
          </button>
        `
        )
        .join("");

      const studentsHtml = comm.students.length
        ? comm.students
            .map((stu) => {
              const name = `${stu.first_name} ${stu.last_name}`;
              return `
                <article class="card">
                  <div class="card-body">
                    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.6rem;">
                      <div class="avatar-circle">${escapeHtml(getInitials(stu.first_name, stu.last_name))}</div>
                      <div>
                        <h3 style="margin-bottom:0.1rem;">${escapeHtml(name)}</h3>
                        <div class="muted-small">${escapeHtml(stu.university || stu.city || `@${stu.username}`)}</div>
                      </div>
                    </div>
                    ${
                      stu.compatibility
                        ? `<div class="meta-line tabular-num"><strong>${stu.compatibility.compatibility}% compatibility</strong></div>`
                        : ""
                    }
                    <p>${escapeHtml(stu.bio || "Student on UniMeet.")}</p>
                    <p class="muted-small">${escapeHtml((stu.interests || []).map((i) => i.name).join(", ") || "No interests listed")}</p>
                  </div>
                </article>
              `;
            })
            .join("")
        : `<p class="muted-small">No students found for this university filter.</p>`;

      container.innerHTML = `
        <div class="card" style="margin-bottom:1.25rem;">
          <div class="card-body">
            <h3>Universities on UniMeet (optional affiliation)</h3>
            <div class="chip-grid" style="margin-top:0.75rem;">
              <button type="button" class="choice-chip ${!groupState.filters.university ? "is-selected" : ""}" data-pick-uni="">All universities</button>
              ${uniSummaryHtml}
            </div>
          </div>
        </div>
        <h2>Students${comm.university ? ` at ${escapeHtml(comm.university)}` : ""}</h2>
        <div class="cards-grid">${studentsHtml}</div>
      `;

      qsa("[data-pick-uni]", container).forEach((btn) => {
        btn.addEventListener("click", () => {
          groupState.filters.university = btn.dataset.pickUni;
          qs("#grp-uni").value = btn.dataset.pickUni;
          loadGroupsTab();
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
      university: qs("#grp-uni").value.trim(),
      city: qs("#grp-city").value.trim(),
    };
    loadGroupsTab();
  });

  await loadGroupsTab();
});
