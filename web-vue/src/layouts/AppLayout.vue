<script setup lang="ts">
import { onMounted } from 'vue'

type Theme = 'light' | 'dark'

const applyTheme = (value: Theme) => {
  document.documentElement.dataset.theme = value
  localStorage.setItem('bea-uptime-theme', value)
}

onMounted(() => {
  const storedTheme = localStorage.getItem('bea-uptime-theme')
  const preferredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

  applyTheme(storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : preferredTheme)
})
</script>

<template>
  <div class="app-frame">
    <RouterView />
  </div>
</template>

<style scoped>
.app-frame {
  width: 100%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
