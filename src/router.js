import { createRouter, createWebHistory } from "vue-router";
import ChatPage from "./pages/ChatPage.vue";
import AdminLayout from "./pages/admin/AdminLayout.vue";
import ChannelsPage from "./pages/admin/ChannelsPage.vue";
import UsersPage from "./pages/admin/UsersPage.vue";
import HealthPage from "./pages/admin/HealthPage.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "chat", component: ChatPage },
    {
      path: "/m",
      component: AdminLayout,
      redirect: "/m/channels",
      children: [
        { path: "chat", name: "admin-chat", component: ChatPage, props: { embedded: true } },
        { path: "channels", name: "channels", component: ChannelsPage },
        { path: "users", name: "users", component: UsersPage },
        { path: "health", name: "health", component: HealthPage }
      ]
    }
  ]
});

export default router;
