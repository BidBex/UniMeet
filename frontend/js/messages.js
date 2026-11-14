/**
 * Real-time Cloud Firestore messaging interface (messages.html).
 * Uses Firestore onSnapshot listeners for live conversations & messages,
 * per-message three-dot menu (Unsend / Delete for me) with two-step
 * confirmation modals, group three-dot options menu (Leave / Block / Report),
 * and string document IDs.
 */
import { API } from "./api.js";
import {
  buildGroupMenuHtml,
  openSafetyModal,
  renderAvatarHtml,
  requireAuthenticatedUser,
  updateNavUnreadBadges,
  wireGroupMenuActions,
} from "./navigation.js";
import {
  escapeHtml,
  formatSmartDateTime,
  openConfirmDialog,
  qs,
  qsa,
  showToast,
} from "./utils.js";

const chatState = {
  user: null,
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  activeMessages: [],
  renderedIds: new Set(),
  unsubConvs: null,
  unsubMessages: null,
  loadSeq: 0,
};

const DOTS_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';

function setSyncStatus(label, cssClass = "") {
  const el = qs("#ws-status-label");
  if (!el) return;
  el.textContent = label;
  el.className = `muted-small ${cssClass}`;
}

function cleanupMessageListener() {
  if (chatState.unsubMessages) {
    chatState.unsubMessages();
    chatState.unsubMessages = null;
  }
}

function cleanupAllListeners() {
  cleanupMessageListener();
  if (chatState.unsubConvs) {
    chatState.unsubConvs();
    chatState.unsubConvs = null;
  }
}

function closeAllMessageMenus(exceptWrap = null) {
  qsa(".options-menu-wrap[data-msg-menu]", qs("#chat-history")).forEach((wrap) => {
    if (exceptWrap && wrap === exceptWrap) return;
    const dd = qs(".options-dropdown", wrap);
    const btn = qs(".options-dots-btn", wrap);
    if (dd) dd.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}

function renderConversationsList() {
  const listEl = qs("#conversation-list");
  if (!listEl) return;

  if (!chatState.conversations.length) {
    listEl.innerHTML = `
      <div style="padding:1.5rem;text-align:center;">
        <p class="muted-small">No conversations yet. Match with someone or join a group to start chatting!</p>
        <a href="discover.html" class="btn btn-primary btn-sm">Go to Discover</a>
      </div>
    `;
    return;
  }

  listEl.innerHTML = chatState.conversations
    .map((conv) => {
      const active = conv.id === chatState.activeConversationId ? "is-active" : "";
      const avatarHtml = conv.other_user
        ? renderAvatarHtml(conv.other_user)
        : `<div class="avatar-circle">${escapeHtml((conv.title || "CH").slice(0, 2).toUpperCase())}</div>`;
      const timeText = conv.last_message_at ? formatSmartDateTime(conv.last_message_at) : "";
      const unreadPill =
        conv.unread_count > 0
          ? `<span class="chat-unread-pill tabular-num">${conv.unread_count}</span>`
          : "";

      return `
        <button type="button" class="chat-thread-item ${active}" data-conv-id="${escapeHtml(conv.id)}">
          ${avatarHtml}
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
              <strong class="truncate">${escapeHtml(conv.title)}</strong>
              <span class="muted-small tabular-num" style="flex-shrink:0;">${escapeHtml(timeText)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-top:0.15rem;">
              <span class="muted-small truncate" style="${conv.unread_count > 0 ? "color:var(--color-text);font-weight:600;" : ""}">
                ${escapeHtml(conv.last_message || "No messages yet")}
              </span>
              ${unreadPill}
            </div>
          </div>
        </button>
      `;
    })
    .join("");

  qsa("[data-conv-id]", listEl).forEach((btn) => {
    btn.addEventListener("click", () => selectConversation(btn.dataset.convId));
  });
}

function syncConversationPreview(conversationId) {
  const conv = chatState.conversations.find((c) => c.id === conversationId);
  if (!conv) return;
  if (chatState.activeConversationId === conversationId) {
    const latest = chatState.activeMessages[chatState.activeMessages.length - 1];
    conv.last_message = latest ? latest.content : null;
    conv.last_message_at = latest ? latest.created_at : null;
    renderConversationsList();
  }
}

function removeMessageBubble(messageId) {
  chatState.renderedIds.delete(messageId);
  chatState.activeMessages = chatState.activeMessages.filter((m) => m.id !== messageId);

  const historyEl = qs("#chat-history");
  if (!historyEl) return;
  const bubble = qs(`[data-message-id="${CSS.escape(messageId)}"]`, historyEl);
  if (bubble) bubble.remove();

  if (!chatState.activeMessages.length) {
    historyEl.innerHTML = `<div class="empty-state"><p>No messages yet. Say hello and propose a public meetup spot!</p></div>`;
  }
  syncConversationPreview(chatState.activeConversationId);
}

function renderBubbleInner(msg, isMine) {
  const canUnsend = isMine && !msg.is_unsent;
  const isGroup = chatState.activeConversation?.type === "group";
  const senderHeader =
    isGroup && !isMine && !msg.is_unsent && msg.sender_name
      ? `<div class="chat-sender-name">${escapeHtml(msg.sender_name)}</div>`
      : "";
  const contentHtml = msg.is_unsent
    ? `<div class="chat-unsent-text">This message was unsent</div>`
    : `<div>${escapeHtml(msg.content)}</div>`;

  const menuHtml = `
    <div class="options-menu-wrap" data-msg-menu="${escapeHtml(msg.id)}">
      <button
        type="button"
        class="options-dots-btn"
        data-msg-menu-trigger="${escapeHtml(msg.id)}"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-label="Message options"
        title="Message options"
      >${DOTS_ICON}</button>
      <div class="options-dropdown" role="menu" hidden>
        ${
          canUnsend
            ? `<button type="button" class="options-dropdown-item" role="menuitem" data-msg-action="unsend">Unsend</button>`
            : ""
        }
        <button type="button" class="options-dropdown-item is-danger" role="menuitem" data-msg-action="delete-for-me">Delete for me</button>
      </div>
    </div>
  `;

  return `
    ${senderHeader}
    ${contentHtml}
    <div class="chat-meta tabular-num">
      <span>${escapeHtml(formatSmartDateTime(msg.created_at))}${isMine ? (msg.is_read ? " · Read" : " · Sent") : ""}</span>
      ${menuHtml}
    </div>
  `;
}

function wireBubbleMenu(bubble, msg) {
  const wrap = qs(`[data-msg-menu="${CSS.escape(msg.id)}"]`, bubble);
  if (!wrap) return;
  const trigger = qs(`[data-msg-menu-trigger="${CSS.escape(msg.id)}"]`, wrap);
  const dropdown = qs(".options-dropdown", wrap);

  trigger?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const shouldOpen = dropdown.hidden;
    closeAllMessageMenus(wrap);
    dropdown.hidden = !shouldOpen;
    trigger.setAttribute("aria-expanded", String(shouldOpen));
  });

  qs('[data-msg-action="unsend"]', dropdown)?.addEventListener("click", () => {
    closeAllMessageMenus();
    openConfirmDialog({
      title: "Unsend message?",
      message: "This will remove the message for everyone in this conversation and replace it with an unsent notice.",
      confirmLabel: "Unsend",
      destructive: true,
      onConfirm: async (close) => {
        const updated = await API.unsendMessage(chatState.activeConversationId, msg.id);
        markBubbleUnsent(updated);
        close();
      },
    });
  });

  qs('[data-msg-action="delete-for-me"]', dropdown)?.addEventListener("click", () => {
    closeAllMessageMenus();
    openConfirmDialog({
      title: "Delete message for you?",
      message: "This message will be removed only from your chat view. Other participants will still see it.",
      confirmLabel: "Delete for me",
      destructive: true,
      onConfirm: async (close) => {
        await API.deleteMessageForMe(chatState.activeConversationId, msg.id);
        removeMessageBubble(msg.id);
        close();
      },
    });
  });
}

function markBubbleUnsent(updatedMsg) {
  const idx = chatState.activeMessages.findIndex((m) => m.id === updatedMsg.id);
  if (idx !== -1) {
    chatState.activeMessages[idx] = { ...chatState.activeMessages[idx], ...updatedMsg };
  }
  const historyEl = qs("#chat-history");
  if (!historyEl) return;
  const bubble = qs(`[data-message-id="${CSS.escape(updatedMsg.id)}"]`, historyEl);
  if (bubble) {
    const isMine = chatState.user && updatedMsg.sender_id === chatState.user.id;
    bubble.className = `chat-bubble ${isMine ? "is-mine" : ""} is-unsent`;
    bubble.innerHTML = renderBubbleInner(updatedMsg, isMine);
    wireBubbleMenu(bubble, updatedMsg);
  }
  syncConversationPreview(chatState.activeConversationId);
}

function updateBubbleReadState(msg) {
  const historyEl = qs("#chat-history");
  if (!historyEl) return;
  const bubble = qs(`[data-message-id="${CSS.escape(msg.id)}"]`, historyEl);
  if (!bubble) return;
  const isMine = chatState.user && msg.sender_id === chatState.user.id;
  const existing = chatState.activeMessages.find((m) => m.id === msg.id);
  if (!existing) return;

  if (existing.is_unsent !== msg.is_unsent) {
    markBubbleUnsent(msg);
    return;
  }
  if (existing.is_read !== msg.is_read) {
    existing.is_read = msg.is_read;
    bubble.innerHTML = renderBubbleInner(msg, isMine);
    wireBubbleMenu(bubble, msg);
  }
}

function appendMessageBubble(msg) {
  if (chatState.renderedIds.has(msg.id)) {
    updateBubbleReadState(msg);
    return;
  }
  chatState.renderedIds.add(msg.id);
  chatState.activeMessages.push(msg);

  const historyEl = qs("#chat-history");
  if (!historyEl) return;
  const empty = qs(".empty-state", historyEl);
  if (empty) empty.remove();

  const isMine = chatState.user && msg.sender_id === chatState.user.id;
  if (!isMine) {
    qs("#chat-typing-hint", historyEl)?.remove();
  }
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${isMine ? "is-mine" : ""} ${msg.is_unsent ? "is-unsent" : ""}`;
  bubble.dataset.messageId = String(msg.id);
  bubble.innerHTML = renderBubbleInner(msg, isMine);
  wireBubbleMenu(bubble, msg);

  historyEl.appendChild(bubble);
  historyEl.scrollTop = historyEl.scrollHeight;

  if (!isMine && !msg.is_read && chatState.activeConversationId) {
    API.markMessageRead(chatState.activeConversationId, msg.id).catch(() => {});
  }
}

function applySnapshotMessages(messages) {
  const historyEl = qs("#chat-history");
  if (!historyEl) return;

  const incomingIds = new Set(messages.map((m) => m.id));
  const toRemove = [...chatState.renderedIds].filter((id) => !incomingIds.has(id));
  toRemove.forEach((id) => removeMessageBubble(id));

  if (!messages.length) {
    chatState.renderedIds.clear();
    chatState.activeMessages = [];
    historyEl.innerHTML = `<div class="empty-state"><p>No messages yet. Say hello and propose a public meetup spot!</p></div>`;
    return;
  }

  messages.forEach(appendMessageBubble);
}

async function selectConversation(conversationId) {
  if (!conversationId) return;
  const loadSeq = (chatState.loadSeq = (chatState.loadSeq || 0) + 1);
  cleanupMessageListener();

  chatState.activeConversationId = String(conversationId);
  chatState.activeConversation = chatState.conversations.find((c) => c.id === conversationId) || null;
  chatState.renderedIds.clear();
  chatState.activeMessages = [];
  renderConversationsList();

  const chatShell = qs("#chat-shell");
  if (chatShell) chatShell.classList.add("has-active-thread");

  const headerEl = qs("#chat-pane-header");
  const historyEl = qs("#chat-history");
  const composeForm = qs("#chat-compose-form");

  composeForm.hidden = true;
  setSyncStatus("Connecting...", "status-text-warn");
  historyEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading messages...</p></div>`;

  try {
    const detail = await API.getConversation(conversationId);
    if (chatState.loadSeq !== loadSeq) return;
    const conv = detail.conversation;
    chatState.activeConversation = conv;
    const listEntry = chatState.conversations.find((c) => c.id === conversationId);
    if (listEntry) {
      listEntry.unread_count = 0;
      renderConversationsList();
    }
    updateNavUnreadBadges();

    const groupMenuHtml = conv.group_id
      ? buildGroupMenuHtml({ is_member: true }, chatState.user)
      : "";

    headerEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.65rem;min-width:0;">
        <button type="button" class="chat-back-btn" id="chat-back-btn" aria-label="Back to conversations">&larr; Chats</button>
        <div style="min-width:0;">
          <strong class="truncate" style="display:block;">${escapeHtml(conv.title)}</strong>
          <div class="muted-small">${conv.group_id ? "Group conversation" : "Direct conversation"}</div>
        </div>
      </div>
      ${
        conv.other_user
          ? `<button type="button" class="btn btn-secondary btn-sm" id="chat-safety-btn">Safety</button>`
          : groupMenuHtml
      }
    `;

    qs("#chat-back-btn", headerEl)?.addEventListener("click", () => {
      if (chatShell) chatShell.classList.remove("has-active-thread");
    });

    if (conv.other_user) {
      qs("#chat-safety-btn", headerEl)?.addEventListener("click", () => {
        openSafetyModal(conv.other_user, () => {
          cleanupMessageListener();
          window.location.reload();
        });
      });
    } else if (conv.group_id) {
      wireGroupMenuActions({
        container: headerEl,
        groupId: conv.group_id,
        groupName: conv.title,
        creatorId: conv.group_creator_id,
        currentUser: chatState.user,
        onLeft: () => {
          cleanupAllListeners();
          window.location.href = "groups.html";
        },
        onBlocked: async () => {
          await selectConversation(conversationId);
        },
      });
    }

    historyEl.innerHTML = "";
    applySnapshotMessages(detail.messages || []);
    composeForm.hidden = false;

    chatState.unsubMessages = API.subscribeToMessages(
      conversationId,
      chatState.user,
      (liveMsgs) => {
        if (chatState.loadSeq !== loadSeq) return;
        setSyncStatus("Connected (live)", "status-text-success");
        applySnapshotMessages(liveMsgs);
      },
      () => {
        if (chatState.loadSeq !== loadSeq) return;
        setSyncStatus("Sync interrupted", "status-text-warn");
      }
    );
  } catch (err) {
    if (chatState.loadSeq !== loadSeq) return;
    setSyncStatus("Sync error", "status-text-warn");
    historyEl.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    composeForm.hidden = true;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.body?.dataset?.page !== "messages") return;
  chatState.user = await requireAuthenticatedUser();
  if (!chatState.user) return;

  window.addEventListener("beforeunload", cleanupAllListeners);

  document.addEventListener("click", (ev) => {
    if (!ev.target.closest("[data-msg-menu]")) {
      closeAllMessageMenus();
    }
  });

  try {
    setSyncStatus("Connecting...", "status-text-warn");
    chatState.conversations = await API.listConversations();
    renderConversationsList();
    setSyncStatus("Connected (live)", "status-text-success");

    const params = new URLSearchParams(window.location.search);
    const requestedId = String(params.get("conversation") || "").trim();
    if (requestedId && chatState.conversations.some((c) => c.id === requestedId)) {
      await selectConversation(requestedId);
    } else if (chatState.conversations.length && window.innerWidth > 860) {
      await selectConversation(chatState.conversations[0].id);
    }

    chatState.unsubConvs = API.subscribeToConversations(
      chatState.user,
      (updatedConvs) => {
        chatState.conversations = updatedConvs;
        renderConversationsList();
        if (
          chatState.activeConversationId &&
          !updatedConvs.some((c) => c.id === chatState.activeConversationId)
        ) {
          cleanupMessageListener();
          chatState.activeConversationId = null;
          qs("#chat-compose-form").hidden = true;
        }
      },
      () => {
        setSyncStatus("Sync interrupted", "status-text-warn");
      }
    );
  } catch (err) {
    setSyncStatus("Sync error", "status-text-warn");
    showToast(err.message, "error");
  }

  qs("#chat-compose-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = qs("#chat-message-input");
    const sendBtn = qs("#chat-send-btn");
    const content = input.value.trim();
    if (!content || !chatState.activeConversationId) return;

    sendBtn.disabled = true;
    try {
      const saved = await API.sendMessage(chatState.activeConversationId, content);
      appendMessageBubble(saved);
      input.value = "";
      const conv = chatState.conversations.find((c) => c.id === chatState.activeConversationId);
      if (conv) {
        conv.last_message = saved.content;
        conv.last_message_at = saved.created_at;
        renderConversationsList();
      }
      const historyEl = qs("#chat-history");
      if (historyEl && !qs("#chat-typing-hint", historyEl)) {
        const hint = document.createElement("div");
        hint.id = "chat-typing-hint";
        hint.className = "chat-typing-hint";
        hint.textContent =
          chatState.activeConversation?.type === "group"
            ? "Group members are typing..."
            : `${chatState.activeConversation?.other_user?.first_name || "Typing"} is typing...`;
        historyEl.appendChild(hint);
        historyEl.scrollTop = historyEl.scrollHeight;
        window.setTimeout(() => {
          hint.remove();
        }, 3500);
      }
    } catch (err) {
      showToast(err.message || "Failed to send message.", "error");
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });
});
