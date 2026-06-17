<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Activity,
  KeyRound,
  LogOut,
  MessageSquare,
  Moon,
  RadioTower,
  ShieldCheck,
  Sun,
  UserRound,
  Users
} from "@lucide/vue";
import { getAdminSession, loginAdmin, logoutAdmin } from "../../services/api.js";

const ADMIN_USER_KEY = "aiapi_admin_user";
const THEME_KEY = "aiapi_theme";

const router = useRouter();
const route = useRoute();

const navItems = [
  {
    to: "/chat",
    label: "Chat",
    icon: MessageSquare,
    description: "面向开发者的对话工作台，专注提示词、模型切换和响应观察。"
  },
  {
    to: "/channels",
    label: "Channels",
    icon: RadioTower,
    description: "统一管理上游通道、权重分配和公开模型映射。",
    requiresAdmin: true
  },
  {
    to: "/users",
    label: "Users",
    icon: Users,
    description: "管理 API Key、默认访问策略和模型可见范围。",
    requiresAdmin: true
  },
  {
    to: "/health",
    label: "Health",
    icon: Activity,
    description: "监控熔断器、成功率和延迟，快速发现上游问题。",
    requiresAdmin: true
  }
];

const username = ref(localStorage.getItem(ADMIN_USER_KEY) || "admin");
const password = ref("");
const authenticated = ref(false);
const checkingAuth = ref(true);
const authError = ref("");
const theme = ref(localStorage.getItem(THEME_KEY) || "light");

const currentItem = computed(() => (
  navItems.find((item) => route.path === item.to || route.path.startsWith(`${item.to}/`)) || navItems[0]
));
const requiresAdmin = computed(() => Boolean(route.meta.requiresAdmin));

function applyTheme() {
  if (theme.value === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

function toggleTheme() {
  theme.value = theme.value === "light" ? "dark" : "light";
  localStorage.setItem(THEME_KEY, theme.value);
  applyTheme();
}

async function login() {
  const name = username.value.trim();
  const token = password.value.trim();

  if (!name || !token) {
    authError.value = "请输入用户名和管理 Token。";
    return;
  }

  try {
    await loginAdmin(token);
    localStorage.setItem(ADMIN_USER_KEY, name);
    password.value = "";
    authError.value = "";
    authenticated.value = true;
    router.replace(route.fullPath);
  } catch (cause) {
    authError.value = cause.message;
  }
}

async function logout() {
  await logoutAdmin().catch(() => {});
  password.value = "";
  authError.value = "";
  authenticated.value = false;
  if (requiresAdmin.value) {
    router.replace("/chat");
  }
}

async function restoreSession() {
  try {
    await getAdminSession();
    authenticated.value = true;
  } catch {
    authenticated.value = false;
  } finally {
    checkingAuth.value = false;
  }
}

function openAdminSurface() {
  router.push("/channels");
}

function handleWindowKeydown(event) {
  if (event.key === "Escape" && !authenticated.value) {
    password.value = "";
    authError.value = "";
  }
}

onMounted(() => {
  applyTheme();
  restoreSession();
  window.addEventListener("keydown", handleWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWindowKeydown);
});
</script>

<template>
  <main class="workbench-shell">
    <header class="workbench-header">
      <div class="workbench-header-inner">
        <RouterLink class="workbench-brand" to="/chat">
          <span class="workbench-brand-mark" aria-hidden="true"></span>
          <span class="workbench-brand-copy">
            <strong>EdgeOne AI</strong>
            <small>Developer Gateway</small>
          </span>
        </RouterLink>

        <nav class="workbench-nav" aria-label="Primary navigation">
          <RouterLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="workbench-nav-item"
          >
            <component :is="item.icon" :size="16" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </nav>

        <div class="workbench-actions">
          <span class="workbench-pill">Blue Console</span>
          <button
            class="theme-toggle"
            type="button"
            @click="toggleTheme"
            :aria-label="theme === 'light' ? '切换到深色模式' : '切换到浅色模式'"
          >
            <Moon v-if="theme === 'light'" :size="18" />
            <Sun v-else :size="18" />
          </button>
          <button v-if="!authenticated" class="secondary compact-button" type="button" @click="openAdminSurface">
            <KeyRound :size="16" />
            Admin
          </button>
          <template v-else>
            <div class="admin-account">
              <UserRound :size="16" />
              <span>{{ username }}</span>
            </div>
            <button class="secondary compact-button" type="button" @click="logout">
              <LogOut :size="16" />
              退出
            </button>
          </template>
        </div>
      </div>
    </header>

    <section class="workbench-main">
      <div class="workbench-main-inner">
        <aside class="workbench-sidebar">
          <section class="workbench-side-card workbench-side-hero">
            <p class="eyebrow">Unified Workbench</p>
            <h2>{{ currentItem.label }}</h2>
            <p>{{ currentItem.description }}</p>
          </section>

          <section class="workbench-side-card">
            <p class="eyebrow">Why This Structure</p>
            <ul class="context-list">
              <li>聊天和管理现在共用同一套入口与导航层级。</li>
              <li>布局首先服务开发者：先看状态、路由和配置，再进入操作。</li>
              <li>整套界面统一为蓝色系、低噪音、高对比的极简工作台。</li>
            </ul>
          </section>

          <section class="workbench-side-card">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">Access</p>
                <h3>Console State</h3>
              </div>
              <span class="badge" :class="authenticated ? 'on' : 'muted'">
                {{ authenticated ? "Unlocked" : "Protected" }}
              </span>
            </div>
            <div class="context-metric">
              <span>Current surface</span>
              <strong>{{ currentItem.label }}</strong>
            </div>
            <div class="context-metric">
              <span>Admin scope</span>
              <strong>{{ authenticated ? "Enabled" : "Sign-in required" }}</strong>
            </div>
            <div class="context-metric">
              <span>Theme</span>
              <strong>{{ theme === "dark" ? "Dark" : "Light" }}</strong>
            </div>
          </section>
        </aside>

        <section class="workbench-stage">
          <div v-if="requiresAdmin && checkingAuth" class="loading-state">
            <ShieldCheck :size="32" class="spinning" />
            <p>正在校验管理会话...</p>
          </div>

          <div v-else-if="requiresAdmin && !authenticated" class="auth-gate">
            <section class="auth-panel">
              <div class="auth-panel-copy">
                <p class="eyebrow">Protected Surface</p>
                <h1>{{ currentItem.label }}</h1>
                <p class="page-description">
                  管理页面需要管理员 Token。登录后会保留当前路由，你可以在聊天和管理之间连续切换，不再丢失上下文。
                </p>
              </div>

              <form class="panel plain-panel auth-form" @submit.prevent="login">
                <label>
                  用户名
                  <input v-model="username" autocomplete="username" required placeholder="admin">
                </label>
                <label>
                  管理 Token
                  <input
                    v-model="password"
                    type="password"
                    autocomplete="current-password"
                    required
                    placeholder="ADMIN_TOKEN"
                  >
                </label>
                <p v-if="authError" class="notice error">{{ authError }}</p>
                <button type="submit">进入 {{ currentItem.label }}</button>
              </form>
            </section>
          </div>

          <RouterView v-else />
        </section>
      </div>
    </section>
  </main>
</template>
