<script setup lang="ts">
import type { PublicStatusIncident, PublicStatusLevel, PublicStatusResponse, PublicStatusServiceSnapshot } from '@bea-uptime/contracts'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { i18n } from '@/i18n'
import { requestJson } from '@/lib/http'

const REFRESH_INTERVAL_MS = 60_000
const STATUS_LABEL_KEYS = {
  operational: 'statusPage.states.operational',
  outage: 'statusPage.states.outage',
  paused: 'statusPage.states.paused',
  unknown: 'statusPage.states.unknown',
} as const satisfies Record<PublicStatusLevel, string>
const t = i18n.global.t

const status = ref<PublicStatusResponse | null>(null)
const loading = ref(true)
const errorMessage = ref('')
let refreshTimer: ReturnType<typeof setInterval> | undefined

const services = computed(() => status.value?.services ?? [])
const openIncidents = computed(() => status.value?.openIncidents ?? [])
const recentIncidents = computed(() => status.value?.recentIncidents ?? [])

const currentLocale = () => String(i18n.global.locale.value)

const loadStatus = async () => {
  if (!status.value) {
    loading.value = true
  }

  errorMessage.value = ''
  const loadFailedMessage = t('statusPage.errors.loadFailed')

  try {
    status.value = await requestJson<PublicStatusResponse>('/api/v1/status', loadFailedMessage)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : loadFailedMessage
  } finally {
    loading.value = false
  }
}

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    void loadStatus()
  }
}

const levelClass = (level: PublicStatusLevel) => `level-${level}`

const statusLabel = (level: PublicStatusLevel) => t(STATUS_LABEL_KEYS[level])

const formatRelativeTime = (value: string | null | undefined) => {
  if (!value) {
    return t('statusPage.values.never')
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))

  if (elapsedSeconds < 60) return t('statusPage.values.now')

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return t('statusPage.relativeTime.minutesAgo', { count: elapsedMinutes })

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return t('statusPage.relativeTime.hoursAgo', { count: elapsedHours })

  const elapsedDays = Math.floor(elapsedHours / 24)
  return t('statusPage.relativeTime.daysAgo', { count: elapsedDays })
}

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return t('statusPage.values.never')
  }

  return new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

const formatDuration = (startedAt: string, resolvedAt: string | null) => {
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now()
  const totalMinutes = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 60_000))
  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []

  if (days > 0) parts.push(t('statusPage.duration.days', { count: days }))
  if (hours > 0) parts.push(t('statusPage.duration.hours', { count: hours }))
  if (minutes > 0 || parts.length === 0) parts.push(t('statusPage.duration.minutes', { count: minutes }))

  return parts.join(', ')
}

const incidentTitle = (incident: PublicStatusIncident) => {
  return incident.status === 'open' ? t('statusPage.incidents.ongoingTitle') : t('statusPage.incidents.resolvedTitle')
}

const statusSummary = (service: PublicStatusServiceSnapshot) => {
  return t('statusPage.currentState.lastChecked', { time: formatRelativeTime(service.lastCheckedAt) })
}

const formatUptimePercent = (value: number | null) => {
  if (value == null) {
    return '--'
  }

  return `${value.toFixed(3).replace(/\.?0+$/, '')}%`
}

const serviceTimelineUptime = (service: PublicStatusServiceSnapshot) => {
  return formatUptimePercent(service.uptimePercentage48h)
}

onMounted(() => {
  document.title = t('statusPage.documentTitle')
  void loadStatus()
  refreshTimer = setInterval(() => void loadStatus(), REFRESH_INTERVAL_MS)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
  }

  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="status-page">
    <div v-if="errorMessage" class="status-alert">{{ errorMessage }}</div>

    <section class="status-section">
      <div class="section-heading">
        <p v-if="status" class="updated-at">{{ t('statusPage.updated', { time: formatRelativeTime(status.generatedAt) }) }}</p>
      </div>

      <div v-if="loading && !status" class="loading-card">{{ t('statusPage.loading') }}</div>
      <div v-else-if="services.length === 0" class="empty-card">{{ t('statusPage.emptyServices') }}</div>

      <div v-else class="services-list">
        <article v-for="service in services" :key="service.name" class="service-card">
          <div class="service-main">
            <div class="service-copy">
              <h3>{{ service.name }}</h3>
              <p>{{ statusSummary(service) }}</p>
            </div>
            <span class="service-state" :class="levelClass(service.status)">{{ statusLabel(service.status) }}</span>
          </div>

          <div class="service-timeline">
            <div class="signal-bars signal-bars--status" :aria-label="t('statusPage.metrics.last48Hours')">
              <span
                v-for="(bar, index) in service.checks48h"
                :key="`${service.name}-${index}`"
                class="signal-bar"
                :class="bar === 'fail' ? 'is-fail' : bar === 'ok' ? 'is-ok' : 'is-empty'"
              ></span>
            </div>

            <div class="timeline-caption">
              <span>{{ t('statusPage.metrics.last48Hours') }}</span>
              <strong>{{ serviceTimelineUptime(service) }}</strong>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="incident-grid">
      <div class="incident-panel">
        <div class="section-heading compact-heading">
          <div>
            <p class="eyebrow">{{ t('statusPage.incidents.currentEyebrow') }}</p>
            <h2>{{ t('statusPage.incidents.openTitle') }}</h2>
          </div>
        </div>

        <div v-if="openIncidents.length === 0" class="empty-card small">{{ t('statusPage.incidents.noOpen') }}</div>

        <article v-for="incident in openIncidents" :key="`${incident.serviceName}-${incident.startedAt}`" class="incident-card active">
          <div class="incident-card__headline">
            <span>{{ incidentTitle(incident) }}</span>
            <strong>{{ incident.serviceName }}</strong>
          </div>
          <p>{{ t('statusPage.incidents.openSummary', { date: formatDate(incident.startedAt), duration: formatDuration(incident.startedAt, incident.resolvedAt) }) }}</p>
        </article>
      </div>

      <div class="incident-panel">
        <div class="section-heading compact-heading">
          <div>
            <p class="eyebrow">{{ t('statusPage.incidents.historyEyebrow') }}</p>
            <h2>{{ t('statusPage.incidents.recentTitle') }}</h2>
          </div>
        </div>

        <div v-if="recentIncidents.length === 0" class="empty-card small">{{ t('statusPage.incidents.noRecent') }}</div>

        <article v-for="incident in recentIncidents" :key="`${incident.serviceName}-${incident.startedAt}`" class="incident-card">
          <div class="incident-card__headline">
            <span>{{ incidentTitle(incident) }}</span>
            <strong>{{ incident.serviceName }}</strong>
          </div>
          <p>{{ t('statusPage.incidents.recentSummary', { date: formatDate(incident.startedAt), duration: formatDuration(incident.startedAt, incident.resolvedAt) }) }}</p>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.status-page {
  width: min(1120px, 100%);
  min-height: 100vh;
  padding: 0 0 56px;
  color: var(--text);
}

.service-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.service-timeline,
.incident-grid {
  display: grid;
  gap: 16px;
}

.service-timeline {
  margin-top: 16px;
}

.service-copy {
  min-width: 0;
}

.service-copy h3,
.service-copy p {
  margin: 0;
}

.service-copy p {
  margin-top: 6px;
  color: var(--text-soft);
}

.service-state {
  white-space: nowrap;
}

.incident-grid {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  margin-top: 24px;
}

.status-alert,
.loading-card,
.empty-card,
.service-card,
.incident-panel,
.incident-card {
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 18px;
  background: var(--surface);
}
.updated-at,
.timeline-caption span {
  margin: 0px 10px 10px 10px;
  color: var(--text-soft);
}

.signal-bars {
  display: grid;
  align-items: end;
}

.signal-bars--status {
  grid-template-columns: repeat(48, minmax(0, 1fr));
  min-height: 44px;
  gap: 4px;
}

.signal-bar {
  display: block;
  width: 100%;
  min-width: 0;
  height: 100%;
  border-radius: 6px;
  background: var(--surface-muted);
}

.signal-bar.is-ok {
  background: var(--success);
}

.signal-bar.is-fail {
  background: var(--danger);
}

.signal-bar.is-empty {
  background: color-mix(in srgb, var(--border) 65%, var(--surface));
}

.timeline-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.78rem;
}

.timeline-caption strong {
  margin: 0;
  font-weight: 800;
  color: var(--text);
}

.services-list,
.incident-panel {
  display: grid;
  gap: 16px;
}

.incident-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.incident-card__headline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
}

.incident-card p,
.incident-card strong,
.incident-card span {
  margin: 0;
}

.level-operational {
  color: var(--success);
}

.level-outage {
  color: var(--danger);
}

.level-paused,
.level-unknown {
  color: var(--text-soft);
}

@media (max-width: 720px) {
  .service-main,
  .timeline-caption {
    align-items: flex-start;
    flex-direction: column;
  }

  .signal-bars--status {
    grid-template-columns: repeat(24, minmax(0, 1fr));
    grid-template-rows: repeat(2, 44px);
    min-height: 92px;
  }

  .service-state {
    align-self: flex-start;
  }
}
</style>
