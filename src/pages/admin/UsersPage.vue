<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { Copy, Download, KeyRound, Pencil, Plus, RefreshCw, Trash2, X } from "@lucide/vue";
import { adminRequest } from "../../services/api.js";

const users = ref([]);
const models = ref([]);
const loading = ref(false);
const saving = ref(false);
const modalOpen = ref(false);
const notice = ref("");
const error = ref("");
const form = reactive(emptyForm());

const enabledUsers = computed(() => users.value.filter((user) => user.enabled).length);
const totalUsers = computed(() => users.value.length);

function emptyForm() {
  return {
    id: "",
    name: "",
    api_key: "",
    allowed_models: [],
    is_default: false,
    enabled: true
  };
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [userBody, modelBody] = await Promise.all([
      adminRequest("/api/admin/users"),
      adminRequest("/api/admin/models")
    ]);
    users.value = userBody.data || [];
    models.value = modelBody.data || [];
  } catch (cause) {
    error.value = cause.message;
  } finally {
    loading.value = false;
  }
}

async function exportUsers() {
  try {
    const exportData = {
      version: "1.0",
      exported_at: new Date().toISOString(),
      users: users.value.map((user) => ({
        name: user.name,
        allowed_models: user.allowed_models,
        is_default: user.is_default,
        enabled: user.enabled
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `users-export-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notice.value = "用户列表已导出。";
  } catch (cause) {
    error.value = `导出失败: ${cause.message}`;
  }
}

function openNew() {
  notice.value = "";
  error.value = "";
  Object.assign(form, emptyForm());
  modalOpen.value = true;
}

function openEdit(user) {
  notice.value = "";
  error.value = "";
  Object.assign(form, {
    id: user.id,
    name: user.name,
    api_key: user.api_key || "",
    allowed_models: Array.isArray(user.allowed_models) ? [...user.allowed_models] : [],
    is_default: Boolean(user.is_default),
    enabled: Boolean(user.enabled)
  });
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

async function save() {
  saving.value = true;
  notice.value = "";
  error.value = "";
  try {
    if (form.id) {
      await adminRequest(`/api/admin/users/${encodeURIComponent(form.id)}`, {
        method: "PUT",
        body: JSON.stringify(form)
      });
    } else {
      await adminRequest("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(form)
      });
    }

    closeModal();
    notice.value = "用户已保存。";
    await load();
  } catch (cause) {
    error.value = cause.message;
  } finally {
    saving.value = false;
  }
}

async function remove(user) {
  if (!window.confirm(`确定删除用户"${user.name}"吗？`)) return;

  error.value = "";
  try {
    await adminRequest(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
    notice.value = "用户已删除。";
    if (form.id === user.id) {
      closeModal();
    }
    await load();
  } catch (cause) {
    error.value = cause.message;
  }
}

async function copyApiKey(user) {
  if (!user.api_key) {
    notice.value = "当前列表不展示历史 API Key。";
    return;
  }

  try {
    await navigator.clipboard.writeText(user.api_key);
    notice.value = "API Key 已复制。";
  } catch {
    error.value = "复制失败，请手动选中复制。";
  }
}

function createApiKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `sk-aiapi-${token}`;
}

function generateApiKey() {
  form.api_key = createApiKey();
}

function modelAccessLabel(user) {
  const count = Array.isArray(user.allowed_models) ? user.allowed_models.length : 0;
  return count ? `${count} 个模型` : "全部模型";
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
        <h1>用户密钥</h1>
        <p class="page-description">管理调用方 API Key、模型访问权限、默认账号和启用状态。</p>
      </div>
      <div class="toolbar">
        <button class="secondary" type="button" @click="exportUsers">
          <Download :size="18" />
          导出
        </button>
        <button class="secondary" type="button" @click="load" :disabled="loading">
          <RefreshCw :size="18" :class="{ spinning: loading }" />
          刷新
        </button>
        <button type="button" @click="openNew">
          <Plus :size="18" />
          新建用户
        </button>
      </div>
    </header>

    <div v-if="notice" class="notice">{{ notice }}</div>
    <div v-if="error" class="notice error">{{ error }}</div>

    <section class="metric-grid">
      <article class="metric-card">
        <span>全部用户</span>
        <strong>{{ totalUsers }}</strong>
      </article>
      <article class="metric-card">
        <span>启用中</span>
        <strong>{{ enabledUsers }}</strong>
      </article>
    </section>

    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>API Key</th>
            <th>可用模型</th>
            <th>默认</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>{{ user.name }}</td>
            <td class="mono" style="display: flex; align-items: center; gap: 8px;">
              <span>{{ user.api_key || "已隐藏历史 Key" }}</span>
              <button class="icon-button" type="button" @click="copyApiKey(user)" :disabled="!user.api_key" aria-label="复制 API Key">
                <Copy :size="17" />
              </button>
            </td>
            <td><span class="badge muted">{{ modelAccessLabel(user) }}</span></td>
            <td>
              <span v-if="user.is_default" class="badge on">默认</span>
              <span v-else class="badge muted">普通</span>
            </td>
            <td><span class="badge" :class="{ on: user.enabled, off: !user.enabled }">{{ user.enabled ? "启用" : "停用" }}</span></td>
            <td style="width: 1%; white-space: nowrap;">
              <button class="icon-button" type="button" @click="openEdit(user)" aria-label="编辑用户"><Pencil :size="17" /></button>
              <button class="icon-button" type="button" @click="remove(user)" aria-label="删除用户" style="color: var(--color-error);"><Trash2 :size="17" /></button>
            </td>
          </tr>
          <tr v-if="!users.length">
            <td class="empty-row" colspan="6">暂无用户。创建用户后即可用于客户端调用。</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="modalOpen" class="modal-backdrop" role="presentation" @click.self="closeModal">
      <section class="modal" role="dialog" aria-modal="true">
        <header class="modal-header">
          <div>
            <p class="eyebrow">用户</p>
            <h2>{{ form.id ? "编辑用户" : "新建用户" }}</h2>
          </div>
          <button class="icon-button" type="button" @click="closeModal" aria-label="关闭"><X :size="18" /></button>
        </header>

        <div class="modal-body">
          <form @submit.prevent="save" style="display: flex; flex-direction: column; gap: 16px;">
            <label>名称 <input v-model="form.name" required placeholder="default-user"></label>
            <div style="display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end;">
              <label>
                API Key
                <input v-model="form.api_key" autocomplete="off" :required="!form.id" placeholder="sk-aiapi-...">
              </label>
              <button class="icon-button" type="button" @click="generateApiKey" aria-label="生成 API Key">
                <KeyRound :size="17" />
              </button>
            </div>
            <fieldset style="border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 16px; display: flex; flex-direction: column; gap: 12px;">
              <legend style="color: var(--text-secondary); font-size: 14px; font-weight: 600; padding: 0 8px;">可用模型</legend>
              <p style="color: var(--text-muted); font-size: 13px; margin: 0;">不勾选表示允许访问全部公开模型。</p>
              <label v-for="model in models" :key="model.model" style="flex-direction: row; align-items: center; gap: 8px;">
                <input v-model="form.allowed_models" type="checkbox" :value="model.model" style="width: auto; min-height: auto;">
                <span>{{ model.model }}</span>
              </label>
              <p v-if="!models.length" style="color: var(--text-muted); font-size: 13px; margin: 0;">暂无公开模型，请先在渠道页面配置模型映射。</p>
            </fieldset>
            <label style="flex-direction: row; align-items: center;"><input v-model="form.is_default" type="checkbox" style="width: auto; min-height: auto;"> 设为默认 API</label>
            <label style="flex-direction: row; align-items: center;"><input v-model="form.enabled" type="checkbox" style="width: auto; min-height: auto;"> 启用</label>
            <button type="submit" :disabled="saving">{{ saving ? "保存中" : (form.id ? "更新用户" : "创建用户") }}</button>
          </form>
        </div>
      </section>
    </div>
  </section>
</template>
