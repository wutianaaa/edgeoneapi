import { createRouter, createWebHistory } from "vue-router";
import ChatPage from "./pages/ChatPage.vue";
import AdminLayout from "./pages/admin/AdminLayout.vue";
import ChannelsPage from "./pages/admin/ChannelsPage.vue";
import UsersPage from "./pages/admin/UsersPage.vue";
import HealthPage from "./pages/admin/HealthPage.vue";

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

export default router;
