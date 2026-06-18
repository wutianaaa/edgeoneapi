<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Activity, AlertCircle, CheckCircle, Clock, RefreshCw } from "@lucide/vue";
import { adminRequest } from "../../services/api.js";

const health = ref(null);
const loading = ref(false);
const error = ref("");
const autoRefresh = ref(true);
const refreshInterval = ref(null);

const channels = computed(() => (Array.isArray(health.value?.channels) ? health.value.channels : []));

async function loadHealth() {
  if (loading.value) return;

  loading.value = true;
  error.value = "";

  try {
    health.value = await adminRequest("/api/admin/health");
  } catch (cause) {
    error.value = cause.message;
  } finally {
    loading.value = false;
  }
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  if (autoRefresh.value) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

function startAutoRefresh() {
  if (refreshInterval.value) return;
  refreshInterval.value = setInterval(loadHealth, 10000);
}

function stopAutoRefresh() {
  if (!refreshInterval.value) return;
  clearInterval(refreshInterval.value);
  refreshInterval.value = null;
}

function getStateIcon(state) {
  if (state === "closed") return CheckCircle;
  if (state === "open") return AlertCircle;
  return Clock;
}

function getStateColor(state) {
  if (state === "closed") return "success";
  if (state === "open") return "error";
  return "warning";
}

function getStateLabel(state) {
  if (state === "closed") return "正常";
  if (state === "open") return "熔断";
  return "恢复中";
}

function formatDuration(ms) {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTimestamp(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function channelModels(channel) {
  return Array.isArray(channel?.models) ? channel.models : [];
}

onMounted(() => {
  loadHealth();
  if (autoRefresh.value) {
    startAutoRefresh();
  }
});

onUnmounted(() => {
  stopAutoRefresh();
});
</script>

<template>
  <section class="page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">监控</p>
        <h1>系统健康</h1>
        <p class="page-description">实时监控渠道熔断状态、成功率和延迟指标。</p>
      </div>
      <div class="toolbar">
        <button type="button" class="secondary" :class="{ active: autoRefresh }" @click="toggleAutoRefresh">
          <Activity :size="18" />
          {{ autoRefresh ? "自动刷新" : "手动刷新" }}
        </button>
        <button type="button" @click="loadHealth" :disabled="loading">
          <RefreshCw :size="18" :class="{ spinning: loading }" />
          刷新
        </button>
      </div>
    </header>

    <p v-if="error" class="notice error">{{ error }}</p>

    <div v-if="health">
      <section class="metric-grid" style="margin-bottom: 24px;">
        <article class="metric-card">
          <span>系统状态</span>
          <strong style="color: var(--color-success);">{{ health.status === "ok" ? "正常" : "异常" }}</strong>
        </article>
        <article class="metric-card">
          <span>渠道总数</span>
          <strong>{{ channels.length }}</strong>
        </article>
        <article class="metric-card">
          <span>最后更新</span>
          <strong style="font-size: 16px;">{{ formatTimestamp(health.timestamp) }}</strong>
        </article>
      </section>

      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div v-for="channel in channels" :key="channel.id" class="panel">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border-default);">
            <div>
              <h3 style="margin-bottom: 8px;">{{ channel.name }}</h3>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="badge" :class="channel.status === 'enabled' ? 'on' : 'off'">
                  {{ channel.status === "enabled" ? "启用" : "禁用" }}
                </span>
                <span class="badge muted">权重: {{ channel.weight }}</span>
              </div>
            </div>
          </div>

          <div v-if="channelModels(channel).length === 0" class="empty-row">
            <p>该渠道暂未配置模型。</p>
          </div>

          <div v-else class="table-wrap" style="box-shadow: none; border: none;">
            <table>
              <thead>
                <tr>
                  <th>模型</th>
                  <th>熔断状态</th>
                  <th>失败次数</th>
                  <th>最后失败</th>
                  <th>总请求</th>
                  <th>成功率</th>
                  <th>平均耗时</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="model in channelModels(channel)" :key="model.model">
                  <td class="mono">{{ model.model }}</td>
                  <td>
                    <span class="badge" :class="getStateColor(model.circuitBreaker.state)">
                      <component :is="getStateIcon(model.circuitBreaker.state)" :size="14" />
                      {{ getStateLabel(model.circuitBreaker.state) }}
                    </span>
                  </td>
                  <td>
                    <span v-if="model.circuitBreaker.failures > 0" style="color: var(--color-error); font-weight: 700;">{{ model.circuitBreaker.failures }}</span>
                    <span v-else>-</span>
                  </td>
                  <td style="color: var(--text-muted);">{{ formatTimestamp(model.circuitBreaker.lastFailure) }}</td>
                  <td>{{ model.performance.totalRequests }}</td>
                  <td>
                    <span
                      style="font-weight: 700;"
                      :style="{
                        color: model.performance.successRate >= 95 ? 'var(--color-success)' :
                               model.performance.successRate >= 90 ? 'var(--color-warning)' :
                               'var(--color-error)'
                      }"
                    >
                      {{ model.performance.successRate }}%
                    </span>
                  </td>
                  <td style="color: var(--text-muted);">{{ formatDuration(model.performance.avgDuration) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="loading" class="loading-state">
      <RefreshCw :size="32" class="spinning" />
      <p>加载健康数据...</p>
    </div>

    <div v-else class="empty-row">
      <p>暂无健康数据，请点击刷新重试。</p>
    </div>
  </section>
</template>
