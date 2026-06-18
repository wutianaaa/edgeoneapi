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
    <header class="workbench-header">
      <div class="workbench-header-inner">
        <RouterLink class="workbench-brand" to="/chat">
          <span class="workbench-brand-mark" aria-hidden="true"></span>
          <span>EdgeOne AI</span>
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

        <div style="display: flex; align-items: center; gap: 12px; margin-left: auto;">
          <button
            class="icon-button"
            type="button"
            @click="toggleTheme"
            :aria-label="theme === 'light' ? '切换到深色模式' : '切换到浅色模式'"
          >
            <Moon v-if="theme === 'light'" :size="18" />
            <Sun v-else :size="18" />
          </button>

          <button v-if="!authenticated" class="secondary" type="button" @click="openAdminSurface">
            <KeyRound :size="16" />
            Admin
          </button>

          <template v-else>
            <span class="badge">{{ username }}</span>
            <button class="secondary" type="button" @click="logout">
              <LogOut :size="16" />
              退出
            </button>
          </template>
        </div>
      </div>
    </header>

    <main class="workbench-main">
      <div v-if="requiresAdmin && checkingAuth" class="loading-state">
        <Activity :size="32" class="spinning" />
        <p>正在校验管理会话...</p>
      </div>

      <div v-else-if="requiresAdmin && !authenticated" style="min-height: 60vh; display: grid; place-items: center;">
        <div class="panel" style="width: min(480px, 100%); gap: 24px;">
          <div>
            <p class="eyebrow">Protected</p>
            <h1 style="margin-top: 8px;">管理员登录</h1>
            <p class="page-description" style="margin-top: 12px;">
              需要管理员权限才能访问此页面
            </p>
          </div>

          <form @submit.prevent="login" style="display: flex; flex-direction: column; gap: 16px;">
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
