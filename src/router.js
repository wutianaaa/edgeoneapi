import { createRouter, createWebHistory } from "vue-router";
import ChatPage from "./pages/ChatPage.vue";
import AdminLayout from "./pages/admin/AdminLayout.vue";
import ChannelsPage from "./pages/admin/ChannelsPage.vue";
import UsersPage from "./pages/admin/UsersPage.vue";
import HealthPage from "./pages/admin/HealthPage.vue";
import { getAdminSession } from "./services/api.js";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      component: AdminLayout,
      redirect: "/chat",
      children: [
        {
          path: "chat",
          name: "chat",
          component: ChatPage,
          meta: {
            title: "Chat",
            requiresAdmin: false
          }
        },
        {
          path: "channels",
          name: "channels",
          component: ChannelsPage,
          meta: {
            title: "Channels",
            requiresAdmin: true
          }
        },
        {
          path: "users",
          name: "users",
          component: UsersPage,
          meta: {
            title: "Users",
            requiresAdmin: true
          }
        },
        {
          path: "health",
          name: "health",
          component: HealthPage,
          meta: {
            title: "Health",
            requiresAdmin: true
          }
        }
      ]
    },
    { path: "/m", redirect: "/channels" },
    { path: "/m/chat", redirect: "/chat" },
    { path: "/m/channels", redirect: "/channels" },
    { path: "/m/users", redirect: "/users" },
    { path: "/m/health", redirect: "/health" },
    { path: "/:pathMatch(.*)*", redirect: "/chat" }
  ]
});

// 缓存管理员会话状态
let adminSessionCache = { valid: false, timestamp: 0 };
const CACHE_DURATION = 5000; // 5秒缓存

// 路由守卫：验证管理员权限
router.beforeEach(async (to, from, next) => {
  // 检查是否需要管理员权限
  if (to.meta.requiresAdmin) {
    const now = Date.now();

    // 使用缓存避免频繁API调用
    if (adminSessionCache.valid && now - adminSessionCache.timestamp < CACHE_DURATION) {
      next();
      return;
    }

    try {
      // 验证管理员会话
      await getAdminSession();
      adminSessionCache = { valid: true, timestamp: now };
      next();
    } catch (error) {
      // 未授权，跳转到聊天页面
      adminSessionCache = { valid: false, timestamp: 0 };
      console.warn("Admin authentication required, redirecting to chat");

      // 避免重定向循环
      if (to.name === "chat") {
        next();
      } else {
        next({
          name: "chat",
          query: { redirect: to.fullPath }
        });
      }
    }
  } else {
    next();
  }
});

export default router;
