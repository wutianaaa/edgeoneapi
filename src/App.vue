<script setup>
import { onMounted } from "vue";

const THEME_KEY = "aiapi_theme";

function applyTheme() {
  const theme = localStorage.getItem(THEME_KEY) || "light";
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

onMounted(() => {
  applyTheme();
});
</script>

<template>
  <RouterView />
</template>

