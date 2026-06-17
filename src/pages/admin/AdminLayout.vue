<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Activity, KeyRound, LogOut, MessageSquare, Moon, RadioTower, Sun, UserRound, Users } from "@lucide/vue";
import { getAdminSession, loginAdmin, logoutAdmin } from "../../services/api.js";

const ADMIN_USER_KEY = "aiapi_admin_user";
const THEME_KEY = "aiapi_theme";

const router = useRouter();
const username = ref(localStorage.getItem(ADMIN_USER_KEY) || "admin");
const password = ref("");
const authenticated = ref(false);
const checkingAuth = ref(true);
const authError = ref("");
const theme = ref(localStorage.getItem(THEME_KEY) || "light");

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
    router.replace("/m/channels");
  } catch (cause) {
    authError.value = cause.message;
  }
}

async function logout() {
  await logoutAdmin().catch(() => {});
  password.value = "";
  authError.value = "";
  authenticated.value = false;
  router.replace("/");
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

function handleWindowKeydown(event) {
  if (event.key === "Escape" && !authenticated.value) {
    password.value = "";
    authError.value = "";
  }
}

onMounted(() => {
  applyTheme();
  window.addEventListener("keydown", handleWindowKeydown);
  restoreSession();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWindowKeydown);
});
</script>

<template>
  <main class="admin-shell">
    <aside class="sidebar">
      <RouterLink class="brand" to="/">
        <span>AI API</span>
        <small>EdgeOne Gateway</small>
      </RouterLink>
      <nav aria-label="管理导航">
        <RouterLink to="/m/chat">
          <MessageSquare :size="18" />
          对话
        </RouterLink>
        <RouterLink to="/m/channels">
          <RadioTower :size="18" />
          渠道
        </RouterLink>
        <RouterLink to="/m/users">
          <Users :size="18" />
          用户
        </RouterLink>
        <RouterLink to="/m/health">
          <Activity :size="18" />
          健康
        </RouterLink>
      </nav>
      <div class="sidebar-footer">
        <p class="version">v1.2.0</p>
      </div>
    </aside>

    <section class="admin-main">
      <header v-if="authenticated" class="admin-topbar">
        <div class="admin-account">
          <UserRound :size="18" />
          <span>{{ username }}</span>
        </div>
        <button
          class="theme-toggle"
          type="button"
          @click="toggleTheme"
          :aria-label="theme === 'light' ? '切换到深色模式' : '切换到浅色模式'"
        >
          <Moon v-if="theme === 'light'" :size="18" />
          <Sun v-else :size="18" />
        </button>
        <button class="secondary" type="button" @click="logout">
          <LogOut :size="18" />
          退出
        </button>
      </header>

      <RouterView v-if="authenticated" />

      <div v-else-if="!checkingAuth" class="modal-backdrop" role="presentation">
        <section class="modal modal-narrow auth-modal" role="dialog" aria-modal="true" aria-labelledby="admin-login-title">
          <header class="modal-header">
            <div>
              <p class="eyebrow">管理后台</p>
              <h2 id="admin-login-title">登录设置</h2>
            </div>
            <KeyRound :size="20" />
          </header>
          <form class="panel plain-panel auth-form" @submit.prevent="login">
            <label>用户名 <input v-model="username" autocomplete="username" required placeholder="admin"></label>
            <label>管理 Token <input v-model="password" type="password" autocomplete="current-password" required placeholder="ADMIN_TOKEN"></label>
            <p v-if="authError" class="notice error">{{ authError }}</p>
            <button type="submit">进入后台</button>
          </form>
        </section>
      </div>
    </section>
  </main>
</template>
