import type { ServiceListItem, ServiceProbeResult, ServiceTimeline24h, ServiceUptimeSummary, UpsertServiceInput } from '@bea-uptime/contracts'
import { defineStore } from 'pinia'
import { i18n } from '@/i18n'
import { requestJson } from '@/lib/http'

type ServicesState = {
  items: ServiceListItem[]
  loading: boolean
}

const requestServices = <T>(path: string, init?: RequestInit) => {
  return requestJson<T>(`/api/v1/services${path}`, i18n.global.t('services.requestFailed'), init)
}

const stringifyPayload = (payload: UpsertServiceInput) => {
  return JSON.stringify({
    ...payload,
    timeoutMs: payload.timeoutMs ?? null,
  })
}

export const useServicesStore = defineStore('services', {
  state: (): ServicesState => ({
    items: [],
    loading: false,
  }),
  actions: {
    async fetchServices(options: { silent?: boolean } = {}) {
      if (!options.silent) {
        this.loading = true
      }

      try {
        this.items = await requestServices<ServiceListItem[]>('')
      } finally {
        if (!options.silent) {
          this.loading = false
        }
      }
    },
    async createService(payload: UpsertServiceInput) {
      const service = await requestServices<ServiceListItem>('', {
        method: 'POST',
        body: stringifyPayload(payload),
      })

      await this.fetchServices({ silent: true })
      return service
    },
    async updateService(slug: string, payload: UpsertServiceInput) {
      const service = await requestServices<ServiceListItem>(`/${slug}`, {
        method: 'PUT',
        body: stringifyPayload(payload),
      })

      this.items = this.items.map((item) => (item.id === service.id ? service : item))
      return service
    },
    async deleteService(slug: string) {
      await requestServices<{ ok: true }>(`/${slug}`, {
        method: 'DELETE',
      })

      this.items = this.items.filter((item) => item.slug !== slug)
    },
    async fetchUptimeSummary(slug: string) {
      return requestServices<ServiceUptimeSummary>(`/${slug}/uptime`)
    },
    async fetchTimeline24h() {
      return requestServices<ServiceTimeline24h>('/timeline-24h')
    },
    async runTest(slug: string) {
      return requestServices<ServiceProbeResult>(`/${slug}/test`, {
        method: 'POST',
      })
    },
  },
})
