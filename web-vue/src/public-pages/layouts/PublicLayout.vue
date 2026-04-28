<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppMark from '@/components/brand/AppMark.vue'

type Theme = 'light' | 'dark'

const route = useRoute()
const theme = ref<Theme>('light')
const shouldCenterContent = computed(() => route.meta.centerContent !== false)
const showStatusBrand = computed(() => route.name === 'status')

const applyTheme = (value: Theme) => {
  theme.value = value
  document.documentElement.dataset.theme = value
  localStorage.setItem('bea-uptime-theme', value)
}

const toggleTheme = () => {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark')
}

onMounted(() => {
  const storedTheme = localStorage.getItem('bea-uptime-theme')
  const preferredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

  applyTheme(storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : preferredTheme)
})
</script>

<template>
  <div class="public-wrapper">
    <header class="public-header">
      <div class="public-header__inner" :class="{ 'public-header__inner--status': showStatusBrand }">
        <RouterLink v-if="showStatusBrand" class="public-brand" to="/">
          <AppMark class="public-brand-logo" />
          <span>{{ $t('app.name') }}</span>
        </RouterLink>

        <button class="theme-toggle" type="button" :title="$t('dashboard.console.toggleTheme')" @click="toggleTheme">
          <svg v-if="theme === 'light'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
        </button>
      </div>
    </header>

    <main class="public-main" :class="{ 'public-main--centered': shouldCenterContent }">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.public-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  width: 100%;
  background: radial-gradient(circle at top, rgba(59, 130, 246, 0.08), transparent 22%), var(--page-bg);
}

.public-header {
  display: flex;
  justify-content: center;
  width: 100%;
  padding: 20px 24px 0;
}

.public-header__inner {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.public-header__inner--status {
  width: min(1120px, 100%);
  justify-content: space-between;
}

.public-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 1.05rem;
  font-weight: 800;
}

.public-brand-logo {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
}

.theme-toggle {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 180ms ease, border-color 180ms ease, background-color 180ms ease;
}

.theme-toggle:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}

.public-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
   justify-content: flex-start;
  width: 100%;
  padding: 24px;
}

.public-main--centered {
  justify-content: center;
}

@media (max-width: 760px) {
  .public-header,
  .public-main {
    padding-left: 16px;
    padding-right: 16px;
  }

  .public-header {
    padding-top: 16px;
  }

  .public-header__inner {
    gap: 12px;
  }
}
</style>
