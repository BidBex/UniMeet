/**
 * Student Social Feed (feed.html): text & photo posts, topic tags, likes, comments,
 * composer with group/event linking, author profile modal, and side rail summary.
 */
import { API } from "./api.js";
import { CONFIG } from "./config.js";
import {
  getCurrentUser,
  openNotificationsModal,
  openPublicProfileModal,
  renderAvatarHtml,
  requireAuthenticatedUser,
} from "./navigation.js";
import {
  escapeHtml,
  formatDateTime,
  formatRelativeTime,
  qs,
  qsa,
  renderMediaWithFallback,
  showToast,
} from "./utils.js";

const feedState = {
  user: null,
  activeTab: "all",
  q: "",
  highlightedPostId: "",
  expandedComments: new Set(),
};

function heartSvg(filled) {
  return filled
    ? `<svg class="heart-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
    : `<svg class="heart-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
}

function commentSvg() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
}

function shareSvg() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
}

function renderCommentsHtml(post) {
  const comments = post.comments || [];
  const listHtml = comments.length
    ? comments
        .map((c) => {
          const authorName = c.author
            ? `${c.author.first_name} ${c.author.last_name}`.trim()
            : "Student";
          return `
            <div class="feed-comment-item">
              ${renderAvatarHtml(c.author || { first_name: "U", last_name: "S" })}
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:baseline;justify-content:space-between;gap:0.5rem;">
                  <button type="button" class="feed-author-btn" data-open-author="${escapeHtml(c.author_id)}">
                    <strong style="font-size:0.86rem;">${escapeHtml(authorName)}</strong>
                  </button>
                  <div style="display:flex;align-items:center;gap:0.45rem;">
                    <span class="muted-small tabular-num" style="font-size:0.75rem;">${escapeHtml(formatRelativeTime(c.created_at))}</span>
                    ${
                      c.is_mine
                        ? `<button type="button" class="btn-text-danger" style="min-height:24px;padding:0 0.3rem;font-size:0.75rem;" data-del-comment="${escapeHtml(c.id)}" data-post-id="${escapeHtml(post.id)}">Delete</button>`
                        : ""
                    }
                  </div>
                </div>
                <p style="margin:0.15rem 0 0;font-size:0.9rem;">${escapeHtml(c.content)}</p>
              </div>
            </div>
          `;
        })
        .join("")
    : `<p class="muted-small" style="margin:0;">No comments yet — start the conversation below.</p>`;

  const formHtml = feedState.user
    ? `
      <form class="feed-comment-form" data-comment-form="${escapeHtml(post.id)}">
        <input type="text" required maxlength="400" placeholder="Write a comment..." aria-label="Write a comment">
        <button type="submit" class="btn btn-primary btn-sm">Reply</button>
      </form>
    `
    : "";

  return `
    <div class="feed-comments-box" data-comments-wrap="${escapeHtml(post.id)}">
      ${listHtml}
      ${formHtml}
    </div>
  `;
}

function renderPostCard(post) {
  const author = post.author || { first_name: "UniMeet", last_name: "Student", username: "student" };
  const fullName = `${author.first_name || ""} ${author.last_name || ""}`.trim() || author.username;
  const isHighlighted = feedState.highlightedPostId && feedState.highlightedPostId === post.id;
  const showComments = feedState.expandedComments.has(post.id) || post.comments.length > 0;

  const contextHtml =
    post.group_id || post.event_id
      ? `
      <div class="feed-context-links">
        ${
          post.group_id && post.group_name
            ? `<a href="groups.html?group=${encodeURIComponent(post.group_id)}" class="feed-context-link">Group: ${escapeHtml(post.group_name)}</a>`
            : ""
        }
        ${
          post.event_id && post.event_title
            ? `<a href="events.html?event=${encodeURIComponent(post.event_id)}" class="feed-context-link">Event: ${escapeHtml(post.event_title)}</a>`
            : ""
        }
      </div>
    `
      : "";

  return `
    <article class="feed-post-card ${isHighlighted ? "is-highlighted" : ""}" id="post-card-${escapeHtml(post.id)}" data-post-card="${escapeHtml(post.id)}">
      <div class="card-body">
        <div class="feed-post-header">
          <button type="button" class="feed-author-btn" data-open-author="${escapeHtml(post.author_id)}">
            ${renderAvatarHtml(author)}
            <div style="min-width:0;">
              <strong class="truncate" style="display:block;">${escapeHtml(fullName)}</strong>
              <span class="muted-small tabular-num" style="display:block;">@${escapeHtml(author.username)} · ${escapeHtml(formatRelativeTime(post.created_at))}</span>
            </div>
          </button>
          <div style="display:flex;align-items:center;gap:0.45rem;flex-shrink:0;">
            ${post.tag ? `<span class="badge-inline">${escapeHtml(post.tag)}</span>` : ""}
            ${
              post.is_mine
                ? `<button type="button" class="btn-text-danger" data-delete-post="${escapeHtml(post.id)}">Delete</button>`
                : ""
            }
          </div>
        </div>

        <p style="margin-bottom:0;white-space:pre-line;">${escapeHtml(post.content)}</p>

        ${
          post.image_url
            ? `<div class="feed-post-media">${renderMediaWithFallback(post.image_url, post.tag || "Campus moment", fullName)}</div>`
            : ""
        }

        ${contextHtml}

        <div class="feed-post-footer">
          <button
            type="button"
            class="btn btn-sm like-toggle-btn ${post.is_liked ? "is-liked" : ""}"
            data-like-post="${escapeHtml(post.id)}"
            aria-pressed="${post.is_liked ? "true" : "false"}"
          >
            ${heartSvg(post.is_liked)}<span class="tabular-num">${post.like_count}</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" data-toggle-comments="${escapeHtml(post.id)}">
            ${commentSvg()}<span class="tabular-num">${post.comment_count}</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" data-share-post="${escapeHtml(post.id)}" style="margin-left:auto;">
            ${shareSvg()}<span>Share</span>
          </button>
        </div>

        ${showComments ? renderCommentsHtml(post) : ""}
      </div>
    </article>
  `;
}

async function renderSideRail() {
  const summaryCard = qs("#feed-summary-card");
  const upcomingCard = qs("#feed-upcoming-card");

  if (summaryCard) {
    if (feedState.user) {
      const freshMe = await API.me({ skipAuthRedirect: true }).catch(() => feedState.user);
      feedState.user = freshMe || feedState.user;
      summaryCard.innerHTML = `
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.85rem;">
            ${renderAvatarHtml(feedState.user)}
            <div style="min-width:0;">
              <strong class="truncate" style="display:block;">${escapeHtml(feedState.user.first_name)} ${escapeHtml(feedState.user.last_name)}</strong>
              <span class="muted-small truncate" style="display:block;">${escapeHtml(feedState.user.university || feedState.user.city || "")}</span>
            </div>
          </div>
          <div class="profile-stats-row" style="margin-bottom:0.85rem;">
            <div class="profile-stat-item">
              <strong class="tabular-num">${feedState.user.followers_count ?? 0}</strong>
              <span>Followers</span>
            </div>
            <div class="profile-stat-item">
              <strong class="tabular-num">${feedState.user.following_count ?? 0}</strong>
              <span>Following</span>
            </div>
            <div class="profile-stat-item">
              <strong class="tabular-num">${feedState.user.groups_count ?? 0}</strong>
              <span>Groups</span>
            </div>
          </div>
          <div class="card-actions" style="margin-top:0;">
            <a href="groups.html?tab=community" class="btn btn-secondary btn-sm">Find students</a>
            <a href="profile.html" class="btn btn-secondary btn-sm">My profile</a>
          </div>
        </div>
      `;
    } else {
      summaryCard.innerHTML = `
        <div class="card-body">
          <h3>Join the campus feed</h3>
          <p class="muted-small">Sign in to publish updates, comment on plans, and follow fellow students.</p>
          <a href="login.html" class="btn btn-primary btn-sm">Sign in</a>
        </div>
      `;
    }
  }

  if (upcomingCard) {
    try {
      const res = await API.listEvents({ timeframe: "upcoming", limit: 3 });
      const items = res.items || [];
      upcomingCard.innerHTML = `
        <div class="card-body">
          <h3>Happening Soon</h3>
          ${
            items.length
              ? items
                  .map(
                    (ev) => `
                  <div style="padding:0.55rem 0;border-bottom:1px solid var(--color-border);">
                    <a href="events.html?event=${encodeURIComponent(ev.id)}" style="font-weight:600;display:block;">${escapeHtml(ev.title)}</a>
                    <span class="muted-small tabular-num">${escapeHtml(formatDateTime(ev.start_datetime))} · ${escapeHtml(ev.city)}</span>
                  </div>
                `
                  )
                  .join("")
              : `<p class="muted-small">No upcoming events right now.</p>`
          }
          <div class="card-actions">
            <a href="events.html" class="btn btn-secondary btn-sm">All events</a>
          </div>
        </div>
      `;
    } catch {
      upcomingCard.innerHTML = "";
    }
  }
}

async function populateComposerOptions() {
  const section = qs("#feed-composer-section");
  if (!section || !feedState.user) return;
  section.hidden = false;

  const imgSelect = qs("#post-image");
  if (imgSelect) {
    imgSelect.innerHTML =
      `<option value="">No photo (text post)</option>` +
      CONFIG.EVENT_IMAGE_PRESETS.map(
        (p) => `<option value="${escapeHtml(p.url)}">${escapeHtml(p.label)}</option>`
      ).join("");
  }

  try {
    const [groups, eventsRes] = await Promise.all([
      API.listGroups(),
      API.listEvents({ limit: 30 }),
    ]);
    const grpSelect = qs("#post-group");
    if (grpSelect) {
      grpSelect.innerHTML =
        `<option value="">None</option>` +
        groups
          .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`)
          .join("");
    }
    const evSelect = qs("#post-event");
    if (evSelect) {
      evSelect.innerHTML =
        `<option value="">None</option>` +
        (eventsRes.items || [])
          .map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.title)}</option>`)
          .join("");
    }
  } catch {
    // Optional metadata selectors
  }
}

async function loadFeedPosts() {
  const container = qs("#feed-posts-container");
  if (!container) return;

  if (!feedState.user) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Sign in to view the student feed</h2>
        <p>Follow classmates, read group updates, and share campus outings.</p>
        <a href="login.html" class="btn btn-primary">Sign in</a>
      </div>
    `;
    return;
  }

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading feed...</p></div>`;

  try {
    const posts = await API.listPosts({
      filter: feedState.activeTab,
      q: feedState.q,
    });

    if (!posts.length) {
      container.innerHTML = `
        <div class="empty-state">
          <h2>No posts match this view</h2>
          <p>Try another tab or publish the first update above.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = posts.map(renderPostCard).join("");

    qsa("[data-open-author]", container).forEach((btn) => {
      btn.addEventListener("click", () => {
        openPublicProfileModal(btn.dataset.openAuthor, () => {
          renderSideRail();
          loadFeedPosts();
        });
      });
    });

    qsa("[data-like-post]", container).forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const res = await API.toggleLikePost(btn.dataset.likePost);
          btn.classList.toggle("is-liked", res.is_liked);
          btn.setAttribute("aria-pressed", res.is_liked ? "true" : "false");
          btn.innerHTML = `${heartSvg(res.is_liked)}<span class="tabular-num">${res.like_count}</span>`;
        } catch (err) {
          showToast(err.message || "Could not update reaction.", "error");
        } finally {
          btn.disabled = false;
        }
      });
    });

    qsa("[data-toggle-comments]", container).forEach((btn) => {
      btn.addEventListener("click", () => {
        const pid = btn.dataset.toggleComments;
        if (feedState.expandedComments.has(pid)) {
          feedState.expandedComments.delete(pid);
        } else {
          feedState.expandedComments.add(pid);
        }
        const card = qs(`[data-post-card="${CSS.escape(pid)}"]`, container);
        const input = card ? qs(".feed-comment-form input", card) : null;
        if (input) input.focus();
      });
    });

    qsa("[data-comment-form]", container).forEach((form) => {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const pid = form.dataset.commentForm;
        const input = qs("input", form);
        const content = input.value.trim();
        if (!content) return;
        const btn = qs("button[type='submit']", form);
        btn.disabled = true;
        try {
          feedState.expandedComments.add(pid);
          await API.addComment(pid, content);
          await loadFeedPosts();
        } catch (err) {
          showToast(err.message || "Could not add comment.", "error");
          btn.disabled = false;
        }
      });
    });

    qsa("[data-del-comment]", container).forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await API.deleteComment(btn.dataset.postId, btn.dataset.delComment);
          await loadFeedPosts();
        } catch (err) {
          showToast(err.message || "Could not delete comment.", "error");
        }
      });
    });

    qsa("[data-delete-post]", container).forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await API.deletePost(btn.dataset.deletePost);
          showToast("Post deleted.", "info");
          await loadFeedPosts();
          renderSideRail();
        } catch (err) {
          showToast(err.message || "Could not delete post.", "error");
        }
      });
    });

    qsa("[data-share-post]", container).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const url = `${window.location.origin}${window.location.pathname}?post=${encodeURIComponent(btn.dataset.sharePost)}`;
        try {
          await navigator.clipboard.writeText(url);
          showToast("Post link copied to clipboard.", "success");
        } catch {
          showToast("Ready to share!", "info");
        }
      });
    });

    if (feedState.highlightedPostId) {
      const targetEl = qs(`#post-card-${CSS.escape(feedState.highlightedPostId)}`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message || "Unable to load feed.")}</p></div>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.body?.dataset?.page !== "feed") return;

  feedState.user = await getCurrentUser();
  const params = new URLSearchParams(window.location.search);
  feedState.highlightedPostId = params.get("post") || "";

  qs("#feed-notifications-btn")?.addEventListener("click", openNotificationsModal);

  qsa("[data-feed-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa("[data-feed-tab]").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      feedState.activeTab = btn.dataset.feedTab;
      feedState.highlightedPostId = "";
      loadFeedPosts();
    });
  });

  qs("#feed-search-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    feedState.q = qs("#feed-q").value.trim();
    feedState.highlightedPostId = "";
    loadFeedPosts();
  });

  qs("#feed-clear-btn")?.addEventListener("click", () => {
    qs("#feed-q").value = "";
    feedState.q = "";
    feedState.highlightedPostId = "";
    loadFeedPosts();
  });

  qs("#feed-composer-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!feedState.user) return requireAuthenticatedUser();
    const content = qs("#post-content").value.trim();
    if (!content) return;
    const submitBtn = qs("#post-submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Publishing...";
    try {
      await API.createPost({
        content,
        tag: qs("#post-tag").value,
        image_url: qs("#post-image").value || null,
        group_id: qs("#post-group").value || null,
        event_id: qs("#post-event").value || null,
      });
      qs("#post-content").value = "";
      qs("#post-image").value = "";
      qs("#post-group").value = "";
      qs("#post-event").value = "";
      showToast("Post published!", "success");
      await loadFeedPosts();
      renderSideRail();
    } catch (err) {
      showToast(err.message || "Could not publish post.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Publish post";
    }
  });

  await Promise.all([populateComposerOptions(), renderSideRail(), loadFeedPosts()]);
});
