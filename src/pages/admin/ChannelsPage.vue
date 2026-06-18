<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { Download, Pencil, Plus, RefreshCw, Trash2, Upload, X } from "@lucide/vue";
import { adminRequest, fetchUpstreamModels } from "../../services/api.js";

const channelTypes = [
  {
    value: "openai",
    label: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKeyPlaceholder: "sk-...",
    namePlaceholder: "openai-primary",
    upstreamModelPlaceholder: "gpt-4o-mini"
  },
  {
    value: "anthropic",
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyPlaceholder: "sk-ant-...",
    namePlaceholder: "claude-primary",
    upstreamModelPlaceholder: "claude-3-5-sonnet-latest"
  },
  {
    value: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyPlaceholder: "AIza...",
    namePlaceholder: "gemini-primary",
    upstreamModelPlaceholder: "gemini-1.5-pro"
  }
];

const channels = ref([]);
const models = ref([]);
const loading = ref(false);
const saving = ref(false);
const modalOpen = ref(false);
const notice = ref("");
const error = ref("");
const form = reactive(emptyChannel());

const enabledChannels = computed(() => channels.value.filter((channel) => channel.enabled).length);
const totalModels = computed(() => models.value.length);
const selectedChannelType = computed(() => channelTypeConfig(form.type));

function emptyChannel() {
  const type = channelTypes[0];
  return {
    id: "",
    name: "",
    type: type.value,
    base_url: type.baseUrl,
    api_key: "",
    enabled: true,
    weight: 1
  };
}

function channelTypeConfig(type) {
  return channelTypes.find((item) => item.value === type) || channelTypes[0];
}

function channelTypeLabel(type) {
  return channelTypeConfig(type).label;
}

function channelModelCount(channelId) {
  return models.value.filter((model) => (model.channel_ids || []).includes(channelId)).length;
}

function closeModal() {
  modalOpen.value = false;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [channelBody, modelBody] = await Promise.all([
      adminRequest("/api/admin/channels"),
      adminRequest("/api/admin/models")
    ]);
    channels.value = channelBody.data || [];
    models.value = modelBody.data || [];
  } catch (cause) {
    error.value = cause.message;
  } finally {
    loading.value = false;
  }
}

async function exportChannels() {
  try {
    const exportData = {
      version: "1.0",
      exported_at: new Date().toISOString(),
      channels: channels.value.map((channel) => ({
        name: channel.name,
        type: channel.type,
        base_url: channel.base_url,
        enabled: channel.enabled,
        weight: channel.weight
      })),
      models: models.value
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `channels-export-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notice.value = "渠道配置已导出。";
  } catch (cause) {
    error.value = `导出失败: ${cause.message}`;
  }
}

function openNew() {
  notice.value = "";
  error.value = "";
  Object.assign(form, emptyChannel());
  modalOpen.value = true;
}

async function openEdit(channel) {
  notice.value = "";
  error.value = "";
  Object.assign(form, {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    base_url: channel.base_url,
    api_key: "",
    enabled: Boolean(channel.enabled),
    weight: channel.weight || 0
  });
  modalOpen.value = true;

  try {
    const body = await adminRequest(`/api/admin/channels/${encodeURIComponent(channel.id)}`);
    Object.assign(form, {
      ...form,
      ...body.data,
      api_key: body.data.api_key || ""
    });
  } catch (cause) {
    error.value = cause.message;
  }
}

function updateChannelType(type) {
  form.type = type;
  if (!form.id) {
    form.base_url = channelTypeConfig(type).baseUrl;
  }
}

async function saveChannel() {
  saving.value = true;
  notice.value = "";
  error.value = "";
  const payload = { ...form, weight: Number(form.weight || 0) };

  try {
    if (form.id) {
      await adminRequest(`/api/admin/channels/${encodeURIComponent(form.id)}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
    } else {
      await adminRequest("/api/admin/channels", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    }

    notice.value = "渠道已保存。";
    closeModal();
    await load();
  } catch (cause) {
    error.value = cause.message;
  } finally {
    saving.value = false;
  }
}

async function removeChannel(channel) {
  const modelCount = channelModelCount(channel.id);
  const message = modelCount
    ? `确定删除渠道"${channel.name}"吗？该渠道当前关联 ${modelCount} 个模型映射。`
    : `确定删除渠道"${channel.name}"吗？`;
  if (!window.confirm(message)) return;

  error.value = "";
  try {
    await adminRequest(`/api/admin/channels/${encodeURIComponent(channel.id)}`, { method: "DELETE" });
    notice.value = "渠道已删除。";
    if (form.id === channel.id) {
      closeModal();
    }
    await load();
  } catch (cause) {
    error.value = cause.message;
  }
}

function handleWindowKeydown(event) {
  if (event.key === "Escape" && modalOpen.value) {
    closeModal();
  }
}

onMounted(() => {
  load();
  window.addEventListener("keydown", handleWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWindowKeydown);
});
</script>

<template>
  <section class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">管理</p>
        <h1>渠道管理</h1>
        <p class="page-description">统一管理上游供应商、公开模型映射、状态开关和请求权重。</p>
      </div>
      <div class="toolbar">
        <button class="secondary" type="button" @click="exportChannels">
          <Download :size="18" />
          导出
        </button>
        <button class="secondary" type="button" @click="load" :disabled="loading">
          <RefreshCw :size="18" :class="{ spinning: loading }" />
          刷新
        </button>
        <button type="button" @click="openNew">
          <Plus :size="18" />
          新建渠道
        </button>
      </div>
    </header>

    <div v-if="notice" class="notice">{{ notice }}</div>
    <div v-if="error" class="notice error">{{ error }}</div>

    <section class="metric-grid">
      <article class="metric-card">
        <span>全部渠道</span>
        <strong>{{ channels.length }}</strong>
      </article>
      <article class="metric-card">
        <span>启用中</span>
        <strong>{{ enabledChannels }}</strong>
      </article>
      <article class="metric-card">
        <span>公开模型</span>
        <strong>{{ totalModels }}</strong>
      </article>
    </section>

    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>基础 URL</th>
            <th>状态</th>
            <th>权重</th>
            <th>模型数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="channel in channels" :key="channel.id">
            <td>{{ channel.name }}</td>
            <td>{{ channelTypeLabel(channel.type) }}</td>
            <td class="mono">{{ channel.base_url }}</td>
            <td><span class="badge" :class="{ on: channel.enabled, off: !channel.enabled }">{{ channel.enabled ? "启用" : "停用" }}</span></td>
            <td>{{ channel.weight }}</td>
            <td>{{ channelModelCount(channel.id) }}</td>
            <td style="width: 1%; white-space: nowrap;">
              <button class="icon-button" type="button" @click="openEdit(channel)" aria-label="编辑渠道"><Pencil :size="17" /></button>
              <button class="icon-button" type="button" @click="removeChannel(channel)" aria-label="删除渠道" style="color: var(--color-error);"><Trash2 :size="17" /></button>
            </td>
          </tr>
          <tr v-if="!channels.length">
            <td class="empty-row" colspan="7">暂无渠道。创建渠道后即可配置公开模型映射。</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="modalOpen" class="modal-backdrop" role="presentation" @click.self="closeModal">
      <section class="modal" role="dialog" aria-modal="true">
        <header class="modal-header">
          <div>
            <p class="eyebrow">渠道</p>
            <h2>{{ form.id ? "编辑渠道" : "新建渠道" }}</h2>
          </div>
          <button class="icon-button" type="button" @click="closeModal" aria-label="关闭"><X :size="18" /></button>
        </header>

        <div class="modal-body">
          <form @submit.prevent="saveChannel" style="display: flex; flex-direction: column; gap: 16px;">
            <label>名称 <input v-model="form.name" required :placeholder="selectedChannelType.namePlaceholder"></label>
            <label>
              类型
              <select :value="form.type" required @change="updateChannelType($event.target.value)">
                <option v-for="type in channelTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
              </select>
            </label>
            <label>基础 URL <input v-model="form.base_url" required :placeholder="selectedChannelType.baseUrl"></label>
            <label>API Key <input v-model="form.api_key" type="password" autocomplete="off" :placeholder="selectedChannelType.apiKeyPlaceholder"></label>
            <label>权重 <input v-model="form.weight" type="number" min="0" step="1"></label>
            <label style="flex-direction: row; align-items: center;"><input v-model="form.enabled" type="checkbox" style="width: auto; min-height: auto;"> 启用</label>
            <button type="submit" :disabled="saving">{{ saving ? "保存中" : "保存渠道" }}</button>
          </form>
        </div>
      </section>
    </div>
  </section>
</template>
