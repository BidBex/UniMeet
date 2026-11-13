/**
 * Real-time WebSocket + REST messaging interface (messages.html).
 * Uses short-lived WS connection tickets (no long-lived JWT in URL query strings),
 * handles disconnects/reconnects, shows live status, and confirms server persistence.
 */
import { API } from "./api.js";
import { CONFIG } from "./config.js";
import { openSafetyModal, requireAuthenticatedUser } from "./navigation.js";
import { escapeHtml, formatTimeShort, getInitials, qs, qsa, showToast } from "./utils.js";

const chatState = {
  user: null,
  conversations: [],
  activeConversationId: null,
  activeMessages: [],
  renderedIds: new Set(),
  socket: null,
  reconnectTimer: null,
};

function setWsStatus(label, cssClass = "") {
  const el = qs("#ws-status-label");
  if (!el) return;
  el.textContent = label;
  el.className = `muted-small ${cssClass}`;
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
      const initials = conv.other_user
        ? getInitials(conv.other_user.first_name, conv.other_user.last_name)
        : conv.title.slice(0, 2).toUpperCase();
      const timeText = conv.last_message_at ? formatTimeShort(conv.last_message_at) : "";
      const unreadText = conv.unread_count > 0 ? ` · ${conv.unread_count} unread` : "";

      return `
        <button type="button" class="chat-thread-item ${active}" data-conv-id="${conv.id}">
          <div class="avatar-circle">${escapeHtml(initials)}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;gap:0.5rem;">
              <strong class="truncate">${escapeHtml(conv.title)}</strong>
              <span class="muted-small tabular-num">${escapeHtml(timeText)}</span>
            </div>
            <div class="muted-small truncate">
              ${escapeHtml(conv.last_message || "No messages yet")}${escapeHtml(unreadText)}
            </div>
          </div>
        </button>
      `;
    })
    .join("");

  qsa("[data-conv-id]", listEl).forEach((btn) => {
    btn.addEventListener("click", () => selectConversation(Number(btn.dataset.convId)));
  });
}

function appendMessageBubble(msg) {
  if (chatState.renderedIds.has(msg.id)) return;
  chatState.renderedIds.add(msg.id);
  chatState.activeMessages.push(msg);

  const historyEl = qs("#chat-history");
  if (!historyEl) return;
  const empty = qs(".empty-state", historyEl);
  if (empty) empty.remove();

  const isMine = chatState.user && msg.sender_id === chatState.user.id;
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${isMine ? "is-mine" : ""}`;
  bubble.innerHTML = `
    <div>${escapeHtml(msg.content)}</div>
    <div class="chat-meta tabular-num">${escapeHtml(formatTimeShort(msg.created_at))}${isMine ? (msg.is_read ? " · Read" : " · Sent") : ""}</div>
  `;
  historyEl.appendChild(bubble);
  historyEl.scrollTop = historyEl.scrollHeight;

  if (!isMine && !msg.is_read) {
    API.markMessageRead(msg.id).catch(() => {});
  }
}

function closeActiveSocket() {
  if (chatState.reconnectTimer) {
    window.clearTimeout(chatState.reconnectTimer);
    chatState.reconnectTimer = null;
  }
  if (chatState.socket) {
    chatState.socket.onclose = null;
    chatState.socket.close();
    chatState.socket = null;
  }
}

async function connectWebSocket(conversationId) {
  closeActiveSocket();
  setWsStatus("Connecting...", "status-text-warn");

  let ticketQuery = "";
  try {
    const ticketRes = await API.getWsTicket();
    ticketQuery = `?ticket=${encodeURIComponent(ticketRes.ticket)}`;
  } catch {
    // Fallback to HttpOnly cookie auth on same-origin WS
  }

  const wsUrl = `${CONFIG.WS_BASE_URL}/ws/chat/${conversationId}${ticketQuery}`;
  const ws = new WebSocket(wsUrl);
  chatState.socket = ws;

  ws.onopen = () => {
    setWsStatus("Connected (live)", "status-text-success");
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "connection:ready") {
        setWsStatus("Connected (live)", "status-text-success");
      } else if (payload.type === "message:new" && payload.message) {
        appendMessageBubble(payload.message);
        const conv = chatState.conversations.find((c) => c.id === conversationId);
        if (conv) {
          conv.last_message = payload.message.content;
          conv.last_message_at = payload.message.created_at;
          renderConversationsList();
        }
      } else if (payload.type === "error" && payload.detail) {
        showToast(payload.detail, "error");
      }
    } catch {
      // Ignore malformed frames
    }
  };

  ws.onerror = () => {
    setWsStatus("Connection interrupted", "status-text-warn");
  };

  ws.onclose = () => {
    if (chatState.activeConversationId === conversationId) {
      setWsStatus("Disconnected — reconnecting...", "status-text-warn");
      chatState.reconnectTimer = window.setTimeout(() => {
        if (chatState.activeConversationId === conversationId) {
          connectWebSocket(conversationId);
        }
      }, 3000);
    } else {
      setWsStatus("Disconnected");
    }
  };
}

async function selectConversation(conversationId) {
  chatState.activeConversationId = conversationId;
  chatState.renderedIds.clear();
  chatState.activeMessages = [];
  renderConversationsList();

  const headerEl = qs("#chat-pane-header");
  const historyEl = qs("#chat-history");
  const composeForm = qs("#chat-compose-form");

  historyEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading messages...</p></div>`;

  try {
    const detail = await API.getConversation(conversationId);
    const conv = detail.conversation;
    headerEl.innerHTML = `
      <div>
        <strong>${escapeHtml(conv.title)}</strong>
        <div class="muted-small">${conv.group_id ? "Group conversation" : "Direct conversation"}</div>
      </div>
      ${
        conv.other_user
          ? `<button type="button" class="btn btn-secondary btn-sm" id="chat-safety-btn">Safety</button>`
          : ""
      }
    `;

    if (conv.other_user) {
      qs("#chat-safety-btn", headerEl)?.addEventListener("click", () => {
        openSafetyModal(conv.other_user, () => {
          closeActiveSocket();
          window.location.reload();
        });
      });
    }

    historyEl.innerHTML = "";
    if (!detail.messages.length) {
      historyEl.innerHTML = `<div class="empty-state"><p>No messages yet. Say hello and propose a public meetup spot!</p></div>`;
    } else {
      detail.messages.forEach(appendMessageBubble);
    }

    composeForm.hidden = false;
    await connectWebSocket(conversationId);
  } catch (err) {
    historyEl.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
    composeForm.hidden = true;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.body?.dataset?.page !== "messages") return;
  chatState.user = await requireAuthenticatedUser();
  if (!chatState.user) return;

  try {
    chatState.conversations = await API.listConversations();
    renderConversationsList();

    const params = new URLSearchParams(window.location.search);
    const requestedId = Number(params.get("conversation"));
    if (requestedId && chatState.conversations.some((c) => c.id === requestedId)) {
      await selectConversation(requestedId);
    } else if (chatState.conversations.length) {
      await selectConversation(chatState.conversations[0].id);
    }
  } catch (err) {
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
      // Send via REST endpoint so server persistence is explicitly confirmed (and WS broadcasts to room)
      const saved = await API.sendMessage(chatState.activeConversationId, content);
      appendMessageBubble(saved);
      input.value = "";
      const conv = chatState.conversations.find((c) => c.id === chatState.activeConversationId);
      if (conv) {
        conv.last_message = saved.content;
        conv.last_message_at = saved.created_at;
        renderConversationsList();
      }
    } catch (err) {
      showToast(err.message || "Failed to send message.", "error");
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });
});
