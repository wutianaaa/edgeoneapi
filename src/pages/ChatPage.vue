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
  <section class="page" style="max-width: 1200px; margin: 0 auto;">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Conversation</p>
        <h1>AI Chat</h1>
        <p class="page-description">开发者对话工作台，快速测试模型和调试提示词。</p>
      </div>
      <div class="toolbar">
        <span class="badge muted">{{ sessionCount }} 个会话</span>
        <button class="secondary" type="button" @click="startNewSession" :disabled="sending">
          <Plus :size="18" />
          新会话
        </button>
      </div>
    </header>

    <div style="display: grid; grid-template-columns: 260px 1fr; gap: 24px; align-items: start;">
      <aside class="panel" style="position: sticky; top: 100px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
          <h3>会话列表</h3>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto;">
          <button
            v-for="session in sessions"
            :key="session.id"
            class="secondary"
            :class="{ active: session.id === currentSessionId }"
            type="button"
            @click="switchSession(session.id)"
            :disabled="sending"
            style="justify-content: flex-start; text-align: left; min-height: 48px;"
          >
            {{ session.title }}
          </button>
        </div>
      </aside>

      <div class="panel" style="min-height: 600px; display: flex; flex-direction: column; gap: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid var(--border-default);">
          <div>
            <h2>{{ activeSessionTitle }}</h2>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge">{{ model }}</span>
            <button class="secondary" type="button" @click="clearCurrentSession" :disabled="sending || !messages.length">
              <Trash2 :size="16" />
              清空
            </button>
          </div>
        </div>

        <div ref="conversationRef" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 8px;">
          <div v-if="!messages.length" style="display: grid; place-items: center; min-height: 300px; text-align: center;">
            <div>
              <MessageSquare :size="48" style="color: var(--text-muted); margin: 0 auto 16px;" />
              <h3 style="margin-bottom: 8px;">开始对话</h3>
              <p style="color: var(--text-secondary);">输入消息开始与 AI 对话</p>
            </div>
          </div>

          <div v-for="(message, index) in messages" :key="index" style="display: flex; flex-direction: column; gap: 8px;">
            <div
              :style="{
                alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                background: message.role === 'user' ? 'var(--brand-primary)' : 'var(--bg-surface-hover)',
                color: message.role === 'user' ? '#000' : 'var(--text-primary)'
              }"
            >
              <div v-html="renderMessage(message.content)" style="line-height: 1.6;"></div>
              <div v-if="message.role === 'assistant' && message.stats?.total_ms" style="margin-top: 8px; font-size: 12px; opacity: 0.7;">
                {{ formatDuration(message.stats.total_ms) }}
              </div>
            </div>
          </div>
        </div>

        <div v-if="error" class="notice error">{{ error }}</div>

        <form @submit.prevent="sendMessage" style="display: flex; gap: 8px; padding-top: 16px; border-top: 1px solid var(--border-default);">
          <textarea
            ref="composerRef"
            v-model="draft"
            rows="1"
            placeholder="输入消息..."
            @keydown.enter.exact.prevent="sendMessage"
            style="flex: 1; min-height: 44px; max-height: 120px; resize: vertical;"
          ></textarea>
          <button type="submit" v-if="!sending" :disabled="!draft.trim()" style="min-width: 44px; padding: 0;">
            <ArrowUp :size="20" />
          </button>
          <button type="button" v-else @click="stopGeneration" class="danger" style="min-width: 44px; padding: 0;">
            <Square :size="18" />
          </button>
        </form>
      </div>
    </div>
  </section>
</template>
