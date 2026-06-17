<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import {
  ArrowUp,
  Copy,
  Download,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2
} from "@lucide/vue";
import MarkdownIt from "markdown-it";
import { chatRequest, listPublicModels } from "../services/api.js";

const CHAT_SESSIONS_KEY = "aiapi_chat_sessions";
const CURRENT_SESSION_KEY = "aiapi_chat_current_session";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

const starterPrompts = [
  "给我一份这个网关项目的接口巡检清单。",
  "把当前聊天页的布局问题拆成 3 个可执行改进方向。",
  "解释如何给一个上游模型通道做健康监控。"
];

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
const expandedThinking = ref({});
const abortController = ref(null);

const temperature = ref(numberFromStorage("aiapi_temperature", 0.7, 0, 2));
const maxTokens = ref(numberFromStorage("aiapi_max_tokens", null, 1, 32000));
const topP = ref(numberFromStorage("aiapi_top_p", 1, 0, 1));

const activeSessionTitle = computed(() => activeSession()?.title || "新会话");
const sessionCount = computed(() => sessions.value.length);
const messageCount = computed(() => messages.value.length);
const assistantReplyCount = computed(() => messages.value.filter((item) => item.role === "assistant" && !item.pending).length);
const lastLatency = computed(() => {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const item = messages.value[index];
    if (item?.role === "assistant" && item.stats?.total_ms != null) {
      return item.stats.total_ms;
    }
  }
  return null;
});

function numberFromStorage(key, fallback, min, max) {
  const saved = localStorage.getItem(key);
  if (saved == null || saved === "") return fallback;
  const value = clampNumber(saved, min, max, fallback);
  return value === fallback ? fallback : value;
}

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function updateTemperature(value) {
  temperature.value = clampNumber(value, 0, 2, 0.7);
  localStorage.setItem("aiapi_temperature", String(temperature.value));
}

function updateMaxTokens(value) {
  if (value === "" || value === null || value === undefined) {
    maxTokens.value = null;
    localStorage.removeItem("aiapi_max_tokens");
    return;
  }

  maxTokens.value = Math.round(clampNumber(value, 1, 32000, null));
  if (maxTokens.value !== null) {
    localStorage.setItem("aiapi_max_tokens", String(maxTokens.value));
  }
}

function updateTopP(value) {
  topP.value = clampNumber(value, 0, 1, 1);
  localStorage.setItem("aiapi_top_p", String(topP.value));
}

function toggleStream() {
  stream.value = !stream.value;
  localStorage.setItem("aiapi_chat_stream", String(stream.value));
}

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
  return {
    first_token_ms: null,
    total_ms: null
  };
}

function normalizeStats(stats) {
  if (!stats || typeof stats !== "object") return emptyStats();
  return {
    first_token_ms: numberOrNull(stats.first_token_ms),
    total_ms: numberOrNull(stats.total_ms)
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cloneMessages(items) {
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      role: item.role === "user" ? "user" : "assistant",
      content: String(item.content || ""),
      reasoning: String(item.reasoning || ""),
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
  sessions.value = [
    session,
    ...sessions.value.filter((item) => item.id !== session.id)
  ];
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
  expandedThinking.value = {};
  draft.value = "";
  error.value = "";
  saveSessions();
  scrollToBottom();
}

function clearCurrentSession() {
  if (sending.value) return;
  messages.value = [];
  expandedThinking.value = {};
  draft.value = "";
  error.value = "";
  persistCurrentMessages();
  focusComposer();
}

function useStarterPrompt(prompt) {
  draft.value = prompt;
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
  return { role: "assistant", content: "", reasoning: "", pending: true, stats: emptyStats() };
}

function elapsedMs(startedAt) {
  return Math.max(1, Date.now() - startedAt);
}

function buildPayloadMessages(items) {
  return items
    .map((item) => ({
      role: item.role,
      content: item.role === "assistant" ? splitThinking(item).answer : item.content
    }))
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
      temperature: temperature.value,
      top_p: topP.value
    };

    if (maxTokens.value !== null && maxTokens.value !== undefined) {
      payload.max_tokens = maxTokens.value;
    }

    const response = await chatRequest(payload, abortController.value.signal);

    if (stream.value && response.body && isEventStream(response)) {
      await readStream(response, assistantIndex, startedAt);
    } else {
      const body = await response.json();
      const elapsed = elapsedMs(startedAt);
      updateAssistant(
        assistantIndex,
        body.choices?.[0]?.message?.content || JSON.stringify(body, null, 2),
        { first_token_ms: elapsed, total_ms: elapsed },
        body.choices?.[0]?.message?.reasoning_content || ""
      );
    }
  } catch (cause) {
    if (cause.name === "AbortError") {
      const current = messages.value[assistantIndex];
      const stoppedContent = current?.content
        ? `${current.content}\n\n[已停止生成]`
        : "[已停止生成]";
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

async function regenerateAssistant(index) {
  if (sending.value) return;
  const current = messages.value[index];
  if (!current || current.role !== "assistant") return;

  const contextMessages = messages.value.slice(0, index);
  if (!contextMessages.some((item) => item.role === "user" && item.content.trim())) return;

  error.value = "";
  messages.value = [
    ...contextMessages,
    createAssistantMessage()
  ];
  persistCurrentMessages();
  await scrollToBottom();
  sending.value = true;
  await requestAssistant(index, contextMessages);
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
        appendAssistantReasoning(assistantIndex, extractReasoningText(chunk), startedAt);
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

function extractReasoningText(chunk) {
  const delta = chunk.choices?.[0]?.delta || {};
  return delta.reasoning_content || delta.reasoning || "";
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

function appendAssistantReasoning(index, text, startedAt) {
  if (!text) return;
  const current = messages.value[index];
  if (!current) return;
  const stats = normalizeStats(current.stats);
  if (stats.first_token_ms == null) {
    stats.first_token_ms = elapsedMs(startedAt);
  }
  updateAssistant(index, current.content, stats, `${current.reasoning || ""}${text}`);
}

function updateAssistant(index, content, statsPatch, reasoning) {
  const current = messages.value[index];
  if (!current) return;
  messages.value[index] = {
    ...current,
    content,
    reasoning: reasoning !== undefined ? reasoning : current.reasoning,
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
    stats: {
      ...stats,
      total_ms: stats.total_ms ?? elapsedMs(startedAt)
    }
  };
  persistCurrentMessages();
  scrollToBottom();
}

function stopGeneration() {
  if (abortController.value) {
    abortController.value.abort();
  }
}

async function copyMessage(content) {
  if (!content) return;
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    error.value = "复制失败，请手动选中内容。";
  }
}

async function exportChat(format) {
  const session = activeSession();
  if (!session || !session.messages.length) {
    error.value = "当前会话没有可导出的内容。";
    return;
  }

  try {
    let content = "";
    const filename = `chat-${session.id}-${Date.now()}.${format}`;

    if (format === "json") {
      content = JSON.stringify({
        session_id: session.id,
        title: session.title,
        created_at: new Date(session.created_at).toISOString(),
        updated_at: new Date(session.updated_at).toISOString(),
        messages: session.messages
      }, null, 2);
    } else {
      content = `# ${session.title}\n\n`;
      content += `**Created:** ${new Date(session.created_at).toLocaleString()}\n\n`;
      content += `---\n\n`;

      for (const msg of session.messages) {
        const role = msg.role === "user" ? "User" : "Assistant";
        const thinking = msg.role === "assistant" ? splitThinking(msg) : { reasoning: "", answer: msg.content };
        content += `## ${role}\n\n`;

        if (msg.role === "assistant" && thinking.reasoning) {
          content += `<details>\n<summary>Thinking</summary>\n\n${thinking.reasoning}\n\n</details>\n\n`;
        }

        content += `${msg.role === "assistant" ? thinking.answer : msg.content}\n\n`;

        if (msg.stats?.first_token_ms || msg.stats?.total_ms) {
          content += `*Stats: First token ${formatDuration(msg.stats.first_token_ms)}, Total ${formatDuration(msg.stats.total_ms)}*\n\n`;
        }

        content += `---\n\n`;
      }
    }

    const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    error.value = "";
  } catch (cause) {
    error.value = `导出失败: ${cause.message}`;
  }
}

function splitThinking(message) {
  const rawContent = String(message?.content || "");
  const thinkParts = [];
  const answer = rawContent.replace(/<think>([\s\S]*?)(<\/think>|$)/gi, (_match, thought) => {
    thinkParts.push(String(thought || "").trim());
    return "";
  }).trim();
  const reasoning = [
    String(message?.reasoning || "").trim(),
    ...thinkParts
  ].filter(Boolean).join("\n\n");
  return { reasoning, answer };
}

function renderMessage(content) {
  return markdown.render(content || "");
}

function formatDuration(ms) {
  if (ms == null) return "--";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

function formatRelativeTime(value) {
  if (!value) return "刚刚";
  const diff = Date.now() - value;
  if (diff < 60_000) return "刚刚更新";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(value).toLocaleDateString();
}

function sessionPreview(session) {
  const lastMessage = [...(session.messages || [])].reverse().find((item) => item.content?.trim());
  if (!lastMessage) return "等待第一条输入";
  const content = splitThinking(lastMessage).answer || lastMessage.content;
  return content.length > 48 ? `${content.slice(0, 48)}...` : content;
}

function thinkingKey(index) {
  return `${currentSessionId.value}:${index}`;
}

function isAssistantThinking(message) {
  return message?.role === "assistant" && message?.pending === true;
}

function isThinkingOpen(message, index) {
  return isAssistantThinking(message) || expandedThinking.value[thinkingKey(index)] === true;
}

function toggleThinking(index) {
  const key = thinkingKey(index);
  expandedThinking.value = {
    ...expandedThinking.value,
    [key]: !expandedThinking.value[key]
  };
}

async function scrollToBottom() {
  await nextTick();
  const el = conversationRef.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }
}

onMounted(() => {
  loadSessions();
  loadModels();
});
</script>

<template>
  <section class="page chat-page">
    <header class="chat-hero">
      <div>
        <p class="eyebrow">Conversation Surface</p>
        <h1>开发者对话工作台</h1>
        <p class="page-description">
          用同一套工作台处理会话、模型和运行参数。聊天不再是孤立页面，而是整个 API 控制台里的核心操作面。
        </p>
      </div>
      <div class="hero-metrics">
        <article class="hero-metric-card">
          <span>会话数</span>
          <strong>{{ sessionCount }}</strong>
        </article>
        <article class="hero-metric-card">
          <span>当前消息</span>
          <strong>{{ messageCount }}</strong>
        </article>
        <article class="hero-metric-card">
          <span>完成回复</span>
          <strong>{{ assistantReplyCount }}</strong>
        </article>
        <article class="hero-metric-card">
          <span>最近延迟</span>
          <strong>{{ formatDuration(lastLatency) }}</strong>
        </article>
      </div>
    </header>

    <section class="chat-workbench-grid">
      <aside class="panel chat-session-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Sessions</p>
            <h2>本地会话</h2>
          </div>
          <button class="icon-button" type="button" @click="startNewSession" :disabled="sending" aria-label="新建会话">
            <Plus :size="18" />
          </button>
        </div>

        <div class="chat-session-summary">
          <div class="context-metric">
            <span>当前标题</span>
            <strong>{{ activeSessionTitle }}</strong>
          </div>
          <div class="context-metric">
            <span>模型</span>
            <strong>{{ model }}</strong>
          </div>
        </div>

        <nav class="session-list">
          <button
            v-for="session in sessions"
            :key="session.id"
            class="session-card"
            :class="{ active: session.id === currentSessionId }"
            type="button"
            @click="switchSession(session.id)"
            :disabled="sending"
          >
            <div class="session-card-head">
              <span class="session-card-title">{{ session.title }}</span>
              <span class="badge muted">{{ session.messages.length }}</span>
            </div>
            <p class="session-card-preview">{{ sessionPreview(session) }}</p>
            <p class="session-card-time">{{ formatRelativeTime(session.updated_at) }}</p>
          </button>
        </nav>
      </aside>

      <section class="panel chat-canvas">
        <header class="chat-canvas-header">
          <div>
            <p class="eyebrow">Active Session</p>
            <h2>{{ activeSessionTitle }}</h2>
            <p class="page-description">围绕当前会话连续试验模型、参数和提示词，不必离开控制台。</p>
          </div>
          <div class="chat-canvas-actions">
            <span class="badge on">{{ stream ? "Streaming" : "JSON" }}</span>
            <span class="badge muted">{{ model }}</span>
          </div>
        </header>

        <section ref="conversationRef" class="conversation" :class="{ 'is-empty': !messages.length }" aria-live="polite">
          <div v-if="!messages.length" class="chat-empty-state">
            <div class="chat-empty-copy">
              <p class="eyebrow">Ready</p>
              <h2>从一个明确的问题开始</h2>
              <p>
                这里适合做开发者场景对话：接口排障、提示词验证、模型比较和返回结果分析。
              </p>
            </div>
            <div class="chat-starter-list">
              <button
                v-for="prompt in starterPrompts"
                :key="prompt"
                class="starter-chip"
                type="button"
                @click="useStarterPrompt(prompt)"
              >
                {{ prompt }}
              </button>
            </div>
          </div>

          <div v-for="(message, index) in messages" :key="index" class="message-row" :class="message.role">
            <div v-if="message.role === 'assistant'" class="assistant-avatar">AI</div>
            <article class="message-card" :class="message.role">
              <template v-if="message.role === 'assistant'">
                <div
                  v-if="splitThinking(message).reasoning"
                  class="thinking-block"
                  :class="{ open: isThinkingOpen(message, index) }"
                >
                  <button
                    class="thinking-toggle"
                    type="button"
                    :aria-expanded="isThinkingOpen(message, index)"
                    @click="toggleThinking(index)"
                  >
                    思考过程
                  </button>
                  <div
                    v-if="isThinkingOpen(message, index)"
                    class="thinking-content"
                    v-html="renderMessage(splitThinking(message).reasoning)"
                  ></div>
                </div>

                <div class="message-content" v-html="renderMessage(splitThinking(message).answer)"></div>

                <div class="message-meta">
                  <div class="message-actions">
                    <button
                      class="message-action-button"
                      type="button"
                      @click="copyMessage(splitThinking(message).answer)"
                      :disabled="!splitThinking(message).answer"
                      aria-label="复制回复"
                    >
                      <Copy :size="16" />
                    </button>
                    <button
                      class="message-action-button"
                      type="button"
                      @click="regenerateAssistant(index)"
                      :disabled="sending"
                      aria-label="重新生成回复"
                    >
                      <RefreshCw :size="16" />
                    </button>
                  </div>
                  <div v-if="message.stats?.first_token_ms != null || message.stats?.total_ms != null" class="message-stats">
                    <span>首字 {{ formatDuration(message.stats.first_token_ms) }}</span>
                    <span>总耗时 {{ formatDuration(message.stats.total_ms) }}</span>
                  </div>
                </div>
              </template>

              <div v-else class="message-content" v-html="renderMessage(message.content)"></div>
            </article>
          </div>
        </section>

        <p v-if="error" class="notice error">{{ error }}</p>

        <form class="composer" @submit.prevent="sendMessage">
          <div class="composer-main">
            <textarea
              ref="composerRef"
              v-model="draft"
              rows="1"
              placeholder="输入问题、调试思路或需要生成的结果"
              @keydown.enter.exact.prevent="sendMessage"
            ></textarea>
            <div class="composer-footer">
              <div class="composer-hint">
                <MessageSquare :size="16" />
                <span>Enter 发送，Shift + Enter 换行</span>
              </div>
              <div class="composer-actions">
                <button
                  class="secondary compact-button"
                  type="button"
                  @click="clearCurrentSession"
                  :disabled="sending || !messages.length"
                >
                  <Trash2 :size="16" />
                  清空
                </button>
                <button class="send-button" type="submit" v-if="!sending" :disabled="!draft.trim()" aria-label="发送">
                  <ArrowUp :size="18" />
                </button>
                <button class="send-button danger" type="button" v-else @click="stopGeneration" aria-label="停止生成">
                  <Square :size="16" />
                </button>
              </div>
            </div>
          </div>
        </form>
      </section>

      <aside class="chat-runtime-rail">
        <section class="panel runtime-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Runtime</p>
              <h2>模型与参数</h2>
            </div>
            <button class="icon-button" type="button" @click="loadModels" :disabled="loadingModels" aria-label="刷新模型">
              <RefreshCw :size="18" :class="{ spinning: loadingModels }" />
            </button>
          </div>

          <label>
            当前模型
            <select v-if="availableModels.length" v-model="model">
              <option v-for="item in availableModels" :key="item" :value="item">{{ item }}</option>
            </select>
            <input v-else v-model="model" autocomplete="off" placeholder="gpt-4o-mini">
          </label>

          <div class="switch-card">
            <div>
              <strong>流式响应</strong>
              <p>更适合边看边调试延迟和推理过程。</p>
            </div>
            <button class="secondary compact-button" type="button" :class="{ active: stream }" @click="toggleStream">
              {{ stream ? "已开启" : "已关闭" }}
            </button>
          </div>

          <label>
            Temperature
            <input type="range" min="0" max="2" step="0.1" :value="temperature" @input="updateTemperature($event.target.value)">
            <span class="field-meta">{{ temperature }}</span>
          </label>

          <label>
            Top P
            <input type="range" min="0" max="1" step="0.05" :value="topP" @input="updateTopP($event.target.value)">
            <span class="field-meta">{{ topP }}</span>
          </label>

          <label>
            Max Tokens
            <input
              type="number"
              min="1"
              max="32000"
              :value="maxTokens || ''"
              @input="updateMaxTokens($event.target.value)"
              placeholder="不限制"
            >
            <span class="field-meta">{{ maxTokens || "不限制" }}</span>
          </label>
        </section>

        <section class="panel runtime-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Session Ops</p>
              <h2>导出与观察</h2>
            </div>
            <Sparkles :size="18" />
          </div>

          <div class="context-metric">
            <span>当前会话</span>
            <strong>{{ activeSessionTitle }}</strong>
          </div>
          <div class="context-metric">
            <span>响应模式</span>
            <strong>{{ stream ? "Streaming" : "Non-streaming" }}</strong>
          </div>
          <div class="context-metric">
            <span>公开模型源</span>
            <strong>{{ availableModels.length ? `${availableModels.length} 个` : "未加载" }}</strong>
          </div>

          <div class="export-buttons">
            <button type="button" class="secondary" @click="exportChat('md')">
              <Download :size="16" />
              Markdown
            </button>
            <button type="button" class="secondary" @click="exportChat('json')">
              <Download :size="16" />
              JSON
            </button>
          </div>
        </section>
      </aside>
    </section>
  </section>
</template>
