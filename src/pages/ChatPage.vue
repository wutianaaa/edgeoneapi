<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { ArrowUp, MessageSquare, Plus, RefreshCw, Square, Trash2 } from "@lucide/vue";
import MarkdownIt from "markdown-it";
import { chatRequest, listPublicModels } from "../services/api.js";

const CHAT_SESSIONS_KEY = "aiapi_chat_sessions";
const CURRENT_SESSION_KEY = "aiapi_chat_current_session";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

const defaultLinkOpen = markdown.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const model = ref(localStorage.getItem("aiapi_chat_model") || "gpt-4o-mini");
const stream = ref(localStorage.getItem("aiapi_chat_stream") !== "false");
const draft = ref("");
const sending = ref(false);
const loadingModels = ref(false);
const error = ref("");
const messages = ref([]);
const sessions = ref([]);
const currentSessionId = ref("");
const availableModels = ref([]);
const conversationRef = ref(null);
const composerRef = ref(null);
const abortController = ref(null);

const temperature = ref(0.7);

const activeSessionTitle = computed(() => activeSession()?.title || "新会话");
const sessionCount = computed(() => sessions.value.length);

function createSession() {
  const now = Date.now();
  return {
    id: `chat_${now}_${Math.random().toString(36).slice(2, 8)}`,
    title: "新会话",
    messages: [],
    created_at: now,
    updated_at: now
  };
}

function emptyStats() {
  return { first_token_ms: null, total_ms: null };
}

function normalizeStats(stats) {
  if (!stats || typeof stats !== "object") return emptyStats();
  return {
    first_token_ms: stats.first_token_ms ?? null,
    total_ms: stats.total_ms ?? null
  };
}

function cloneMessages(items) {
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      role: item.role === "user" ? "user" : "assistant",
      content: String(item.content || ""),
      pending: item.role !== "user" && item.pending === true,
      stats: normalizeStats(item.stats)
    }));
}

function titleFromMessages(items) {
  const firstUserMessage = items.find((item) => item.role === "user" && item.content.trim());
  if (!firstUserMessage) return "新会话";
  const title = firstUserMessage.content.trim().replace(/\s+/g, " ");
  return title.length > 28 ? `${title.slice(0, 28)}...` : title;
}

function normalizeSession(item, index) {
  if (!item || typeof item !== "object") return null;
  const now = Date.now();
  const normalizedMessages = Array.isArray(item.messages) ? cloneMessages(item.messages) : [];
  return {
    id: String(item.id || `chat_${now}_${index}`),
    title: String(item.title || titleFromMessages(normalizedMessages)),
    messages: normalizedMessages,
    created_at: Number(item.created_at || now),
    updated_at: Number(item.updated_at || now)
  };
}

function readSavedSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_SESSIONS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSession).filter(Boolean);
  } catch {
    return [];
  }
}

function activeSession() {
  return sessions.value.find((item) => item.id === currentSessionId.value);
}

function saveSessions() {
  localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions.value));
  localStorage.setItem(CURRENT_SESSION_KEY, currentSessionId.value);
}

function persistCurrentMessages() {
  const session = activeSession();
  if (!session) return;

  session.messages = cloneMessages(messages.value);
  session.title = titleFromMessages(session.messages);
  session.updated_at = Date.now();
  sessions.value = [session, ...sessions.value.filter((item) => item.id !== session.id)];
  saveSessions();
}

function loadSessions() {
  const saved = readSavedSessions();
  sessions.value = saved.length ? saved : [createSession()];

  const savedCurrentId = localStorage.getItem(CURRENT_SESSION_KEY);
  currentSessionId.value = sessions.value.some((item) => item.id === savedCurrentId)
    ? savedCurrentId
    : sessions.value[0].id;

  messages.value = cloneMessages(activeSession()?.messages || []);
  saveSessions();
  scrollToBottom();
}

function startNewSession() {
  if (sending.value) return;
  const session = createSession();
  sessions.value = [session, ...sessions.value];
  currentSessionId.value = session.id;
  messages.value = [];
  draft.value = "";
  error.value = "";
  saveSessions();
  scrollToBottom();
  focusComposer();
}

function switchSession(id) {
  if (sending.value || id === currentSessionId.value) return;
  currentSessionId.value = id;
  messages.value = cloneMessages(activeSession()?.messages || []);
  draft.value = "";
  error.value = "";
  saveSessions();
  scrollToBottom();
}

function clearCurrentSession() {
  if (sending.value) return;
  messages.value = [];
  draft.value = "";
  error.value = "";
  persistCurrentMessages();
  focusComposer();
}

function focusComposer() {
  nextTick(() => {
    composerRef.value?.focus();
  });
}

function saveModelPreference() {
  localStorage.setItem("aiapi_chat_model", model.value);
}

async function loadModels() {
  loadingModels.value = true;
  error.value = "";

  try {
    const body = await listPublicModels();
    availableModels.value = (body.data || []).map((item) => item.id).filter(Boolean);
    if (availableModels.value.length && !availableModels.value.includes(model.value)) {
      model.value = availableModels.value[0];
      localStorage.setItem("aiapi_chat_model", model.value);
    }
  } catch (cause) {
    error.value = cause.message;
  } finally {
    loadingModels.value = false;
  }
}

function createAssistantMessage() {
  return { role: "assistant", content: "", pending: true, stats: emptyStats() };
}

function elapsedMs(startedAt) {
  return Math.max(1, Date.now() - startedAt);
}

function buildPayloadMessages(items) {
  return items
    .map((item) => ({ role: item.role, content: item.content }))
    .filter((item) => item.content);
}

async function sendMessage() {
  const text = draft.value.trim();
  if (!text || sending.value) return;

  error.value = "";
  localStorage.setItem("aiapi_chat_model", model.value);
  draft.value = "";

  messages.value.push({ role: "user", content: text });
  const assistantIndex = messages.value.length;
  messages.value.push(createAssistantMessage());
  persistCurrentMessages();
  await scrollToBottom();
  sending.value = true;

  await requestAssistant(assistantIndex, messages.value.slice(0, assistantIndex));
}

async function requestAssistant(assistantIndex, contextMessages) {
  const startedAt = Date.now();
  abortController.value = new AbortController();

  try {
    const payload = {
      model: model.value,
      messages: buildPayloadMessages(contextMessages),
      stream: stream.value,
      temperature: temperature.value
    };

    const response = await chatRequest(payload, abortController.value.signal);

    if (stream.value && response.body && isEventStream(response)) {
      await readStream(response, assistantIndex, startedAt);
    } else {
      const body = await response.json();
      const elapsed = elapsedMs(startedAt);
      updateAssistant(
        assistantIndex,
        body.choices?.[0]?.message?.content || JSON.stringify(body, null, 2),
        { first_token_ms: elapsed, total_ms: elapsed }
      );
    }
  } catch (cause) {
    if (cause.name === "AbortError") {
      const current = messages.value[assistantIndex];
      const stoppedContent = current?.content ? `${current.content}\n\n[已停止生成]` : "[已停止生成]";
      updateAssistant(assistantIndex, stoppedContent, { total_ms: elapsedMs(startedAt) });
    } else {
      updateAssistant(assistantIndex, "", { total_ms: elapsedMs(startedAt) });
      error.value = cause.message;
    }
  } finally {
    finishAssistantTiming(assistantIndex, startedAt);
    sending.value = false;
    abortController.value = null;
    persistCurrentMessages();
  }
}

function isEventStream(response) {
  return (response.headers.get("content-type") || "").toLowerCase().includes("text/event-stream");
}

async function readStream(response, assistantIndex, startedAt) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        finishAssistantTiming(assistantIndex, startedAt);
        return;
      }

      try {
        const chunk = JSON.parse(data);
        appendAssistant(assistantIndex, extractDeltaText(chunk), startedAt);
      } catch {
        appendAssistant(assistantIndex, data, startedAt);
      }
    }
  }

  finishAssistantTiming(assistantIndex, startedAt);
}

function extractDeltaText(chunk) {
  const delta = chunk.choices?.[0]?.delta || {};
  return delta.content || "";
}

function appendAssistant(index, text, startedAt) {
  if (!text) return;
  const current = messages.value[index];
  if (!current) return;
  const stats = normalizeStats(current.stats);
  if (stats.first_token_ms == null) {
    stats.first_token_ms = elapsedMs(startedAt);
  }
  updateAssistant(index, current.content + text, stats);
}

function updateAssistant(index, content, statsPatch) {
  const current = messages.value[index];
  if (!current) return;
  messages.value[index] = {
    ...current,
    content,
    stats: statsPatch ? { ...normalizeStats(current.stats), ...statsPatch } : current.stats
  };
  persistCurrentMessages();
  scrollToBottom();
}

function finishAssistantTiming(index, startedAt) {
  const current = messages.value[index];
  if (!current || current.role !== "assistant") return;
  const stats = normalizeStats(current.stats);
  messages.value[index] = {
    ...current,
    pending: false,
    stats: { ...stats, total_ms: stats.total_ms ?? elapsedMs(startedAt) }
  };
  persistCurrentMessages();
  scrollToBottom();
}

function stopGeneration() {
  if (abortController.value) {
    abortController.value.abort();
  }
}

function renderMessage(content) {
  return markdown.render(content || "");
}

function formatDuration(ms) {
  if (ms == null) return "--";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function scrollToBottom() {
  await nextTick();
  const el = conversationRef.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
}

onMounted(() => {
  loadSessions();
  loadModels();
});
</script>

<template>
  <div class="chat-container">
    <!-- 左侧会话列表 -->
    <aside class="chat-sidebar">
      <div class="chat-sidebar-header">
        <button class="btn-new-chat" type="button" @click="startNewSession" :disabled="sending">
          <Plus :size="18" />
          <span>新会话</span>
        </button>
      </div>

      <div class="chat-sessions">
        <button
          v-for="session in sessions"
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === currentSessionId }"
          type="button"
          @click="switchSession(session.id)"
          :disabled="sending"
        >
          <MessageSquare :size="16" />
          <span class="session-title">{{ session.title }}</span>
        </button>
      </div>

      <div class="chat-sidebar-footer">
        <span class="badge muted">{{ sessionCount }} 个会话</span>
      </div>
    </aside>

    <!-- 右侧对话区域 -->
    <main class="chat-main">
      <!-- 顶部工具栏 -->
      <header class="chat-header">
        <div class="chat-header-left">
          <h2>{{ activeSessionTitle }}</h2>
        </div>
        <div class="chat-header-right">
          <select v-model="model" @change="saveModelPreference" :disabled="sending" class="model-select">
            <option v-if="loadingModels" disabled>加载中...</option>
            <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
          </select>
          <button class="icon-button" type="button" @click="clearCurrentSession" :disabled="sending || !messages.length" title="清空会话">
            <Trash2 :size="18" />
          </button>
        </div>
      </header>

      <!-- 对话区域 -->
      <div ref="conversationRef" class="chat-conversation">
        <div v-if="!messages.length" class="chat-empty">
          <div>
            <MessageSquare :size="64" style="color: var(--text-muted); margin: 0 auto 24px;" />
            <h3 style="margin-bottom: 12px;">开始对话</h3>
            <p style="color: var(--text-secondary);">输入消息开始与 AI 对话</p>
          </div>
        </div>

        <div v-for="(message, index) in messages" :key="index" class="message-wrapper">
          <div
            class="message-bubble"
            :class="message.role"
          >
            <div v-html="renderMessage(message.content)" class="message-content"></div>
            <div v-if="message.role === 'assistant' && message.stats?.total_ms" class="message-meta">
              {{ formatDuration(message.stats.total_ms) }}
            </div>
          </div>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="chat-error">
        <div class="notice error">{{ error }}</div>
      </div>

      <!-- 输入区域 -->
      <div class="chat-composer">
        <form @submit.prevent="sendMessage" class="composer-form">
          <textarea
            ref="composerRef"
            v-model="draft"
            rows="1"
            placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
            @keydown.enter.exact.prevent="sendMessage"
            class="composer-input"
          ></textarea>
          <button type="submit" v-if="!sending" :disabled="!draft.trim()" class="btn-send">
            <ArrowUp :size="20" />
          </button>
          <button type="button" v-else @click="stopGeneration" class="btn-stop">
            <Square :size="18" />
          </button>
        </form>
      </div>
    </main>
  </div>
</template>
