import type { LoginRequest, SessionResponse } from '@bea-uptime/contracts'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { defineStore } from 'pinia'
import { i18n } from '@/i18n'
import { requestJson } from '@/lib/http'

type AuthState = {
  session: SessionResponse | null
  loading: boolean
  ready: boolean
  errorMessage: string
}

const loggedOutSession: SessionResponse = {
  authenticated: false,
}

const requestAuth = <T>(path: string, errorMessage: string, init?: RequestInit) => {
  return requestJson<T>(`/auth${path}`, errorMessage, init)
}

const t = (key: string) => i18n.global.t(key)

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    session: null,
    loading: false,
    ready: false,
    errorMessage: '',
  }),
  getters: {
    isAuthenticated: (state) => state.session?.authenticated === true,
  },
  actions: {
    async fetchSession() {
      this.loading = true

      try {
        this.session = await requestAuth<SessionResponse>('/session', t('auth.errors.sessionLoadFailed'))
        this.errorMessage = ''
      } catch (error) {
        this.session = loggedOutSession
        this.errorMessage = error instanceof Error ? error.message : t('auth.errors.sessionLoadFailed')
      } finally {
        this.loading = false
        this.ready = true
      }
    },
    async login(payload: LoginRequest) {
      this.loading = true

      try {
        this.session = await requestAuth<SessionResponse>('/login', t('auth.errors.loginFailed'), {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        this.errorMessage = ''
      } catch (error) {
        this.session = loggedOutSession
        this.errorMessage = error instanceof Error ? error.message : t('auth.errors.loginFailed')
      } finally {
        this.loading = false
        this.ready = true
      }
    },
    logout() {
      this.session = loggedOutSession
      this.loading = false
      this.ready = true
      this.errorMessage = ''

      void requestAuth<{ ok: true }>('/logout', t('auth.errors.logoutFailed'), {
        method: 'POST',
      }).catch(() => {})
    },
  },
})

export const useAuth = () => {
  const authStore = useAuthStore()
  const { errorMessage, loading, ready, session } = storeToRefs(authStore)

  return {
    errorMessage,
    loading,
    ready,
    session,
    login: authStore.login,
    logout: authStore.logout,
    fetchSession: authStore.fetchSession,
  }
}

export const useSession = () => {
  const authStore = useAuthStore()

  return {
    isAuthenticated: computed(() => authStore.isAuthenticated),
  }
}
