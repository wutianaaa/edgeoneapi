<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { Download, Pencil, Plus, RefreshCw, Trash2, X } from "@lucide/vue";
import { adminRequest, fetchUpstreamModelsForChannel, syncChannelModels as syncChannelModelsApi } from "../../services/api.js";

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
const upstreamModels = ref([]);
const syncingModels = ref(false);
const form = reactive(emptyChannel());
const modelMappings = ref([]);

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
    weight: 1,
    model_ids: []
  };
}

function emptyModelMapping() {
  return {
    publicModel: "",
    upstreamModel: ""
  };
}

function channelTypeConfig(type) {
  return channelTypes.find((item) => item.value === type) || channelTypes[0];
}

function channelTypeLabel(type) {
  return channelTypeConfig(type).label;
}

function channelModelCount(channelId) {
  return channelModels(channelId).length;
}

function channelModels(channelId) {
  return models.value.filter((model) => {
    return modelAppliesToChannel(model, channelId);
  });
}

function modelLabel(model) {
  return model.model || model.upstream_model || "unknown";
}

function modelChannelIds(model) {
  return Array.isArray(model.channel_ids) ? model.channel_ids.map(String).filter(Boolean) : [];
}

function modelAppliesToChannel(model, channelId) {
  const channelIds = modelChannelIds(model);
  return channelIds.length === 0 || channelIds.includes(channelId);
}

function selectedModelIdsForChannel(channelId) {
  if (!channelId) {
    return models.value
      .filter((model) => modelChannelIds(model).length === 0)
      .map((model) => model.model)
      .filter(Boolean);
  }
  return channelModels(channelId).map((model) => model.model).filter(Boolean);
}

const selectableModels = computed(() => {
  const upstreamIds = upstreamModels.value
    .map((item) => String(item?.id || "").trim())
    .filter(Boolean);
  if (upstreamIds.length) {
    return [...new Set(upstreamIds)].sort((left, right) => left.localeCompare(right));
  }
  return models.value
    .map((model) => model.model)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
});

async function syncChannelModels(channelId) {
  const body = await syncChannelModelsRequest(channelId);
  models.value = body.data || [];
}

async function syncChannelModelsRequest(channelId) {
  if (!channelId) {
    throw new Error("Channel id is required before saving model mappings.");
  }

  // 从模型映射表格构建 model_mappings 数组
  const modelMappingsPayload = modelMappings.value
    .filter((m) => m.publicModel && m.upstreamModel)
    .map((m) => ({
      model: m.publicModel,
      upstream_model: m.upstreamModel
    }));

  return syncChannelModelsApi({
    channel_id: channelId,
    model_mappings: modelMappingsPayload
  });
}

function channelPayload() {
  return {
    name: form.name,
    type: form.type,
    base_url: form.base_url,
    api_key: form.api_key,
    enabled: form.enabled,
    weight: Number(form.weight || 0)
  };
}

function closeModal() {
  modalOpen.value = false;
  upstreamModels.value = [];
  syncingModels.value = false;
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
  form.model_ids = selectedModelIdsForChannel("");
  upstreamModels.value = [];
  modelMappings.value = [];
  modalOpen.value = true;
}

function addModelMapping() {
  modelMappings.value.push(emptyModelMapping());
}

function removeModelMapping(index) {
  modelMappings.value.splice(index, 1);
}

function initModelMappingsFromChannel(channel) {
  const channelModelsList = channelModels(channel.id);
  if (channelModelsList.length > 0) {
    modelMappings.value = channelModelsList.map((model) => ({
      publicModel: model.model || "",
      upstreamModel: model.upstream_model || model.model || ""
    }));
  } else {
    modelMappings.value = [];
  }
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
    weight: channel.weight || 0,
    model_ids: selectedModelIdsForChannel(channel.id)
  });
  upstreamModels.value = channelModels(channel.id).map((model) => ({ id: model.model }));
  initModelMappingsFromChannel(channel);
  modalOpen.value = true;

  try {
    const body = await adminRequest(`/api/admin/channels/${encodeURIComponent(channel.id)}`);
    Object.assign(form, {
      ...form,
      ...body.data,
      api_key: body.data.api_key || "",
      model_ids: selectedModelIdsForChannel(channel.id)
    });
    await refreshUpstreamModels();
  } catch (cause) {
    error.value = cause.message;
  }
}

function updateChannelType(type) {
  form.type = type;
  if (!form.id) {
    form.base_url = channelTypeConfig(type).baseUrl;
  }
  upstreamModels.value = [];
}

async function refreshUpstreamModels() {
  const previewChannel = {
    id: form.id,
    name: form.name,
    type: form.type,
    base_url: form.base_url,
    api_key: form.api_key,
    enabled: form.enabled,
    weight: Number(form.weight || 0)
  };

  if (!previewChannel.type || !previewChannel.base_url || !previewChannel.api_key) {
    upstreamModels.value = [];
    return;
  }

  syncingModels.value = true;
  try {
    const body = await fetchUpstreamModelsForChannel(previewChannel);
    upstreamModels.value = Array.isArray(body.data) ? body.data : [];
    const available = new Set(upstreamModels.value.map((item) => String(item?.id || "").trim()).filter(Boolean));
    if (available.size) {
      form.model_ids = (form.model_ids || []).filter((modelId) => available.has(modelId));
    }
  } finally {
    syncingModels.value = false;
  }
}

async function saveChannel() {
  saving.value = true;
  notice.value = "";
  error.value = "";
  const payload = channelPayload();

  try {
    let channelId = form.id;
    if (form.id) {
      const body = await adminRequest(`/api/admin/channels/${encodeURIComponent(form.id)}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      channelId = body.data?.id || channelId;
    } else {
      const body = await adminRequest("/api/admin/channels", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      channelId = body.data?.id || channelId;
    }

    await refreshUpstreamModels();
    await syncChannelModels(channelId);
    notice.value = "渠道和模型映射已保存。";
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
            <th>模型映射</th>
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
            <td class="channel-mapping-cell">
              <div v-if="channelModelCount(channel.id)" class="mapping-list">
                <div
                  v-for="model in channelModels(channel.id)"
                  :key="model.model"
                  class="mapping-item"
                >
                  <span class="mapping-public">{{ model.model }}</span>
                  <span class="mapping-arrow">→</span>
                  <span class="mapping-upstream">{{ model.upstream_model || model.model }}</span>
                </div>
                <div class="mapping-count">
                  <span class="badge muted">共 {{ channelModelCount(channel.id) }} 个映射</span>
                </div>
              </div>
              <span v-else class="badge muted">暂无映射</span>
            </td>
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

            <fieldset class="model-mapper">
              <legend>模型映射</legend>
              <p class="mapper-description">配置公开模型名称及其对应的上游实际模型，例如将 <code>gpt-4</code> 映射到 <code>gpt-4o</code>。</p>

              <div class="mapper-actions">
                <button class="secondary" type="button" @click="refreshUpstreamModels" :disabled="syncingModels">
                  <RefreshCw :size="16" :class="{ spinning: syncingModels }" />
                  {{ syncingModels ? "同步中" : "从上游获取可用模型" }}
                </button>
                <button class="secondary" type="button" @click="addModelMapping">
                  <Plus :size="16" />
                  添加映射
                </button>
              </div>

              <div v-if="modelMappings.length > 0" class="mapping-table">
                <div class="mapping-header">
                  <div class="mapping-col">公开模型名称</div>
                  <div class="mapping-col">上游实际模型</div>
                  <div class="mapping-col-action"></div>
                </div>
                <div v-for="(mapping, index) in modelMappings" :key="index" class="mapping-row">
                  <div class="mapping-col">
                    <input
                      v-model="mapping.publicModel"
                      placeholder="例如: gpt-4"
                      required
                      class="mapping-input"
                    >
                  </div>
                  <div class="mapping-col">
                    <select
                      v-model="mapping.upstreamModel"
                      required
                      class="mapping-select"
                    >
                      <option value="">选择上游模型</option>
                      <option v-for="model in upstreamModels" :key="model.id" :value="model.id">
                        {{ model.id }}
                      </option>
                    </select>
                  </div>
                  <div class="mapping-col-action">
                    <button
                      class="icon-button"
                      type="button"
                      @click="removeModelMapping(index)"
                      title="删除映射"
                    >
                      <Trash2 :size="16" />
                    </button>
                  </div>
                </div>
              </div>

              <p v-if="!upstreamModels.length" class="mapper-hint">
                请先填写有效渠道配置并点击「从上游获取可用模型」按钮。
              </p>
            </fieldset>

            <label style="flex-direction: row; align-items: center;"><input v-model="form.enabled" type="checkbox" style="width: auto; min-height: auto;"> 启用</label>
            <button type="submit" :disabled="saving">{{ saving ? "保存中" : "保存渠道" }}</button>
          </form>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
/* Channel Mapping Cell */
.channel-mapping-cell {
  min-width: 360px;
  max-width: 500px;
}

.mapping-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mapping-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  line-height: 1.4;
}

.mapping-public {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text-primary);
}

.mapping-arrow {
  color: var(--text-muted);
  font-weight: 700;
}

.mapping-upstream {
  font-family: var(--font-mono);
  color: var(--text-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mapping-count {
  margin-top: var(--space-1);
}

.channel-model-cell {
  min-width: 260px;
  max-width: 420px;
}

.channel-model-summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.model-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-chip {
  display: inline-flex;
  align-items: center;
  max-width: 220px;
  min-height: 26px;
  padding: 4px 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-surface-subtle);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

/* Model Mapper Styles */
.model-mapper {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  background: var(--bg-surface-elevated);
}

.model-mapper legend {
  padding: 0 var(--space-2);
  color: var(--text-primary);
  font-size: var(--font-size-base);
  font-weight: 600;
}

.mapper-description {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  margin: 0;
}

.mapper-description code {
  padding: 2px 6px;
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.mapper-actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.mapper-hint {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  margin: 0;
  padding: var(--space-3);
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--brand-primary);
}

.mapping-table {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mapping-header,
.mapping-row {
  display: grid;
  grid-template-columns: 1fr 1fr 48px;
  gap: var(--space-3);
  align-items: center;
}

.mapping-header {
  padding: var(--space-2) var(--space-3);
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
}

.mapping-row {
  padding: var(--space-2);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  transition: all var(--transition-base);
}

.mapping-row:hover {
  border-color: var(--brand-primary);
  box-shadow: var(--shadow-sm);
}

.mapping-col {
  display: flex;
  align-items: center;
}

.mapping-col-action {
  display: flex;
  justify-content: center;
}

.mapping-input,
.mapping-select {
  width: 100%;
  min-height: 40px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-app);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  font-family: var(--font-mono);
  transition: all var(--transition-base);
}

.mapping-input:focus,
.mapping-select:focus {
  outline: none;
  border-color: var(--brand-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.model-picker {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-picker legend {
  padding: 0 8px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
}

.model-picker p {
  color: var(--text-muted);
  font-size: 13px;
  margin: 0;
}

.model-option {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
}

.model-option input {
  width: auto;
  min-height: auto;
}
</style>
