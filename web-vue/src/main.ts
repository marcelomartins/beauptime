import { createPinia } from 'pinia'
import { ViteSSG } from 'vite-ssg'
import App from './App.vue'
import { i18n } from './i18n'
import { useAuthStore } from './modules/auth/auth'
import { routes } from './router'
import './assets/main.css'

const publicPaths = ['/', '/status']

export const createApp = ViteSSG(
  App,
  { routes },
  ({ app, router }) => {
    app.use(createPinia())
    app.use(i18n)

    router.beforeEach(async (to) => {
      const authStore = useAuthStore()

      if (typeof window !== 'undefined' && to.meta.redirectIfAuthenticated) {
        if (!authStore.ready) {
          await authStore.fetchSession()
        }

        if (authStore.isAuthenticated) {
          return '/dashboard'
        }
      }

      if (!to.meta.requiresAuth) {
        return true
      }

      if (!authStore.ready) {
        await authStore.fetchSession()
      }

      if (!authStore.isAuthenticated) {
        return '/'
      }

      return true
    })
  },
)

export const includedRoutes = () => publicPaths
