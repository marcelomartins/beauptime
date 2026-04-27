import type { Incident } from '@bea-uptime/contracts'
import { defineStore } from 'pinia'
import { i18n } from '@/i18n'
import { requestJson } from '@/lib/http'

type IncidentFilters = {
  serviceId?: string
  status?: string
  from?: string
  to?: string
}

type IncidentsState = {
  items: Incident[]
  loading: boolean
}

const toQueryString = (filters: IncidentFilters) => {
  const query = new URLSearchParams()

  if (filters.serviceId) {
    query.set('serviceId', filters.serviceId)
  }

  if (filters.status) {
    query.set('status', filters.status)
  }

  if (filters.from) {
    query.set('from', filters.from)
  }

  if (filters.to) {
    query.set('to', filters.to)
  }

  const serialized = query.toString()
  return serialized.length > 0 ? `?${serialized}` : ''
}

export const useIncidentsStore = defineStore('incidents', {
  state: (): IncidentsState => ({
    items: [],
    loading: false,
  }),
  actions: {
    async fetchIncidents(filters: IncidentFilters = {}) {
      this.loading = true

      try {
        this.items = await requestJson<Incident[]>(
          `/api/v1/incidents${toQueryString(filters)}`,
          i18n.global.t('incidents.requestFailed'),
        )
      } finally {
        this.loading = false
      }
    },
  },
})
