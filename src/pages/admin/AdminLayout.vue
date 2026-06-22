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
  Sun,
  Users
} from "@lucide/vue";
import { getAdminSession, loginAdmin, logoutAdmin } from "../../services/api.js";

const ADMIN_USER_KEY = "aiapi_admin_user";
const THEME_KEY = "aiapi_theme";

const router = useRouter();
const route = useRoute();

const navItems = [
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/channels", label: "Channels", icon: RadioTower, requiresAdmin: true },
  { to: "/users", label: "Users", icon: Users, requiresAdmin: true },
  { to: "/health", label: "Health", icon: Activity, requiresAdmin: true }
];

const username = ref(localStorage.getItem(ADMIN_USER_KEY) || "admin");
const password = ref("");
const authenticated = ref(false);
const checkingAuth = ref(true);
const authError = ref("");
const theme = ref(localStorage.getItem(THEME_KEY) || "dark");

const requiresAdmin = computed(() => Boolean(route.meta.requiresAdmin));

function applyTheme() {
  if (theme.value === "light") {
    document.documentElement.classList.add("light");
    document.documentElement.classList.remove("dark");
  } else {
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
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
  <div class="workbench-shell">
    <!-- 侧边栏 -->
    <aside class="workbench-sidebar">
      <!-- 品牌 Logo -->
      <div class="sidebar-brand">
        <span class="sidebar-brand-mark" aria-hidden="true"></span>
        <span class="sidebar-brand-text">EdgeOne AI</span>
      </div>

      <!-- 导航菜单 -->
      <nav class="sidebar-nav" aria-label="Primary navigation">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="sidebar-nav-item"
        >
          <component :is="item.icon" :size="20" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <!-- 底部操作 -->
      <div class="sidebar-footer">
        <button
          class="sidebar-action"
          type="button"
          @click="toggleTheme"
          :aria-label="theme === 'light' ? '切换到深色模式' : '切换到浅色模式'"
        >
          <Moon v-if="theme === 'light'" :size="20" />
          <Sun v-else :size="20" />
          <span>{{ theme === 'light' ? '浅色' : '深色' }}</span>
        </button>

        <div v-if="!authenticated" class="sidebar-user">
          <button class="sidebar-action" type="button" @click="openAdminSurface">
            <KeyRound :size="20" />
            <span>管理员</span>
          </button>
        </div>

        <div v-else class="sidebar-user">
          <div class="sidebar-user-info">
            <div class="sidebar-avatar">{{ username.charAt(0).toUpperCase() }}</div>
            <span class="sidebar-username">{{ username }}</span>
          </div>
          <button class="sidebar-logout" type="button" @click="logout" title="退出登录">
            <LogOut :size="18" />
          </button>
        </div>
      </div>
    </aside>

    <!-- 主内容区域 -->
    <main class="workbench-main">
      <div v-if="requiresAdmin && checkingAuth" class="loading-state">
        <Activity :size="32" class="spinning" />
        <p>正在校验管理会话...</p>
      </div>

      <div v-else-if="requiresAdmin && !authenticated" class="auth-container">
        <div class="auth-panel">
          <div class="auth-header">
            <p class="eyebrow">Protected</p>
            <h1>管理员登录</h1>
            <p class="auth-description">
              需要管理员权限才能访问此页面
            </p>
          </div>

          <form @submit.prevent="login" class="auth-form">
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
            <button type="submit">登录</button>
          </form>
        </div>
      </div>

      <RouterView v-else />
    </main>
  </div>
</template>
