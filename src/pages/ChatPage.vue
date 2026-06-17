<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  ArrowUp,
  Copy,
  Download,
  MessageSquare,
  Moon,
  Plus,
  RefreshCw,
  Settings,
  Sliders,
  Sparkles,
  Square,
  Sun,
  Trash2,
  X
} from "@lucide/vue";
import MarkdownIt from "markdown-it";
import { chatRequest, listPublicModels } from "../services/api.js";

const CHAT_SESSIONS_KEY = "aiapi_chat_sessions";
const CURRENT_SESSION_KEY = "aiapi_chat_current_session";
const THEME_KEY = "aiapi_theme";

defineProps({
  embedded: {
    type: Boolean,
    default: false
  }
});

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

const defaultLinkOpen = markdown.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const model = ref(localStorage.getItem("aiapi_chat_model") || "gpt-4o-mini");
const stream = ref(true);
const draft = ref("");
const sending = ref(false);
const loadingModels = ref(false);
const error = ref("");
const messages = ref([]);
const sessions = ref([]);
const currentSessionId = ref("");
const availableModels = ref([]);
const conversationRef = ref(null);
const expandedThinking = ref({});
const abortController = ref(null);
const showSettings = ref(false);
const theme = ref(localStorage.getItem(THEME_KEY) || "light");

const temperature = ref(numberFromStorage("aiapi_temperature", 0.7, 0, 2));
const maxTokens = ref(numberFromStorage("aiapi_max_tokens", null, 1, 32000));
const topP = ref(numberFromStorage("aiapi_top_p", 1, 0, 1));

function toggleTheme() {
  theme.value = theme.value === "light" ? "dark" : "light";
  localStorage.setItem(THEME_KEY, theme.value);
  applyTheme();
}

function applyTheme() {
  if (theme.value === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

function toggleSettings() {
  showSettings.value = !showSettings.value;
}

function updateTemperature(value) {
  temperature.value = clampNumber(value, 0, 2, 0.7);
  localStorage.setItem("aiapi_temperature", String(temperature.value));
}

function updateMaxTokens(value) {
  if (value === "" || value === null || value === undefined) {
    maxTokens.value = null;
    localStorage.removeItem("aiapi_max_tokens");
  } else {
    maxTokens.value = Math.round(clampNumber(value, 1, 32000, null));
    if (maxTokens.value !== null) {
      localStorage.setItem("aiapi_max_tokens", String(maxTokens.value));
    }
  }
}

function updateTopP(value) {
  topP.value = clampNumber(value, 0, 1, 1);
  localStorage.setItem("aiapi_top_p", String(topP.value));
}

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

async function exportChat(format) {
  const session = activeSession();
  if (!session || !session.messages.length) {
    error.value = "没有可导出的对话内容。";
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
    } else if (format === "md") {
      content = `# ${session.title}\n\n`;
      content += `**Created:** ${new Date(session.created_at).toLocaleString()}\n\n`;
      content += `---\n\n`;

      for (const msg of session.messages) {
        const role = msg.role === "user" ? "User" : "Assistant";
        const thinking = msg.role === "assistant" ? splitThinking(msg) : { reasoning: "", answer: msg.content };
        content += `## ${role}\n\n`;

        if (msg.role === "assistant" && thinking.reasoning) {
          content += `<details>\n<summary>Thinking Process</summary>\n\n${thinking.reasoning}\n\n</details>\n\n`;
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
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    error.value = "";
  } catch (cause) {
    error.value = `导出失败: ${cause.message}`;
  }
}

function stopGeneration() {
  if (abortController.value) {
    abortController.value.abort();
  }
}

function handleWindowKeydown(event) {
  if (event.key === "Escape" && showSettings.value) {
    showSettings.value = false;
  }
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

    // 只有设置了 max_tokens 才包含在请求中
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
        ? `${current.content}\n\n[已停止]`
        : "[已停止]";
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

function buildPayloadMessages(items) {
  return items
    .map((item) => ({
      role: item.role,
      content: item.role === "assistant" ? splitThinking(item).answer : item.content
    }))
    .filter((item) => item.content);
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

async function copyMessage(content) {
  if (!content) return;
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    error.value = "复制失败，请手动选择内容复制。";
  }
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

function readSavedSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_SESSIONS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSession).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeSession(item, index) {
  if (!item || typeof item !== "object") return null;
  const now = Date.now();
  const messages = Array.isArray(item.messages) ? cloneMessages(item.messages) : [];
  return {
    id: String(item.id || `chat_${now}_${index}`),
    title: String(item.title || titleFromMessages(messages)),
    messages,
    created_at: Number(item.created_at || now),
    updated_at: Number(item.updated_at || now)
  };
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
  return title.length > 24 ? `${title.slice(0, 24)}...` : title;
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

function isEventStream(response) {
  return (response.headers.get("content-type") || "").toLowerCase().includes("text/event-stream");
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

function createAssistantMessage() {
  return { role: "assistant", content: "", reasoning: "", pending: true, stats: emptyStats() };
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

function elapsedMs(startedAt) {
  return Math.max(1, Date.now() - startedAt);
}

function formatDuration(ms) {
  if (ms == null) return "--";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
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

function roleLabel(role) {
  return role === "user" ? "用户" : "助手";
}

function renderMessage(content) {
  return markdown.render(content || "");
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

function isAssistantThinking(message) {
  return message?.role === "assistant" && message?.pending === true;
}

function thinkingKey(index) {
  return `${currentSessionId.value}:${index}`;
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

onMounted(() => {
  loadSessions();
  loadModels();
  applyTheme();
  window.addEventListener("keydown", handleWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWindowKeydown);
});
</script>

<template>
  <main class="chat-layout" :class="{ 'chat-layout-embedded': embedded }">
    <aside class="session-panel" aria-label="会话列表">
      <div class="session-panel-header">
        <div>
          <p class="eyebrow">本地</p>
          <h2>会话</h2>
        </div>
        <button class="icon-button" type="button" @click="startNewSession" :disabled="sending" aria-label="新建会话">
          <Plus :size="18" />
        </button>
      </div>
      <nav class="session-list">
        <button
          v-for="session in sessions"
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === currentSessionId }"
          type="button"
          @click="switchSession(session.id)"
          :disabled="sending"
        >
          <MessageSquare :size="17" />
          <span>{{ session.title }}</span>
        </button>
      </nav>
    </aside>

    <section class="chat-shell">
      <header class="chat-header">
        <MessageSquare :size="24" />
        <div>
          <h1>AI 对话</h1>
        </div>
        <div class="chat-header-actions">
          <button class="theme-toggle" type="button" @click="toggleTheme" :aria-label="theme === 'light' ? '切换到深色模式' : '切换到浅色模式'">
            <Moon v-if="theme === 'light'" :size="18" />
            <Sun v-else :size="18" />
          </button>
          <button class="theme-toggle" type="button" @click="toggleSettings" aria-label="设置">
            <Sliders :size="18" />
          </button>
          <RouterLink class="debug-link" to="/m/channels" aria-label="管理">
            <Settings :size="18" />
          </RouterLink>
        </div>
      </header>

      <section ref="conversationRef" class="conversation" :class="{ 'is-empty': !messages.length }" aria-live="polite">
        <div v-if="!messages.length" class="chat-empty">
          <p class="eyebrow">EdgeOne AI API</p>
          <h2>有什么可以帮你？</h2>
        </div>
        <div v-for="(message, index) in messages" :key="index" class="message-row" :class="message.role">
          <div v-if="message.role === 'assistant'" class="assistant-avatar">S</div>
          <article class="message" :class="message.role">
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
                  <span>思考过程</span>
                </button>
                <div
                  v-if="isThinkingOpen(message, index)"
                  class="thinking-content"
                  v-html="renderMessage(splitThinking(message).reasoning)"
                ></div>
              </div>
              <div class="message-content" v-html="renderMessage(splitThinking(message).answer)"></div>
              <div class="message-meta" aria-label="消息信息">
                <div class="message-actions" aria-label="消息操作">
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
                <div
                  v-if="message.stats?.first_token_ms != null || message.stats?.total_ms != null"
                  class="message-stats"
                  aria-label="响应耗时"
                >
                  <span>首字 {{ formatDuration(message.stats.first_token_ms) }}</span>
                  <span>总用时 {{ formatDuration(message.stats.total_ms) }}</span>
                </div>
              </div>
            </template>
            <div v-else class="message-content" v-html="renderMessage(message.content)"></div>
          </article>
        </div>
        <p v-if="error" class="notice error">{{ error }}</p>
      </section>

      <form class="composer" @submit.prevent="sendMessage">
        <button class="composer-icon" type="button" @click="clearCurrentSession" :disabled="sending || !messages.length" aria-label="清空当前会话">
          <Trash2 :size="20" />
        </button>
        <div class="chat-model-control" aria-label="模型选择">
          <Sparkles :size="16" />
          <select v-if="availableModels.length" v-model="model">
            <option v-for="item in availableModels" :key="item" :value="item">{{ item }}</option>
          </select>
          <input v-else v-model="model" autocomplete="off" placeholder="gpt-4o-mini">
          <button class="secondary" type="button" @click="loadModels" :disabled="loadingModels" aria-label="获取模型">
            <RefreshCw :size="16" />
          </button>
        </div>
        <textarea v-model="draft" rows="1" placeholder="请输入您的问题..." @keydown.enter.exact.prevent="sendMessage"></textarea>
        <button class="send-button" type="submit" v-if="!sending" :disabled="!draft.trim()" aria-label="发送">
          <ArrowUp :size="22" />
        </button>
        <button class="send-button" type="button" v-else @click="stopGeneration" aria-label="停止生成">
          <Square :size="18" />
        </button>
      </form>
    </section>

    <div v-if="showSettings" class="modal-backdrop" @click.self="showSettings = false">
      <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="settings-header">
          <h3 id="settings-title">设置</h3>
          <button class="icon-button settings-close" type="button" @click="showSettings = false" aria-label="关闭">
            <X :size="16" />
          </button>
        </div>

        <div class="settings-row">
          <label>
            Temperature
            <small style="color: var(--muted); font-size: 12px;">{{ temperature }}</small>
          </label>
          <input type="range" min="0" max="2" step="0.1" :value="temperature" @input="updateTemperature($event.target.value)">
        </div>

        <div class="settings-row">
          <label>
            Max Tokens
            <small style="color: var(--muted); font-size: 12px;">{{ maxTokens || '不限制' }}</small>
          </label>
          <input type="number" min="1" max="32000" :value="maxTokens || ''" @input="updateMaxTokens($event.target.value)" placeholder="不限制">
        </div>

        <div class="settings-row">
          <label>
            Top P
            <small style="color: var(--muted); font-size: 12px;">{{ topP }}</small>
          </label>
          <input type="range" min="0" max="1" step="0.05" :value="topP" @input="updateTopP($event.target.value)">
        </div>

        <div class="settings-row settings-row-stacked">
          <label>
            <Download :size="16" />
            导出对话
          </label>
          <div class="export-buttons">
            <button type="button" class="secondary" @click="exportChat('md')">Markdown</button>
            <button type="button" class="secondary" @click="exportChat('json')">JSON</button>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
