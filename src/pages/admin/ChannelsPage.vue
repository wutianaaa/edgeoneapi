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
const fetchedModels = ref([]);
const selectedFetched = ref([]);
const loading = ref(false);
const saving = ref(false);
const fetching = ref(false);
const modalOpen = ref(false);
const notice = ref("");
const error = ref("");
const editingModelKey = ref("");
const form = reactive(emptyChannel());
const modelForm = reactive(emptyModel());

const currentChannelModels = computed(() => {
  if (!form.id) return [];
  return models.value.filter((model) => (model.channel_ids || []).includes(form.id));
});
const enabledChannels = computed(() => channels.value.filter((channel) => channel.enabled).length);
const disabledChannels = computed(() => channels.value.length - enabledChannels.value);
const totalModels = computed(() => models.value.length);
const selectedFetchedCount = computed(() => selectedFetched.value.length);
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

function emptyModel() {
  return {
    model: "",
    upstream_model: ""
  };
}

function channelTypeConfig(type) {
  return channelTypes.find((item) => item.value === type) || channelTypes[0];
}

function channelTypeLabel(type) {
  return channelTypeConfig(type).label;
}

function modelToken(item) {
  return `${item.channel_id}:${item.id}`;
}

function channelModelCount(channelId) {
  return models.value.filter((model) => (model.channel_ids || []).includes(channelId)).length;
}

function resetModelForm() {
  editingModelKey.value = "";
  Object.assign(modelForm, emptyModel());
}

function resetModalState() {
  resetModelForm();
  fetchedModels.value = [];
  selectedFetched.value = [];
}

function closeModal() {
  resetModalState();
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

async function importChannels() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!Array.isArray(data.channels)) {
        throw new Error("导入文件格式不正确。");
      }

      let imported = 0;
      for (const channel of data.channels) {
        try {
          await adminRequest("/api/admin/channels", {
            method: "POST",
            body: JSON.stringify({
              name: channel.name,
              type: channel.type || "openai",
              base_url: channel.base_url,
              api_key: channel.api_key || "",
              enabled: channel.enabled !== false,
              weight: channel.weight || 1
            })
          });
          imported += 1;
        } catch (cause) {
          if (import.meta.env.DEV) {
            console.error(`Failed to import channel ${channel.name}:`, cause);
          }
        }
      }

      if (Array.isArray(data.models)) {
        for (const model of data.models) {
          try {
            await adminRequest(`/api/admin/models/${encodeURIComponent(model.model)}`, {
              method: "PUT",
              body: JSON.stringify(model)
            });
          } catch (cause) {
            if (import.meta.env.DEV) {
              console.error(`Failed to import model ${model.model}:`, cause);
            }
          }
        }
      }

      notice.value = `成功导入 ${imported} 个渠道。`;
      await load();
    } catch (cause) {
      error.value = `导入失败: ${cause.message}`;
    }
  };
  input.click();
}

function openNew() {
  notice.value = "";
  error.value = "";
  Object.assign(form, emptyChannel());
  resetModalState();
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
  resetModalState();
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
      const body = await adminRequest(`/api/admin/channels/${encodeURIComponent(form.id)}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      Object.assign(form, { ...form, ...body.data, api_key: "" });
    } else {
      const body = await adminRequest("/api/admin/channels", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      Object.assign(form, { ...form, ...body.data, api_key: "" });
    }

    notice.value = "渠道已保存。";
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
    ? `确定删除渠道“${channel.name}”吗？该渠道当前关联 ${modelCount} 个模型映射。`
    : `确定删除渠道“${channel.name}”吗？`;
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

async function fetchModels() {
  if (!form.id) {
    error.value = "请先保存渠道，再获取模型。";
    return;
  }

  fetching.value = true;
  error.value = "";
  selectedFetched.value = [];
  try {
    const body = await fetchUpstreamModels([form.id]);
    fetchedModels.value = body.data || [];
    const failureCount = (body.failures || []).length;
    notice.value = failureCount
      ? `已获取 ${fetchedModels.value.length} 个模型，另有 ${failureCount} 个请求失败。`
      : `已获取 ${fetchedModels.value.length} 个模型。`;
  } catch (cause) {
    error.value = cause.message;
  } finally {
    fetching.value = false;
  }
}

async function putModel(key, payload) {
  await adminRequest(`/api/admin/models/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

async function saveSelectedModels(selected) {
  if (selected.length === 1) {
    const item = selected[0];
    const publicModel = modelForm.model.trim() || item.id;
    await putModel(editingModelKey.value || publicModel, {
      model: publicModel,
      upstream_model: modelForm.upstream_model.trim() || item.id,
      channel_ids: [form.id]
    });
    return;
  }

  for (const item of selected) {
    await putModel(item.id, {
      model: item.id,
      upstream_model: item.id,
      channel_ids: [form.id]
    });
  }
}

async function saveSingleModel() {
  const publicModel = modelForm.model.trim();
  if (!publicModel) {
    throw new Error("请选择模型或填写公开模型名称。");
  }

  await putModel(editingModelKey.value || publicModel, {
    model: publicModel,
    upstream_model: modelForm.upstream_model.trim() || publicModel,
    channel_ids: [form.id]
  });
}

async function saveModels() {
  if (!form.id) {
    error.value = "请先保存渠道，再配置模型。";
    return;
  }

  error.value = "";
  notice.value = "";

  try {
    const selected = fetchedModels.value.filter((item) => selectedFetched.value.includes(modelToken(item)));
    if (selected.length) {
      await saveSelectedModels(selected);
    } else {
      await saveSingleModel();
    }

    resetModelForm();
    selectedFetched.value = [];
    notice.value = "模型映射已保存。";
    await load();
  } catch (cause) {
    error.value = cause.message;
  }
}

function useFetchedModel(item) {
  modelForm.upstream_model = item.id;
  if (!modelForm.model) {
    modelForm.model = item.id;
  }
}

function editModel(model) {
  editingModelKey.value = model.model;
  modelForm.model = model.model;
  modelForm.upstream_model = model.upstream_model || model.model;
  selectedFetched.value = [];
}

async function removeModel(model) {
  if (!window.confirm(`确定删除模型映射“${model.model}”吗？`)) return;

  error.value = "";
  try {
    await adminRequest(`/api/admin/models/${encodeURIComponent(model.model)}`, { method: "DELETE" });
    notice.value = "模型映射已删除。";
    if (editingModelKey.value === model.model) {
      resetModelForm();
    }
    await load();
  } catch (cause) {
    error.value = cause.message;
  }
}

function selectAllFetched() {
  selectedFetched.value = fetchedModels.value.map(modelToken);
}

function clearFetchedSelection() {
  selectedFetched.value = [];
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
        <button class="secondary" type="button" @click="importChannels">
          <Upload :size="18" />
          导入
        </button>
        <button class="secondary" type="button" @click="load" :disabled="loading">
          <RefreshCw :size="18" />
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

    <section class="metric-grid" aria-label="渠道概览">
      <article class="metric-card">
        <span>全部渠道</span>
        <strong>{{ channels.length }}</strong>
      </article>
      <article class="metric-card">
        <span>启用中</span>
        <strong>{{ enabledChannels }}</strong>
      </article>
      <article class="metric-card">
        <span>停用</span>
        <strong>{{ disabledChannels }}</strong>
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
            <td class="actions">
              <button class="icon-button" type="button" @click="openEdit(channel)" aria-label="编辑渠道"><Pencil :size="17" /></button>
              <button class="icon-button danger" type="button" @click="removeChannel(channel)" aria-label="删除渠道"><Trash2 :size="17" /></button>
            </td>
          </tr>
          <tr v-if="!channels.length">
            <td class="empty-row" colspan="7">暂无渠道。创建渠道后即可配置公开模型映射。</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="modalOpen" class="modal-backdrop" role="presentation" @click.self="closeModal">
      <section class="modal channel-modal" role="dialog" aria-modal="true" aria-labelledby="channel-dialog-title">
        <header class="modal-header">
          <div>
            <p class="eyebrow">渠道</p>
            <h2 id="channel-dialog-title">{{ form.id ? "编辑渠道" : "新建渠道" }}</h2>
          </div>
          <div class="modal-header-meta">
            <span class="badge" :class="{ on: form.enabled, off: !form.enabled }">{{ form.enabled ? "启用" : "停用" }}</span>
            <span class="badge muted">{{ currentChannelModels.length }} 个模型</span>
          </div>
          <button class="icon-button" type="button" @click="closeModal" aria-label="关闭"><X :size="18" /></button>
        </header>

        <div class="modal-body channel-modal-body">
          <form class="panel plain-panel channel-config" @submit.prevent="saveChannel">
            <div class="panel-heading">
              <div>
                <h2>连接配置</h2>
                <p class="form-hint">保存渠道后，即可从该上游拉取模型并维护公开模型映射。</p>
              </div>
            </div>
            <label>名称 <input v-model="form.name" required :placeholder="selectedChannelType.namePlaceholder"></label>
            <label>
              类型
              <select :value="form.type" required @change="updateChannelType($event.target.value)">
                <option v-for="type in channelTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
              </select>
            </label>
            <label>基础 URL <input v-model="form.base_url" required :placeholder="selectedChannelType.baseUrl"></label>
            <label>API Key <input v-model="form.api_key" type="password" autocomplete="off" :placeholder="selectedChannelType.apiKeyPlaceholder"></label>
            <div class="form-row form-row-even">
              <label>权重 <input v-model="form.weight" type="number" min="0" step="1"></label>
              <label class="switch"><input v-model="form.enabled" type="checkbox"> 启用</label>
            </div>
            <div class="form-actions">
              <button type="submit" :disabled="saving">{{ saving ? "保存中" : "保存渠道" }}</button>
            </div>
          </form>

          <section class="panel plain-panel channel-model-workspace">
            <div class="panel-heading">
              <div>
                <h2>同步上游模型</h2>
                <p class="form-hint">从当前渠道读取模型列表，可批量保存为公开模型。</p>
              </div>
              <button class="secondary" type="button" @click="fetchModels" :disabled="fetching || !form.id">
                <Download :size="18" />
                {{ fetching ? "获取中" : "获取模型" }}
              </button>
            </div>

            <div class="inline-toolbar">
              <span class="badge muted">已选 {{ selectedFetchedCount }}</span>
              <button class="secondary compact-button" type="button" @click="selectAllFetched" :disabled="!fetchedModels.length">全选</button>
              <button class="secondary compact-button" type="button" @click="clearFetchedSelection" :disabled="!selectedFetchedCount">清空</button>
            </div>

            <section class="table-wrap compact-table model-pick-table">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>上游模型</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in fetchedModels" :key="modelToken(item)">
                    <td>
                      <input v-model="selectedFetched" type="checkbox" :value="modelToken(item)" :aria-label="`选择 ${item.id}`">
                    </td>
                    <td class="mono">{{ item.id }}</td>
                    <td class="actions">
                      <button class="icon-button" type="button" @click="useFetchedModel(item)" aria-label="使用模型"><Pencil :size="17" /></button>
                    </td>
                  </tr>
                  <tr v-if="!fetchedModels.length">
                    <td class="empty-row" colspan="3">{{ form.id ? "尚未获取上游模型。" : "请先保存渠道，再获取模型。" }}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <div class="section-heading">
              <div>
                <h2>{{ editingModelKey ? "编辑模型映射" : "添加模型映射" }}</h2>
                <p class="form-hint">公开模型是客户端请求的 `model`，会被重定向到对应的上游模型。</p>
              </div>
              <button v-if="editingModelKey" class="secondary compact-button" type="button" @click="resetModelForm">取消编辑</button>
            </div>

            <div class="form-row form-row-even">
              <label>公开模型 <input v-model="modelForm.model" placeholder="gpt-4o-mini"></label>
              <label>上游模型 <input v-model="modelForm.upstream_model" :placeholder="selectedChannelType.upstreamModelPlaceholder"></label>
            </div>
            <div class="form-actions">
              <button type="button" @click="saveModels" :disabled="!form.id || (!selectedFetchedCount && !modelForm.model.trim())">
                {{ editingModelKey ? "更新模型" : (selectedFetchedCount ? `保存 ${selectedFetchedCount} 个模型` : "保存模型") }}
              </button>
            </div>

            <div class="section-heading">
              <div>
                <h2>当前映射</h2>
                <p class="form-hint">这些模型会出现在 `/v1/models`，并可被用户 Key 进行访问控制。</p>
              </div>
              <span class="badge muted">{{ currentChannelModels.length }}</span>
            </div>

            <section class="table-wrap compact-table mapped-model-table">
              <table>
                <thead>
                  <tr>
                    <th>公开模型</th>
                    <th>上游模型</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="model in currentChannelModels" :key="model.model">
                    <td>{{ model.model }}</td>
                    <td>{{ model.upstream_model || model.model }}</td>
                    <td class="actions">
                      <button class="icon-button" type="button" @click="editModel(model)" aria-label="编辑模型"><Pencil :size="17" /></button>
                      <button class="icon-button danger" type="button" @click="removeModel(model)" aria-label="删除模型"><Trash2 :size="17" /></button>
                    </td>
                  </tr>
                  <tr v-if="!currentChannelModels.length">
                    <td class="empty-row" colspan="3">当前渠道还没有绑定公开模型。</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </section>
        </div>
      </section>
    </div>
  </section>
</template>
