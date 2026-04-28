<script setup lang="ts">
import type {
  ServiceDetail,
  ServiceProbeResult,
  ServiceTimeline24h,
  ServiceUptimeSummary,
  UpsertServiceInput,
} from '@bea-uptime/contracts'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppMark from '@/components/brand/AppMark.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useIncidentsStore } from '@/modules/incidents/incidents'
import { useServicesStore } from '@/modules/services/services'
import { useAuth } from '@/modules/auth/auth'
import { i18n } from '@/i18n'

type PanelMode = 'overview' | 'service' | 'create' | 'incidents'
type UptimeWindow = ServiceUptimeSummary['windows'][number]

type ServiceForm = {
  name: string
  target: string
  type: UpsertServiceInput['type']
  expectedStatus: number
  port: number
  timeoutMs: number
  enabled: boolean
}

type UptimeStat = {
  label: string
  percent: string
  detail: string
}

type TimelineBarStatus = 'up' | 'down' | 'empty'
type TimelineBarTitleMode = 'minute' | 'range'
type TimelineIncident = ServiceTimeline24h['incidents'][number]

type TimelineBar = {
  id: string
  status: TimelineBarStatus
  title: string
}

type ResponseTimeHistoryPoint = {
  checkedAt: string
  responseTimeMs: number | null
}

type ResponseTimeChartModel = {
  startLabel: string
  endLabel: string
  linePaths: string[]
  yAxisTicks: Array<{ y: number; label: string }>
  hasData: boolean
}

const MINUTE_IN_MS = 60 * 1000
const HOUR_IN_MS = 60 * MINUTE_IN_MS
const RESPONSE_TIME_RANGE_STEPS = [15, 30, 60, 120, 240, 360] as const
const RESPONSE_TIME_MAX_POINTS = 120
const RESPONSE_TIME_RETENTION_MS = RESPONSE_TIME_RANGE_STEPS[RESPONSE_TIME_RANGE_STEPS.length - 1] * MINUTE_IN_MS
const RESPONSE_TIME_CHART_WIDTH = 100
const RESPONSE_TIME_CHART_HEIGHT = 64
const RESPONSE_TIME_CHART_PADDING_LEFT = 10
const RESPONSE_TIME_CHART_PADDING_RIGHT = 4
const RESPONSE_TIME_CHART_PADDING_TOP = 6
const RESPONSE_TIME_CHART_PADDING_BOTTOM = 8
const RESPONSE_TIME_CHART_BASELINE_Y = RESPONSE_TIME_CHART_HEIGHT - RESPONSE_TIME_CHART_PADDING_BOTTOM
const RESPONSE_TIME_CHART_PLOT_START_X = RESPONSE_TIME_CHART_PADDING_LEFT
const RESPONSE_TIME_CHART_PLOT_END_X = RESPONSE_TIME_CHART_WIDTH - RESPONSE_TIME_CHART_PADDING_RIGHT
const TOAST_DURATION_MS = 4_000
const LIVE_REFRESH_CRITICAL_CYCLE_THRESHOLD = 3
const responseTimeChartViewBox = `0 0 ${RESPONSE_TIME_CHART_WIDTH} ${RESPONSE_TIME_CHART_HEIGHT}`
const responseTimeChartGridYs = [0.25, 0.5, 0.75].map((offset) => {
  return RESPONSE_TIME_CHART_PADDING_TOP + (RESPONSE_TIME_CHART_BASELINE_Y - RESPONSE_TIME_CHART_PADDING_TOP) * offset
})

const route = useRoute()
const router = useRouter()
const servicesStore = useServicesStore()
const incidentsStore = useIncidentsStore()
const { logout } = useAuth()
const t = i18n.global.t

const panelMode = ref<PanelMode>('overview')
const selectedServiceSlug = ref('')
const selectedUptimeSummary = ref<ServiceUptimeSummary | null>(null)
const timeline24h = ref<ServiceTimeline24h | null>(null)
const manualTest = ref<ServiceProbeResult | null>(null)
const loadingBootstrap = ref(false)
const loadingDetail = ref(false)
const creating = ref(false)
const saving = ref(false)
const testing = ref(false)
const deleting = ref(false)
const refreshingLiveData = ref(false)
const lastSuccessfulDashboardDataAt = ref<string | null>(null)
const consecutiveUnhealthyRefreshCycles = ref(0)
const unhealthyRefreshErrorCycles = ref(0)
const unhealthyRefreshStaleCycles = ref(0)
const lastLiveRefreshErrorMessage = ref('')
const errorMessage = ref('')
const statusMessage = ref('')
const liveRefreshIntervalMs = 30_000
let liveRefreshTimer: ReturnType<typeof setInterval> | undefined
let statusMessageTimer: ReturnType<typeof setTimeout> | undefined
let errorMessageTimer: ReturnType<typeof setTimeout> | undefined

const theme = ref<'light' | 'dark'>('light')
const responseTimeChartsEnabled = ref(false)
const responseTimeHistoryBySlug = ref<Record<string, ResponseTimeHistoryPoint[]>>({})
const observedResponseTimeCheckAtBySlug = ref<Record<string, string | null>>({})
const responseTimeBaselineReadyBySlug = ref<Record<string, true>>({})
const collapsedOverviewCardHeightsBySlug = ref<Record<string, number>>({})

const currentLocale = () => String(i18n.global.locale.value)

const syncCollapsedOverviewCardHeights = async () => {
  await nextTick()

  const nextHeights: Record<string, number> = {}
  const overviewCardElements = Array.from(document.querySelectorAll<HTMLElement>('[data-overview-service-card]'))

  for (const cardElement of overviewCardElements) {
    const slug = cardElement.dataset.overviewServiceCard

    if (!slug) {
      continue
    }

    const measuredHeight = Math.ceil(cardElement.getBoundingClientRect().height)

    if (measuredHeight > 0) {
      nextHeights[slug] = measuredHeight
    }
  }

  collapsedOverviewCardHeightsBySlug.value = nextHeights
}

const toggleResponseTimeCharts = async (event: Event) => {
  const nextChecked = event.target instanceof HTMLInputElement ? event.target.checked : false

  if (nextChecked) {
    await syncCollapsedOverviewCardHeights()
  }

  responseTimeChartsEnabled.value = nextChecked
}

const overviewCardStyle = (slug: string) => {
  if (!responseTimeChartsEnabled.value) {
    return undefined
  }

  const collapsedHeight = collapsedOverviewCardHeightsBySlug.value[slug]

  return collapsedHeight
    ? { height: `${collapsedHeight * 2}px` }
    : { height: 'calc(var(--overview-card-height) * 2)' }
}

const toggleTheme = () => {
  const next = theme.value === 'dark' ? 'light' : 'dark'
  theme.value = next
  document.documentElement.dataset.theme = next
  localStorage.setItem('bea-uptime-theme', next)
}

const handleLogout = () => {
  logout()
  void router.push('/')
}

const form = reactive<ServiceForm>({
  name: '',
  target: 'https://',
  type: 'GET',
  expectedStatus: 200,
  port: 22,
  timeoutMs: 8000,
  enabled: true,
})

const incidentFilters = reactive({
  serviceId: '',
  status: '',
  from: '',
  to: '',
})

const activeService = computed(() => servicesStore.items.find((service) => service.slug === selectedServiceSlug.value) ?? null)

const orderedServices = computed(() => {
  return [...servicesStore.items].sort((left, right) => {
    const leftDown = serviceIsDown(left) ? 1 : 0
    const rightDown = serviceIsDown(right) ? 1 : 0

    if (leftDown !== rightDown) {
      return rightDown - leftDown
    }

    return left.name.localeCompare(right.name)
  })
})

const downServicesCount = computed(() => servicesStore.items.filter(serviceIsDown).length)
const showDetailSidebar = computed(() => panelMode.value === 'service' && orderedServices.value.length > 0)

const defaultForm = (): ServiceForm => ({
  name: '',
  target: 'https://',
  type: 'GET',
  expectedStatus: 200,
  port: 22,
  timeoutMs: 8000,
  enabled: true,
})

const formUsesTcp = computed(() => form.type === 'TCP')

const targetFieldLabel = computed(() => {
  return formUsesTcp.value ? t('dashboard.console.hostTarget') : t('dashboard.console.urlTarget')
})

const targetFieldPlaceholder = computed(() => {
  return formUsesTcp.value ? 'sftp.example.com' : 'https://'
})

const targetFieldInputType = computed(() => {
  return formUsesTcp.value ? 'text' : 'url'
})

const messageFrom = (error: unknown, fallback: string) => {
  return error instanceof Error ? error.message : fallback
}

const formatServiceTarget = (service: Pick<ServiceDetail, 'target' | 'type' | 'port'>) => {
  return service.type === 'TCP' ? `${service.target}:${service.port}` : service.target
}

const resetForm = (service?: ServiceDetail) => {
  Object.assign(
    form,
    service
      ? {
          name: service.name,
          target: service.target,
          type: service.type,
          expectedStatus: service.expectedStatus ?? 200,
          port: service.port ?? 22,
          timeoutMs: service.timeoutMs,
          enabled: service.enabled,
        }
      : defaultForm(),
  )
}

const toPayload = (): UpsertServiceInput => {
  if (form.type === 'TCP') {
    return {
      name: form.name,
      target: form.target,
      type: 'TCP',
      port: form.port,
      timeoutMs: form.timeoutMs,
      enabled: form.enabled,
    }
  }

  return {
    name: form.name,
    target: form.target,
    type: 'GET',
    expectedStatus: form.expectedStatus,
    timeoutMs: form.timeoutMs,
    enabled: form.enabled,
  }
}

function serviceIsDown(service: ServiceDetail) {
  return service.runtime.status === 'down'
}

const serviceState = (service: ServiceDetail) => {
  if (!service.enabled) {
    return 'paused'
  }

  if (service.runtime.status === 'down') {
    return 'down'
  }

  if (service.runtime.status === 'up') {
    return 'up'
  }

  return 'idle'
}

const serviceStateLabel = (service: ServiceDetail) => {
  const state = serviceState(service)

  if (state === 'up') return t('services.status.up')
  if (state === 'down') return t('services.status.down')
  if (state === 'paused') return t('dashboard.console.paused')
  return t('dashboard.console.noSignal')
}

const formatDate = (value?: string | null) => {
  if (!value) {
    return t('dashboard.console.never')
  }

  return new Date(value).toLocaleString()
}

const formatRefreshTimestamp = (value?: string | null) => {
  if (!value) {
    return ''
  }

  return new Intl.DateTimeFormat(currentLocale(), {
    timeStyle: 'short',
  }).format(new Date(value))
}

const hasEnabledMonitoring = (services: Array<Pick<ServiceDetail, 'enabled'>>) => {
  return services.some(service => service.enabled)
}

const resolveLatestMonitoredCheckAt = (services: Array<Pick<ServiceDetail, 'enabled' | 'runtime'>>) => {
  let latestCheckAt: string | null = null

  for (const service of services) {
    const checkedAt = service.enabled ? service.runtime.lastCheckAt : null

    if (!checkedAt) {
      continue
    }

    if (!latestCheckAt || new Date(checkedAt).getTime() > new Date(latestCheckAt).getTime()) {
      latestCheckAt = checkedAt
    }
  }

  return latestCheckAt
}

const resetUnhealthyRefreshCycleState = () => {
  consecutiveUnhealthyRefreshCycles.value = 0
  unhealthyRefreshErrorCycles.value = 0
  unhealthyRefreshStaleCycles.value = 0
  lastLiveRefreshErrorMessage.value = ''
}

const syncDashboardRefreshSnapshot = (services: Array<Pick<ServiceDetail, 'enabled' | 'runtime'>>) => {
  lastSuccessfulDashboardDataAt.value = resolveLatestMonitoredCheckAt(services)
  resetUnhealthyRefreshCycleState()
}

const markUnhealthyLiveRefreshCycle = (
  services: Array<Pick<ServiceDetail, 'enabled'>>,
  reason: 'stale' | 'error',
  details?: { errorMessage?: string },
) => {
  if (!hasEnabledMonitoring(services)) {
    resetUnhealthyRefreshCycleState()
    return
  }

  consecutiveUnhealthyRefreshCycles.value += 1

  if (reason === 'error') {
    unhealthyRefreshErrorCycles.value += 1

    if (details?.errorMessage) {
      lastLiveRefreshErrorMessage.value = details.errorMessage
    }

    return
  }

  unhealthyRefreshStaleCycles.value += 1
}

const handleSuccessfulLiveRefresh = (services: Array<Pick<ServiceDetail, 'enabled' | 'runtime'>>) => {
  const latestCheckAt = resolveLatestMonitoredCheckAt(services)

  if (!hasEnabledMonitoring(services)) {
    resetUnhealthyRefreshCycleState()
    return
  }

  if (
    latestCheckAt
    && (!lastSuccessfulDashboardDataAt.value || new Date(latestCheckAt).getTime() > new Date(lastSuccessfulDashboardDataAt.value).getTime())
  ) {
    lastSuccessfulDashboardDataAt.value = latestCheckAt
    resetUnhealthyRefreshCycleState()
    return
  }

  markUnhealthyLiveRefreshCycle(services, 'stale')
}

const isDashboardRefreshCritical = computed(() => {
  return hasEnabledMonitoring(servicesStore.items)
    && consecutiveUnhealthyRefreshCycles.value >= LIVE_REFRESH_CRITICAL_CYCLE_THRESHOLD
})

const dashboardRefreshTooltip = computed(() => {
  if (!isDashboardRefreshCritical.value) {
    return undefined
  }

  const count = consecutiveUnhealthyRefreshCycles.value
  const hasErrors = unhealthyRefreshErrorCycles.value > 0
  const hasStaleCycles = unhealthyRefreshStaleCycles.value > 0

  if (hasErrors && hasStaleCycles) {
    return lastLiveRefreshErrorMessage.value
      ? t('dashboard.console.refreshCriticalMixedWithMessage', {
          count,
          message: lastLiveRefreshErrorMessage.value,
        })
      : t('dashboard.console.refreshCriticalMixed', { count })
  }

  if (hasErrors) {
    return lastLiveRefreshErrorMessage.value
      ? t('dashboard.console.refreshCriticalErrorsWithMessage', {
          count,
          message: lastLiveRefreshErrorMessage.value,
        })
      : t('dashboard.console.refreshCriticalErrors', { count })
  }

  if (!lastSuccessfulDashboardDataAt.value) {
    return t('dashboard.console.refreshCriticalNoData', { count })
  }

  return t('dashboard.console.refreshCriticalStale', { count })
})

const formatRelativeTime = (value?: string | null) => {
  if (!value) {
    return t('dashboard.console.never')
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))

  if (elapsedSeconds < 60) return t('dashboard.console.secondsAgo', { count: elapsedSeconds })

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return t('dashboard.console.minutesAgo', { count: elapsedMinutes })

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return t('dashboard.console.hoursAgo', { count: elapsedHours })

  const elapsedDays = Math.floor(elapsedHours / 24)
  return t('dashboard.console.daysAgo', { count: elapsedDays })
}

const formatDurationUnit = (unit: 'day' | 'hour' | 'minute', count: number, options: { short?: boolean } = {}) => {
  if (options.short) {
    if (unit === 'day') return t('dashboard.console.durationDayShort', { count })
    if (unit === 'hour') return t('dashboard.console.durationHourShort', { count })
    return t('dashboard.console.durationMinuteShort', { count })
  }

  if (unit === 'day') {
    return t(count === 1 ? 'dashboard.console.durationDay' : 'dashboard.console.durationDays', { count })
  }

  if (unit === 'hour') {
    return t(count === 1 ? 'dashboard.console.durationHour' : 'dashboard.console.durationHours', { count })
  }

  return t(count === 1 ? 'dashboard.console.durationMinute' : 'dashboard.console.durationMinutes', { count })
}

const formatLatency = (value?: number | null) => {
  return value == null ? t('services.status.noData') : `${Math.round(value)}ms`
}

const formatResponseTimeAxisLabel = (value: number) => {
  return String(Math.round(value))
}

const buildResponseTimeYAxisTicks = (maxValue: number) => {
  const tickOffsets = [0, 0.25, 0.5, 0.75]

  return tickOffsets.map((offset) => {
    const y = RESPONSE_TIME_CHART_PADDING_TOP + (RESPONSE_TIME_CHART_BASELINE_Y - RESPONSE_TIME_CHART_PADDING_TOP) * offset

    return {
      y,
      label: formatResponseTimeAxisLabel(maxValue * (1 - offset)),
    }
  })
}

const formatDuration = (milliseconds: number) => {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000))
  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []

  if (days > 0) parts.push(formatDurationUnit('day', days, { short: true }))
  if (hours > 0) parts.push(formatDurationUnit('hour', hours, { short: true }))
  if (minutes > 0 || parts.length === 0) parts.push(formatDurationUnit('minute', minutes, { short: true }))

  return parts.join(', ')
}

const formatDurationLong = (milliseconds: number) => {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000))
  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    return hours > 0
      ? `${formatDurationUnit('day', days)}, ${formatDurationUnit('hour', hours)}`
      : formatDurationUnit('day', days)
  }

  if (hours > 0) {
    return minutes > 0
      ? `${formatDurationUnit('hour', hours)}, ${formatDurationUnit('minute', minutes)}`
      : formatDurationUnit('hour', hours)
  }

  return formatDurationUnit('minute', minutes)
}

const formatUptimePercent = (value: number) => {
  if (value === 100) return '100%'
  const decimals = value >= 99.99 ? 3 : value >= 99 ? 2 : 1
  return `${value.toFixed(decimals).replace(/\.?0+$/, '')}%`
}

const findUptimeWindow = (days: number): UptimeWindow | undefined => {
  return selectedUptimeSummary.value?.windows.find((window) => window.windowDays === days)
}

const buildUptimeStat = (label: string, days: number): UptimeStat => {
  if (!activeService.value?.runtime.lastCheckAt) {
    return {
      label,
      percent: '--',
      detail: t('dashboard.console.uptimeNoChecks'),
    }
  }

  const window = findUptimeWindow(days)

  if (!window || window.uptimePercentage == null) {
    return {
      label,
      percent: '--',
      detail: t('dashboard.console.uptimeNoChecks'),
    }
  }

  return {
    label,
    percent: formatUptimePercent(window.uptimePercentage),
    detail: t('dashboard.console.uptimeDetail', {
      incidents: window.incidentsCount,
      downtime: formatDuration(window.downtimeMinutes * 60_000),
    }),
  }
}

const timelineIncidentsByServiceId = computed(() => {
  const grouped = new Map<number, ServiceTimeline24h['incidents']>()

  for (const incident of timeline24h.value?.incidents ?? []) {
    const items = grouped.get(incident.serviceId)

    if (items) {
      items.push(incident)
      continue
    }

    grouped.set(incident.serviceId, [incident])
  }

  return grouped
})

const formatTimelinePoint = (valueMs: number) => {
  return new Date(valueMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatTimelineRange = (slotStartMs: number, slotEndMs: number) => {
  const start = new Date(slotStartMs)
  const end = new Date(slotEndMs)

  if (start.toDateString() === end.toDateString()) {
    return `${formatTimelinePoint(slotStartMs)} - ${formatTimelinePoint(slotEndMs)}`
  }

  return `${start.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })} - ${end.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

const toTimestampMs = (value?: string | null) => {
  if (!value) {
    return Number.NaN
  }

  return new Date(value).getTime()
}

const pruneResponseTimeHistory = (samples: ResponseTimeHistoryPoint[], nowMs: number) => {
  const cutoffMs = nowMs - RESPONSE_TIME_RETENTION_MS

  return [...samples]
    .filter((sample) => {
      const checkedAtMs = toTimestampMs(sample.checkedAt)
      return Number.isFinite(checkedAtMs) && checkedAtMs >= cutoffMs
    })
    .sort((left, right) => toTimestampMs(left.checkedAt) - toTimestampMs(right.checkedAt))
}

const establishResponseTimeBaselines = (services: ServiceDetail[]) => {
  const nowMs = Date.now()
  const nextHistory: Record<string, ResponseTimeHistoryPoint[]> = {}
  const nextObservedCheckAt: Record<string, string | null> = {}
  const nextBaselineReady: Record<string, true> = {}

  for (const service of services) {
    const hasObservedCheckAt = Object.prototype.hasOwnProperty.call(observedResponseTimeCheckAtBySlug.value, service.slug)

    nextHistory[service.slug] = pruneResponseTimeHistory(responseTimeHistoryBySlug.value[service.slug] ?? [], nowMs)
    nextObservedCheckAt[service.slug] = hasObservedCheckAt
      ? observedResponseTimeCheckAtBySlug.value[service.slug] ?? null
      : service.runtime.lastCheckAt ?? null
    nextBaselineReady[service.slug] = true
  }

  responseTimeHistoryBySlug.value = nextHistory
  observedResponseTimeCheckAtBySlug.value = nextObservedCheckAt
  responseTimeBaselineReadyBySlug.value = nextBaselineReady
}

const collectFreshResponseTimes = (services: ServiceDetail[]) => {
  const nowMs = Date.now()
  const nextHistory: Record<string, ResponseTimeHistoryPoint[]> = {}
  const nextObservedCheckAt: Record<string, string | null> = {}
  const nextBaselineReady: Record<string, true> = {}

  for (const service of services) {
    const history = pruneResponseTimeHistory(responseTimeHistoryBySlug.value[service.slug] ?? [], nowMs)
    const currentCheckAt = service.runtime.lastCheckAt ?? null
    const hasBaseline = Boolean(responseTimeBaselineReadyBySlug.value[service.slug])

    if (!hasBaseline) {
      nextHistory[service.slug] = history
      nextObservedCheckAt[service.slug] = currentCheckAt
      nextBaselineReady[service.slug] = true
      continue
    }

    const previousCheckAt = observedResponseTimeCheckAtBySlug.value[service.slug] ?? null
    const hasKnownPoint = currentCheckAt ? history.some((point) => point.checkedAt === currentCheckAt) : false
    const nextServiceHistory = currentCheckAt && currentCheckAt !== previousCheckAt && !hasKnownPoint
      ? pruneResponseTimeHistory(
          [...history, { checkedAt: currentCheckAt, responseTimeMs: service.runtime.lastResponseTimeMs }],
          nowMs,
        )
      : history

    nextHistory[service.slug] = nextServiceHistory
    nextObservedCheckAt[service.slug] = currentCheckAt
    nextBaselineReady[service.slug] = true
  }

  responseTimeHistoryBySlug.value = nextHistory
  observedResponseTimeCheckAtBySlug.value = nextObservedCheckAt
  responseTimeBaselineReadyBySlug.value = nextBaselineReady
}

const moveResponseTimeHistory = (fromSlug: string, toSlug: string) => {
  if (!fromSlug || fromSlug === toSlug) {
    return
  }

  const fromHistory = responseTimeHistoryBySlug.value[fromSlug]
  const fromObservedCheckAt = observedResponseTimeCheckAtBySlug.value[fromSlug]
  const hadBaseline = responseTimeBaselineReadyBySlug.value[fromSlug]

  if (!fromHistory && fromObservedCheckAt == null && !hadBaseline) {
    return
  }

  const nextHistory = { ...responseTimeHistoryBySlug.value }
  const nextObservedCheckAt = { ...observedResponseTimeCheckAtBySlug.value }
  const nextBaselineReady = { ...responseTimeBaselineReadyBySlug.value }

  if (fromHistory) {
    nextHistory[toSlug] = fromHistory
  }

  if (fromObservedCheckAt !== undefined) {
    nextObservedCheckAt[toSlug] = fromObservedCheckAt
  }

  if (hadBaseline) {
    nextBaselineReady[toSlug] = true
  }

  delete nextHistory[fromSlug]
  delete nextObservedCheckAt[fromSlug]
  delete nextBaselineReady[fromSlug]

  responseTimeHistoryBySlug.value = nextHistory
  observedResponseTimeCheckAtBySlug.value = nextObservedCheckAt
  responseTimeBaselineReadyBySlug.value = nextBaselineReady
}

const dropResponseTimeHistory = (slug: string) => {
  if (!slug) {
    return
  }

  const nextHistory = { ...responseTimeHistoryBySlug.value }
  const nextObservedCheckAt = { ...observedResponseTimeCheckAtBySlug.value }
  const nextBaselineReady = { ...responseTimeBaselineReadyBySlug.value }

  delete nextHistory[slug]
  delete nextObservedCheckAt[slug]
  delete nextBaselineReady[slug]

  responseTimeHistoryBySlug.value = nextHistory
  observedResponseTimeCheckAtBySlug.value = nextObservedCheckAt
  responseTimeBaselineReadyBySlug.value = nextBaselineReady
}

const resolveResponseTimeRangeMinutes = (samples: ResponseTimeHistoryPoint[]) => {
  if (samples.length < 2) {
    return RESPONSE_TIME_RANGE_STEPS[0]
  }

  const firstCheckedAtMs = toTimestampMs(samples[0]?.checkedAt)
  const lastCheckedAtMs = toTimestampMs(samples[samples.length - 1]?.checkedAt)
  const spanMs = Number.isFinite(firstCheckedAtMs) && Number.isFinite(lastCheckedAtMs)
    ? Math.max(0, lastCheckedAtMs - firstCheckedAtMs)
    : 0

  for (const step of RESPONSE_TIME_RANGE_STEPS) {
    if (spanMs < step * MINUTE_IN_MS) {
      return step
    }
  }

  return RESPONSE_TIME_RANGE_STEPS[RESPONSE_TIME_RANGE_STEPS.length - 1]
}

const buildResponseTimeLinePaths = (points: Array<{ x: number; y: number | null }>) => {
  const commands: string[] = []

  for (const point of points) {
    if (point.y == null) {
      continue
    }

    commands.push(commands.length === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`)
  }

  return commands.length > 0 ? [commands.join(' ')] : []
}

const buildResponseTimeChart = (service: ServiceDetail): ResponseTimeChartModel => {
  const samples = responseTimeHistoryBySlug.value[service.slug] ?? []
  const latestCheckedAtMs = toTimestampMs(samples[samples.length - 1]?.checkedAt)
  const rangeMinutes = resolveResponseTimeRangeMinutes(samples)
  const rangeDurationMs = rangeMinutes * MINUTE_IN_MS
  const bucketMinutes = Math.max(1, Math.ceil(rangeMinutes / RESPONSE_TIME_MAX_POINTS))
  const bucketDurationMs = bucketMinutes * MINUTE_IN_MS
  const bucketCount = Math.max(1, Math.ceil(rangeDurationMs / bucketDurationMs))
  const rangeEndMs = Number.isFinite(latestCheckedAtMs) ? latestCheckedAtMs : Date.now()
  const rangeStartMs = rangeEndMs - rangeDurationMs

  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const startMs = rangeStartMs + index * bucketDurationMs
    const endMs = index === bucketCount - 1 ? rangeEndMs : Math.min(rangeEndMs, startMs + bucketDurationMs)

    return {
      startMs,
      endMs,
      totalResponseTimeMs: 0,
      pointsCount: 0,
    }
  })

  for (const sample of samples) {
    const checkedAtMs = toTimestampMs(sample.checkedAt)

    if (!Number.isFinite(checkedAtMs) || checkedAtMs < rangeStartMs || checkedAtMs > rangeEndMs) {
      continue
    }

    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor((checkedAtMs - rangeStartMs) / bucketDurationMs)))
    const bucket = buckets[bucketIndex]

    if (!bucket || sample.responseTimeMs == null) {
      continue
    }

    bucket.totalResponseTimeMs += sample.responseTimeMs
    bucket.pointsCount += 1
  }

  const usableWidth = RESPONSE_TIME_CHART_PLOT_END_X - RESPONSE_TIME_CHART_PLOT_START_X
  const usableHeight = RESPONSE_TIME_CHART_BASELINE_Y - RESPONSE_TIME_CHART_PADDING_TOP
  const points = buckets.map((bucket, index) => {
    const averageResponseTimeMs = bucket.pointsCount > 0 ? bucket.totalResponseTimeMs / bucket.pointsCount : null
    const x = bucketCount === 1
      ? (RESPONSE_TIME_CHART_PLOT_START_X + RESPONSE_TIME_CHART_PLOT_END_X) / 2
      : RESPONSE_TIME_CHART_PLOT_START_X + (index * usableWidth) / (bucketCount - 1)

    return {
      id: `${service.slug}-response-time-${bucket.startMs}`,
      title: `${formatTimelineRange(bucket.startMs, bucket.endMs)} - ${averageResponseTimeMs == null ? t('services.status.noData') : formatLatency(averageResponseTimeMs)}`,
      value: averageResponseTimeMs,
      x,
      y: null as number | null,
    }
  })

  const values = points.flatMap((point) => (point.value == null ? [] : [point.value]))
  const hasData = values.length > 0
  const maxValue = hasData ? Math.max(100, Math.max(...values)) * 1.15 : 100

  for (const point of points) {
    point.y = point.value == null
      ? null
      : RESPONSE_TIME_CHART_BASELINE_Y - (point.value / maxValue) * usableHeight
  }

  return {
    startLabel: formatTimelinePoint(rangeStartMs),
    endLabel: formatTimelinePoint(rangeEndMs),
    linePaths: buildResponseTimeLinePaths(points),
    yAxisTicks: buildResponseTimeYAxisTicks(maxValue),
    hasData,
  }
}

const formatTimelineIncidentCount = (count: number) => {
  return count === 1
    ? t('dashboard.console.timelineIncident', { count })
    : t('dashboard.console.timelineIncidents', { count })
}

const getTimelineReferenceMs = () => {
  return timeline24h.value ? new Date(timeline24h.value.generatedAt).getTime() : Date.now()
}

const incidentIsActiveAt = (incident: TimelineIncident, pointMs: number) => {
  const incidentStartMs = new Date(incident.startedAt).getTime()
  const incidentEndMs = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : Number.POSITIVE_INFINITY

  return incidentStartMs <= pointMs && incidentEndMs > pointMs
}

const incidentOverlapsWindow = (incident: TimelineIncident, windowStartMs: number, windowEndMs: number) => {
  const incidentStartMs = new Date(incident.startedAt).getTime()
  const incidentEndMs = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : Number.POSITIVE_INFINITY

  return incidentStartMs < windowEndMs && incidentEndMs > windowStartMs
}

const slotPrecedesMonitoringStart = (service: ServiceDetail, pointMs: number) => {
  return pointMs < new Date(service.monitoringStartedAt).getTime()
}

const getMonitoringStartedAtMs = (service: ServiceDetail) => {
  return new Date(service.monitoringStartedAt).getTime()
}

const formatTimelineBarTitle = (
  slotStartMs: number,
  slotEndMs: number,
  status: TimelineBarStatus,
  titleMode: TimelineBarTitleMode,
  incidentCount = 0,
) => {
  if (titleMode === 'range') {
    return `${formatTimelineRange(slotStartMs, slotEndMs)} - ${formatTimelineIncidentCount(incidentCount)}`
  }

  const window = formatTimelinePoint(slotStartMs)

  if (status === 'empty') {
    return `${window} - ${t('services.status.noData')}`
  }

  if (status === 'down') {
    return `${window} - ${t('services.status.down')}`
  }

  return `${window} - ${t('services.status.up')}`
}

const buildMinuteSnapshotBars = (service: ServiceDetail, minutes: number): TimelineBar[] => {
  const referenceMs = getTimelineReferenceMs()
  const currentMinuteStartMs = Math.floor(referenceMs / MINUTE_IN_MS) * MINUTE_IN_MS

  if (!service.runtime.lastCheckAt) {
    return Array.from({ length: minutes }, (_, index) => {
      const minuteStartMs = currentMinuteStartMs - (minutes - 1 - index) * MINUTE_IN_MS
      const minuteEndMs = minuteStartMs + MINUTE_IN_MS

      return {
        id: `${service.id}-minute-${minuteStartMs}`,
        status: 'empty',
        title: formatTimelineBarTitle(minuteStartMs, minuteEndMs, 'empty', 'minute'),
      }
    })
  }

  const incidents = timelineIncidentsByServiceId.value.get(service.id) ?? []

  return Array.from({ length: minutes }, (_, index) => {
    const minuteStartMs = currentMinuteStartMs - (minutes - 1 - index) * MINUTE_IN_MS
    const minuteEndMs = minuteStartMs + MINUTE_IN_MS
    const snapshotMs = index === minutes - 1 ? referenceMs : minuteEndMs - 1

    if (slotPrecedesMonitoringStart(service, snapshotMs)) {
      return {
        id: `${service.id}-minute-${minuteStartMs}`,
        status: 'empty',
        title: formatTimelineBarTitle(minuteStartMs, minuteEndMs, 'empty', 'minute'),
      }
    }

    const snapshotDown = incidents.some((incident) => incidentIsActiveAt(incident, snapshotMs))
    const currentStatus = service.runtime.status
    const status: TimelineBarStatus = index === minutes - 1 && (currentStatus === 'up' || currentStatus === 'down')
      ? currentStatus
      : snapshotDown ? 'down' : 'up'

    return {
      id: `${service.id}-minute-${minuteStartMs}`,
      status,
      title: formatTimelineBarTitle(minuteStartMs, minuteEndMs, status, 'minute'),
    }
  })
}

const buildHourlyOverlapBars = (service: ServiceDetail, hours: number): TimelineBar[] => {
  const referenceMs = getTimelineReferenceMs()
  const currentHourStartMs = Math.floor(referenceMs / HOUR_IN_MS) * HOUR_IN_MS
  const incidents = timelineIncidentsByServiceId.value.get(service.id) ?? []

  if (!service.runtime.lastCheckAt) {
    return Array.from({ length: hours }, (_, index) => {
      const hourStartMs = currentHourStartMs - (hours - 1 - index) * HOUR_IN_MS
      const hourEndMs = hourStartMs + HOUR_IN_MS

      return {
        id: `${service.id}-hour-${hourStartMs}`,
        status: 'empty',
        title: `${formatTimelineRange(hourStartMs, hourEndMs)} - ${t('services.status.noData')}`,
      }
    })
  }

  return Array.from({ length: hours }, (_, index) => {
    const hourStartMs = currentHourStartMs - (hours - 1 - index) * HOUR_IN_MS
    const hourEndMs = hourStartMs + HOUR_IN_MS
    const monitoringStartedAtMs = getMonitoringStartedAtMs(service)

    if (slotPrecedesMonitoringStart(service, hourEndMs - 1)) {
      return {
        id: `${service.id}-hour-${hourStartMs}`,
        status: 'empty',
        title: `${formatTimelineRange(hourStartMs, hourEndMs)} - ${t('services.status.noData')}`,
      }
    }

    const effectiveHourStartMs = Math.max(hourStartMs, monitoringStartedAtMs)
    const overlappingIncidents = incidents.filter((incident) => incidentOverlapsWindow(incident, effectiveHourStartMs, hourEndMs))
    const status: TimelineBarStatus = overlappingIncidents.length > 0 ? 'down' : 'up'

    return {
      id: `${service.id}-hour-${hourStartMs}`,
      status,
      title: formatTimelineBarTitle(hourStartMs, hourEndMs, status, 'range', overlappingIncidents.length),
    }
  })
}

const serviceCheckBars = (service: ServiceDetail) => buildHourlyOverlapBars(service, 12)
const overviewSignalBars = (service: ServiceDetail) => buildMinuteSnapshotBars(service, 30)
const responseTimeChartsBySlug = computed(() => {
  const charts: Record<string, ResponseTimeChartModel> = {}

  for (const service of servicesStore.items) {
    charts[service.slug] = buildResponseTimeChart(service)
  }

  return charts
})

const responseTimeChartFor = (slug: string) => {
  return responseTimeChartsBySlug.value[slug]
}

const selectedSignalBars = computed(() => {
  return activeService.value ? buildMinuteSnapshotBars(activeService.value, 30) : []
})

const recentTimelineBars = computed(() => {
  return activeService.value ? buildHourlyOverlapBars(activeService.value, 24) : []
})

const activeResponseTimeChart = computed(() => {
  return activeService.value ? responseTimeChartFor(activeService.value.slug) ?? null : null
})

const toIso = (value: string) => {
  return value ? new Date(value).toISOString() : ''
}

const loadTimeline24h = async () => {
  timeline24h.value = await servicesStore.fetchTimeline24h()
}

const loadServiceDetail = async (slug: string, options: { silent?: boolean; syncForm?: boolean } = {}) => {
  if (!slug) {
    return
  }

  const shouldSyncForm = options.syncForm ?? true
  selectedServiceSlug.value = slug

  if (!options.silent) {
    loadingDetail.value = true
  }

  try {
    const loadedService = servicesStore.items.find((service) => service.slug === slug)

    if (!loadedService) {
      throw new Error(t('dashboard.console.errors.serviceLoadFailed'))
    }

    if (shouldSyncForm) {
      resetForm(loadedService)
    }

    selectedUptimeSummary.value = await servicesStore.fetchUptimeSummary(slug)
    errorMessage.value = ''
  } catch (error) {
    selectedUptimeSummary.value = null
    errorMessage.value = messageFrom(error, t('dashboard.console.errors.serviceLoadFailed'))
  } finally {
    if (!options.silent) {
      loadingDetail.value = false
    }
  }
}

const fetchIncidentList = async () => {
  try {
    await incidentsStore.fetchIncidents({
      serviceId: incidentFilters.serviceId || undefined,
      status: incidentFilters.status || undefined,
      from: toIso(incidentFilters.from) || undefined,
      to: toIso(incidentFilters.to) || undefined,
    })
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = messageFrom(error, t('dashboard.console.errors.incidentsLoadFailed'))
  }
}

const clearIncidentFilters = async () => {
  incidentFilters.serviceId = ''
  incidentFilters.status = ''
  incidentFilters.from = ''
  incidentFilters.to = ''
  await fetchIncidentList()
}

const applyRouteIntent = async () => {
  const routeServiceSlug = typeof route.params.slug === 'string' ? route.params.slug : ''

  if (route.name === 'dashboard-incidents') {
    panelMode.value = 'incidents'
    manualTest.value = null
    selectedServiceSlug.value = ''
    selectedUptimeSummary.value = null
    await fetchIncidentList()
    return
  }

  if (route.name === 'dashboard-new') {
    panelMode.value = 'create'
    manualTest.value = null
    selectedServiceSlug.value = ''
    selectedUptimeSummary.value = null
    resetForm()
    errorMessage.value = ''
    return
  }

  if (routeServiceSlug) {
    panelMode.value = 'service'
    manualTest.value = null
    await loadServiceDetail(routeServiceSlug)
    return
  }

  panelMode.value = 'overview'
  manualTest.value = null
  selectedServiceSlug.value = ''
  selectedUptimeSummary.value = null
  errorMessage.value = ''
}

const bootstrap = async () => {
  loadingBootstrap.value = true

  try {
    await servicesStore.fetchServices()
    establishResponseTimeBaselines(servicesStore.items)
    await loadTimeline24h()
    syncDashboardRefreshSnapshot(servicesStore.items)
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = messageFrom(error, t('dashboard.console.errors.bootstrapFailed'))
  } finally {
    loadingBootstrap.value = false
  }
}

const refreshLiveData = async () => {
  if (refreshingLiveData.value || creating.value || saving.value || testing.value || deleting.value) {
    return
  }

  refreshingLiveData.value = true

  try {
    await servicesStore.fetchServices({ silent: true })
    collectFreshResponseTimes(servicesStore.items)
    await Promise.all([
      loadTimeline24h(),
      panelMode.value === 'service' && selectedServiceSlug.value
        ? loadServiceDetail(selectedServiceSlug.value, { silent: true, syncForm: false })
        : Promise.resolve(),
      panelMode.value === 'incidents' ? fetchIncidentList() : Promise.resolve(),
    ])
    handleSuccessfulLiveRefresh(servicesStore.items)
  } catch (error) {
    const refreshErrorMessage = messageFrom(error, t('dashboard.console.errors.liveRefreshFailed'))
    markUnhealthyLiveRefreshCycle(servicesStore.items, 'error', { errorMessage: refreshErrorMessage })
    errorMessage.value = refreshErrorMessage
  } finally {
    refreshingLiveData.value = false
  }
}

const startLiveRefresh = () => {
  liveRefreshTimer = setInterval(() => {
    void refreshLiveData()
  }, liveRefreshIntervalMs)
}

const openOverview = () => {
  if (route.name === 'dashboard') {
    panelMode.value = 'overview'
    manualTest.value = null
    selectedServiceSlug.value = ''
    selectedUptimeSummary.value = null
    errorMessage.value = ''
    return
  }

  void router.push({ name: 'dashboard' }).catch(() => {})
}

const selectService = (slug: string) => {
  panelMode.value = 'service'
  manualTest.value = null
  selectedServiceSlug.value = slug

  if (route.name === 'dashboard-service-detail' && route.params.slug === slug) {
    void loadServiceDetail(slug)
    return
  }

  void router.push({ name: 'dashboard-service-detail', params: { slug } }).catch(() => {})
}

const openCreate = () => {
  panelMode.value = 'create'
  manualTest.value = null

  if (route.name === 'dashboard-new') {
    resetForm()
    selectedServiceSlug.value = ''
    selectedUptimeSummary.value = null
    errorMessage.value = ''
    return
  }

  void router.push({ name: 'dashboard-new' }).catch(() => {})
}

const openIncidents = () => {
  panelMode.value = 'incidents'
  statusMessage.value = ''

  if (route.name === 'dashboard-incidents') {
    void fetchIncidentList()
    return
  }

  void router.push({ name: 'dashboard-incidents' }).catch(() => {})
}

const createService = async () => {
  creating.value = true

  try {
    const service = await servicesStore.createService(toPayload())
    establishResponseTimeBaselines(servicesStore.items)
    await loadTimeline24h()
    statusMessage.value = t('dashboard.console.messages.created')
    errorMessage.value = ''
    void router.push({ name: 'dashboard-service-detail', params: { slug: service.slug } }).catch(() => {})
  } catch (error) {
    errorMessage.value = messageFrom(error, t('dashboard.console.errors.createFailed'))
  } finally {
    creating.value = false
  }
}

const saveService = async () => {
  if (!selectedServiceSlug.value) {
    return
  }

  const previousSlug = selectedServiceSlug.value
  saving.value = true

  try {
    const service = await servicesStore.updateService(selectedServiceSlug.value, toPayload())
    moveResponseTimeHistory(previousSlug, service.slug)
    resetForm(service)
    await Promise.all([loadServiceDetail(service.slug, { syncForm: false }), loadTimeline24h()])
    statusMessage.value = t('dashboard.console.messages.updated')
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = messageFrom(error, t('dashboard.console.errors.saveFailed'))
  } finally {
    saving.value = false
  }
}

const runTest = async () => {
  if (!selectedServiceSlug.value) {
    return
  }

  testing.value = true

  try {
    manualTest.value = await servicesStore.runTest(selectedServiceSlug.value)
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = messageFrom(error, t('dashboard.console.errors.testFailed'))
  } finally {
    testing.value = false
  }
}

const removeService = async () => {
  if (!selectedServiceSlug.value || !confirm(t('dashboard.console.messages.deleteConfirm'))) {
    return
  }

  deleting.value = true

  try {
    const slugToDelete = selectedServiceSlug.value
    await servicesStore.deleteService(slugToDelete)
    dropResponseTimeHistory(slugToDelete)
    establishResponseTimeBaselines(servicesStore.items)
    selectedUptimeSummary.value = null
    manualTest.value = null
    await loadTimeline24h()

    const nextSlug = servicesStore.items[0]?.slug ?? ''

    statusMessage.value = t('dashboard.console.messages.deleted')
    errorMessage.value = ''

    if (nextSlug) {
      void router.push({ name: 'dashboard-service-detail', params: { slug: nextSlug } }).catch(() => {})
      return
    }

    void router.push({ name: 'dashboard' }).catch(() => {})
  } catch (error) {
    errorMessage.value = messageFrom(error, t('dashboard.console.errors.deleteFailed'))
  } finally {
    deleting.value = false
  }
}

const currentStateCard = computed(() => {
  if (!activeService.value) {
    return {
      state: 'idle',
      value: t('dashboard.console.noSignal'),
      detail: t('dashboard.console.uptimeNoChecks'),
    }
  }

  if (!activeService.value.enabled) {
    return {
      state: 'paused',
      value: t('dashboard.console.paused'),
      detail: t('dashboard.console.disabledMonitor'),
    }
  }

  if (!activeService.value.runtime.lastCheckAt) {
    return {
      state: 'idle',
      value: t('dashboard.console.noSignal'),
      detail: t('dashboard.console.uptimeNoChecks'),
    }
  }

  const currentOk = !serviceIsDown(activeService.value)
  const startedAt = selectedUptimeSummary.value?.currentStateStartedAt
    ?? activeService.value.runtime.currentStateStartedAt
    ?? activeService.value.runtime.lastCheckAt
  const duration = formatDurationLong(Date.now() - new Date(startedAt).getTime())

  return {
    state: currentOk ? 'up' : 'down',
    value: duration,
    detail: currentOk
      ? t('dashboard.console.upSinceDate', { date: formatDate(startedAt) })
      : t('dashboard.console.downSinceDate', { date: formatDate(startedAt) }),
  }
})

const lastIncidentCard = computed(() => {
  const lastIncident = selectedUptimeSummary.value?.lastIncident

  if (!lastIncident) {
    return {
      value: t('dashboard.console.never'),
      detail: t('dashboard.console.uptimeNoChecks'),
    }
  }

  const endedAt = lastIncident.resolvedAt ?? new Date().toISOString()
  const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(lastIncident.startedAt).getTime())

  return {
    value: formatDate(lastIncident.startedAt),
    detail: t('dashboard.console.lastIncidentDuration', {
      duration: formatDurationLong(durationMs),
    }),
  }
})

const uptime24hStat = computed(() => {
  return buildUptimeStat(t('dashboard.console.last24Hours'), 1)
})

const uptimeWindowStats = computed(() => {
  return [
    buildUptimeStat(t('dashboard.console.lastDays', { days: 7 }), 7),
    buildUptimeStat(t('dashboard.console.lastDays', { days: 30 }), 30),
    buildUptimeStat(t('dashboard.console.lastDays', { days: 365 }), 365),
    buildUptimeStat(t('dashboard.console.lastTwoYears'), 730),
  ]
})

watch(
  () => form.type,
  (next, previous) => {
    if (next === previous) {
      return
    }

    if (next === 'TCP') {
      if (form.target === 'https://') {
        form.target = ''
      }

      return
    }

    if (!form.target) {
      form.target = 'https://'
    }
  },
)

watch(
  () => orderedServices.value.map((service) => `${service.slug}:${service.runtime.lastCheckAt ?? ''}:${service.runtime.lastResponseTimeMs ?? ''}:${service.runtime.lastFailureMessage ?? ''}`).join('|'),
  () => {
    if (!responseTimeChartsEnabled.value) {
      void syncCollapsedOverviewCardHeights()
    }
  },
)

watch(responseTimeChartsEnabled, (enabled) => {
  if (!enabled) {
    void syncCollapsedOverviewCardHeights()
  }
})

watch(statusMessage, (message) => {
  if (statusMessageTimer) {
    clearTimeout(statusMessageTimer)
    statusMessageTimer = undefined
  }

  if (!message) {
    return
  }

  statusMessageTimer = setTimeout(() => {
    statusMessage.value = ''
  }, TOAST_DURATION_MS)
})

watch(errorMessage, (message) => {
  if (errorMessageTimer) {
    clearTimeout(errorMessageTimer)
    errorMessageTimer = undefined
  }

  if (!message) {
    return
  }

  errorMessageTimer = setTimeout(() => {
    errorMessage.value = ''
  }, TOAST_DURATION_MS)
})

watch(
  () => route.fullPath,
  () => {
    void applyRouteIntent()
  },
)

onMounted(async () => {
  const storedTheme = localStorage.getItem('bea-uptime-theme')
  if (storedTheme === 'light' || storedTheme === 'dark') {
    theme.value = storedTheme
  } else {
    theme.value = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  await bootstrap()
  await applyRouteIntent()
  startLiveRefresh()
})

onUnmounted(() => {
  if (liveRefreshTimer) {
    clearInterval(liveRefreshTimer)
  }

  if (statusMessageTimer) {
    clearTimeout(statusMessageTimer)
  }

  if (errorMessageTimer) {
    clearTimeout(errorMessageTimer)
  }
})
</script>

<template>
  <div class="dashboard-shell">
    <header class="dashboard-header">
      <div class="dashboard-header__inner">
        <button class="brand-button" type="button" @click="openOverview">
          <AppMark class="brand-logo" />
          <span>{{ $t('app.name') }}</span>
        </button>

        <div class="dashboard-header__refresh" :class="{ 'is-critical': isDashboardRefreshCritical }" :title="dashboardRefreshTooltip">
          <strong>{{ formatRefreshTimestamp(lastSuccessfulDashboardDataAt) }}</strong>
        </div>

        <div class="dashboard-header__actions">
          <button class="header-action" :class="{ 'is-active': panelMode === 'create' }" type="button" @click="openCreate">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>{{ $t('dashboard.console.newService') }}</span>
          </button>

          <button class="header-action" :class="{ 'is-active': panelMode === 'incidents' }" type="button" @click="openIncidents">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            <span>{{ $t('nav.incidents') }}</span>
          </button>

          <label class="header-switch" :class="{ 'is-active': responseTimeChartsEnabled }">
            <input :checked="responseTimeChartsEnabled" type="checkbox" @change="toggleResponseTimeCharts" />
            <span class="header-switch__control" aria-hidden="true">
              <span class="header-switch__thumb"></span>
            </span>
            <span class="header-switch__label">{{ $t('dashboard.console.responseTimeCharts') }}</span>
          </label>

          <button class="icon-btn" type="button" :title="$t('dashboard.console.toggleTheme')" @click="toggleTheme">
            <svg v-if="theme === 'light'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
          </button>

          <button class="icon-btn" type="button" :title="$t('app.shell.logout')" @click="handleLogout">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          </button>
        </div>
      </div>
    </header>

    <div class="dashboard-body" :class="{ 'dashboard-body--detail': showDetailSidebar }">
      <aside v-if="showDetailSidebar" class="detail-sidebar">
        <div class="detail-sidebar__panel shell-card">
          <div class="detail-sidebar__header">
            <span class="eyebrow">{{ $t('nav.services') }}</span>
            <span class="health-chip" :class="downServicesCount > 0 ? 'is-down' : 'is-up'">
              {{ downServicesCount > 0 ? $t('dashboard.console.failureCount', { count: downServicesCount }) : $t('dashboard.console.allOnline') }}
            </span>
          </div>

          <div class="detail-sidebar__list" v-if="!loadingBootstrap && !servicesStore.loading">
            <button
              v-for="service in orderedServices"
              :key="service.id"
              class="service-nav-card"
              :class="[`is-${serviceState(service)}`, { 'is-active': selectedServiceSlug === service.slug }]"
              type="button"
              @click="selectService(service.slug)"
            >
              <div class="service-info">
                <span class="status-dot"></span>
                <div class="service-text">
                  <strong>{{ service.name }}</strong>
                  <span>{{ formatServiceTarget(service) }}</span>
                </div>
              </div>

              <div class="service-checks">
                <span
                  v-for="bar in serviceCheckBars(service)"
                  :key="bar.id"
                  class="check-stripe"
                  :class="bar.status === 'down' ? 'is-fail' : bar.status === 'up' ? 'is-ok' : 'is-empty'"
                  :title="bar.title"
                ></span>
              </div>

              <div v-if="service.runtime.lastCheckAt" class="service-nav-card__footer">
                <span class="meta-date">{{ formatDate(service.runtime.lastCheckAt) }}</span>
                <span class="meta-latency">{{ formatLatency(service.runtime.lastResponseTimeMs) }}</span>
              </div>
            </button>
          </div>

          <div v-else class="empty-state empty-state--compact">
            {{ $t('dashboard.console.loading') }}
          </div>
        </div>
      </aside>

      <main class="dashboard-main">
        <div class="dashboard-content">
          <div v-if="loadingBootstrap && servicesStore.items.length === 0" class="shell-card empty-state empty-state--large">
            {{ $t('dashboard.console.loading') }}
          </div>

          <template v-else>
            <template v-if="panelMode === 'overview'">
              <section v-if="orderedServices.length > 0" class="service-grid">
                <article
                  v-for="service in orderedServices"
                  :key="service.id"
                  :data-overview-service-card="service.slug"
                  class="overview-service-card shell-card"
                  :class="[`is-${serviceState(service)}`, { 'overview-service-card--expanded': responseTimeChartsEnabled }]"
                  :style="overviewCardStyle(service.slug)"
                  role="button"
                  tabindex="0"
                  @click="selectService(service.slug)"
                  @keydown.enter.prevent="selectService(service.slug)"
                  @keydown.space.prevent="selectService(service.slug)"
                >
                  <div class="overview-service-card__head">
                    <div class="overview-service-card__titles">
                      <h2>{{ service.name }}</h2>
                      <a
                        v-if="service.type === 'GET'"
                        :href="service.target"
                        class="service-target-link"
                        target="_blank"
                        rel="noreferrer"
                        @click.stop
                      >
                        {{ formatServiceTarget(service) }}
                      </a>
                      <span v-else class="service-target-link">{{ formatServiceTarget(service) }}</span>
                    </div>

                    <div class="service-badge" :class="`is-${serviceState(service)}`">
                      {{ serviceStateLabel(service) }}
                    </div>
                  </div>

                  <div class="signal-bars signal-bars--overview">
                    <span
                      v-for="bar in overviewSignalBars(service)"
                      :key="bar.id"
                      class="signal-bar"
                      :class="bar.status === 'down' ? 'is-fail' : bar.status === 'up' ? 'is-ok' : 'is-empty'"
                      :title="bar.title"
                    ></span>
                  </div>

                  <div class="service-metrics-row">
                    <div class="check-metric">
                      <span>{{ $t('dashboard.console.lastCheck') }}</span>
                      <strong>{{ formatRelativeTime(service.runtime.lastCheckAt) }}</strong>
                    </div>

                    <div class="check-metric check-metric--right">
                      <span>{{ $t('dashboard.console.responseTime') }}</span>
                      <strong>{{ formatLatency(service.runtime.lastResponseTimeMs) }}</strong>
                    </div>
                  </div>

                  <p v-if="service.runtime.lastFailureMessage" class="probe-failure-message probe-failure-message--compact">
                    <span>{{ $t('dashboard.console.lastFailureMessage') }}</span>
                    <strong>{{ service.runtime.lastFailureMessage }}</strong>
                  </p>

                  <section
                    v-if="responseTimeChartsEnabled"
                    class="response-time-chart"
                    :aria-label="$t('dashboard.console.responseTimeChartLabel', { service: service.name })"
                  >
                    <div class="response-time-chart__plot">
                      <svg class="response-time-chart__svg" :viewBox="responseTimeChartViewBox" preserveAspectRatio="none" role="img">
                        <title>{{ $t('dashboard.console.responseTimeChartLabel', { service: service.name }) }}</title>
                        <line
                          v-for="gridY in responseTimeChartGridYs"
                          :key="`${service.slug}-grid-${gridY}`"
                          class="response-time-chart__grid"
                          :x1="RESPONSE_TIME_CHART_PLOT_START_X"
                          :x2="RESPONSE_TIME_CHART_PLOT_END_X"
                          :y1="gridY"
                          :y2="gridY"
                        />
                        <text
                          v-for="tick in responseTimeChartFor(service.slug)?.yAxisTicks ?? []"
                          :key="`${service.slug}-tick-${tick.y}`"
                          class="response-time-chart__y-axis-label"
                          :x="RESPONSE_TIME_CHART_PLOT_START_X - 2"
                          :y="tick.y"
                          text-anchor="end"
                        >
                          {{ tick.label }}
                        </text>
                        <line
                          class="response-time-chart__baseline"
                          :x1="RESPONSE_TIME_CHART_PLOT_START_X"
                          :x2="RESPONSE_TIME_CHART_PLOT_END_X"
                          :y1="56"
                          :y2="56"
                        />
                        <path
                          v-for="(path, index) in responseTimeChartFor(service.slug)?.linePaths ?? []"
                          :key="`${service.slug}-line-${index}`"
                          class="response-time-chart__line"
                          :d="path"
                        />
                      </svg>
                    </div>

                    <div class="response-time-chart__axis">
                      <span>{{ responseTimeChartFor(service.slug)?.startLabel }}</span>
                      <span>{{ responseTimeChartFor(service.slug)?.endLabel }}</span>
                    </div>
                  </section>
                </article>
              </section>

              <section v-else class="shell-card empty-state empty-state--large">
                <h2>{{ $t('dashboard.console.emptyServices') }}</h2>
                <p>{{ $t('services.empty') }}</p>
                <div class="empty-state__actions">
                  <BaseButton type="button" @click="openCreate">{{ $t('dashboard.console.newService') }}</BaseButton>
                </div>
              </section>
            </template>

            <template v-else-if="panelMode === 'create'">
              <section class="page-header shell-card">
                <span class="eyebrow">{{ $t('dashboard.console.newService') }}</span>
                <h1>{{ $t('dashboard.console.addServiceTitle') }}</h1>
                <p>{{ $t('dashboard.console.addServiceDescription') }}</p>
              </section>

              <form class="shell-card form-card" @submit.prevent="createService">
                <div class="form-layout">
                  <div class="input-group">
                    <label>{{ $t('dashboard.console.serviceName') }}</label>
                    <input v-model="form.name" type="text" required :placeholder="$t('dashboard.console.serviceNamePlaceholder')" />
                  </div>

                  <div class="input-group">
                    <label>{{ targetFieldLabel }}</label>
                    <input v-model="form.target" :type="targetFieldInputType" required :placeholder="targetFieldPlaceholder" />
                  </div>

                  <div class="form-row">
                    <div class="input-group">
                      <label>{{ $t('services.fields.type') }}</label>
                      <select v-model="form.type">
                        <option value="GET">GET</option>
                        <option value="TCP">TCP</option>
                      </select>
                    </div>

                    <div v-if="!formUsesTcp" class="input-group">
                      <label>{{ $t('services.fields.expectedStatus') }}</label>
                      <input v-model.number="form.expectedStatus" type="number" required min="100" max="599" />
                    </div>

                    <div v-else class="input-group">
                      <label>{{ $t('services.fields.port') }}</label>
                      <input v-model.number="form.port" type="number" required min="1" max="65535" />
                    </div>

                    <div class="input-group">
                      <label>{{ $t('services.fields.timeoutMs') }}</label>
                      <input v-model.number="form.timeoutMs" type="number" step="500" required />
                    </div>
                  </div>

                  <label class="toggle-row">
                    <input v-model="form.enabled" type="checkbox" />
                    <span>{{ $t('dashboard.console.enableImmediately') }}</span>
                  </label>

                  <div class="form-actions">
                    <BaseButton type="submit" :disabled="creating">
                      {{ creating ? $t('dashboard.console.creating') : $t('dashboard.console.createService') }}
                    </BaseButton>
                  </div>
                </div>
              </form>
            </template>

            <template v-else-if="panelMode === 'incidents'">
              <section class="page-header shell-card">
                <span class="eyebrow">{{ $t('nav.incidents') }}</span>
                <h1>{{ $t('dashboard.console.incidentHistoryTitle') }}</h1>
                <p>{{ $t('dashboard.console.incidentHistoryDescription') }}</p>
              </section>

              <form class="filter-row shell-card" @submit.prevent="fetchIncidentList">
                <div class="input-group">
                  <label>{{ $t('incidents.fields.service') }}</label>
                  <select v-model="incidentFilters.serviceId">
                    <option value="">{{ $t('dashboard.console.allServices') }}</option>
                    <option v-for="service in servicesStore.items" :key="service.id" :value="String(service.id)">
                      {{ service.name }}
                    </option>
                  </select>
                </div>

                <div class="input-group">
                  <label>{{ $t('incidents.fields.status') }}</label>
                  <select v-model="incidentFilters.status">
                    <option value="">{{ $t('dashboard.console.anyStatus') }}</option>
                    <option value="open">{{ $t('incidents.status.open') }}</option>
                    <option value="resolved">{{ $t('incidents.status.resolved') }}</option>
                  </select>
                </div>

                <div class="filter-btns">
                  <BaseButton type="submit">{{ $t('dashboard.console.filter') }}</BaseButton>
                  <BaseButton type="button" variant="ghost" @click="clearIncidentFilters">{{ $t('dashboard.console.clear') }}</BaseButton>
                </div>
              </form>

              <div class="incidents-list">
                <div v-if="incidentsStore.loading" class="shell-card empty-state empty-state--compact">
                  {{ $t('dashboard.console.loadingIncidents') }}
                </div>

                <div v-else-if="incidentsStore.items.length === 0" class="shell-card empty-state empty-state--compact">
                  {{ $t('dashboard.console.noIncidents') }}
                </div>

                <article v-for="incident in incidentsStore.items" :key="incident.id" class="incident-card shell-card" :class="incident.status">
                  <div class="incident-info">
                    <span class="indicator"></span>
                    <div>
                      <h2>{{ incident.serviceName }}</h2>
                      <p>{{ incident.failureMessage || $t('dashboard.console.unknownFailure') }}</p>
                    </div>
                  </div>

                  <div class="incident-meta">
                    <span class="status-tag">
                      {{ incident.status === 'open' ? $t('dashboard.console.ongoing') : $t('incidents.status.resolved') }}
                    </span>
                    <small>
                      {{ formatDate(incident.startedAt) }}
                      <span v-if="incident.resolvedAt">→ {{ formatDate(incident.resolvedAt) }}</span>
                    </small>
                  </div>
                </article>
              </div>
            </template>

            <template v-else-if="activeService">
              <section class="service-focus shell-card">
                <div class="service-focus__head">
                  <div class="service-focus__titles">
                    <h1>{{ activeService.name }}</h1>
                    <a
                      v-if="activeService.type === 'GET'"
                      :href="activeService.target"
                      class="service-target-link"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {{ formatServiceTarget(activeService) }}
                    </a>
                    <span v-else class="service-target-link">{{ formatServiceTarget(activeService) }}</span>
                  </div>

                  <div class="service-badge" :class="`is-${serviceState(activeService)}`">
                    {{ serviceStateLabel(activeService) }}
                  </div>
                </div>

                <div class="signal-bars signal-bars--focus">
                  <span
                    v-for="bar in selectedSignalBars"
                    :key="bar.id"
                    class="signal-bar"
                    :class="bar.status === 'down' ? 'is-fail' : bar.status === 'up' ? 'is-ok' : 'is-empty'"
                    :title="bar.title"
                  ></span>
                </div>

                <div class="service-metrics-row service-metrics-row--focus">
                  <div class="check-metric">
                    <span>{{ $t('dashboard.console.lastCheck') }}</span>
                    <strong>{{ formatRelativeTime(activeService.runtime.lastCheckAt) }}</strong>
                  </div>

                  <div class="check-metric check-metric--right">
                    <span>{{ $t('dashboard.console.responseTime') }}</span>
                    <strong>{{ formatLatency(activeService.runtime.lastResponseTimeMs) }}</strong>
                  </div>
                </div>

                <p v-if="activeService.runtime.lastFailureMessage" class="probe-failure-message">
                  <span>{{ $t('dashboard.console.lastFailureMessage') }}</span>
                  <strong>{{ activeService.runtime.lastFailureMessage }}</strong>
                </p>

              </section>

              <section class="service-health-grid" :aria-label="$t('dashboard.console.serviceHealthLabel')">
                <article class="health-card shell-card">
                  <span class="health-card__label">{{ $t('dashboard.console.upTime') }}</span>
                  <strong class="health-card__value" :class="`is-${currentStateCard.state}`">{{ currentStateCard.value }}</strong>
                  <small>{{ currentStateCard.detail }}</small>
                </article>

                <article class="health-card shell-card">
                  <span class="health-card__label">{{ $t('dashboard.console.lastIncidentLabel') }}</span>
                  <strong class="health-card__value health-card__value--compact">{{ lastIncidentCard.value }}</strong>
                  <small>{{ lastIncidentCard.detail }}</small>
                </article>

                <article class="health-card health-card--top shell-card">
                  <div class="health-card__header">
                    <span class="health-card__label">{{ $t('dashboard.console.last24Hours') }}</span>
                    <strong>{{ uptime24hStat.percent }}</strong>
                  </div>

                  <div class="mini-check-bars">
                    <span
                      v-for="bar in recentTimelineBars"
                      :key="bar.id"
                      class="mini-check-bar"
                      :class="bar.status === 'down' ? 'is-fail' : bar.status === 'up' ? 'is-ok' : 'is-empty'"
                      :title="bar.title"
                    ></span>
                  </div>

                  <small>{{ uptime24hStat.detail }}</small>
                </article>
              </section>

              <section class="uptime-stats-card shell-card" :aria-label="$t('dashboard.console.uptimeStatsLabel')">
                <h2>{{ $t('dashboard.console.uptimeStatsTitle') }}</h2>
                <div class="uptime-stats-grid">
                  <article v-for="stat in uptimeWindowStats" :key="stat.label" class="uptime-stat-item">
                    <span>{{ stat.label }}</span>
                    <strong>{{ stat.percent }}</strong>
                    <small>{{ stat.detail }}</small>
                  </article>
                </div>
              </section>

              <section
                class="detail-response-time-card shell-card"
                :aria-label="$t('dashboard.console.responseTimeChartLabel', { service: activeService.name })"
              >
                <div class="response-time-chart response-time-chart--detail-card">
                  <div class="response-time-chart__plot response-time-chart__plot--detail-card">
                    <svg class="response-time-chart__svg" :viewBox="responseTimeChartViewBox" preserveAspectRatio="none" role="img">
                      <title>{{ $t('dashboard.console.responseTimeChartLabel', { service: activeService.name }) }}</title>
                      <line
                        v-for="gridY in responseTimeChartGridYs"
                        :key="`${activeService.slug}-detail-grid-${gridY}`"
                        class="response-time-chart__grid"
                        :x1="RESPONSE_TIME_CHART_PLOT_START_X"
                        :x2="RESPONSE_TIME_CHART_PLOT_END_X"
                        :y1="gridY"
                        :y2="gridY"
                      />
                      <text
                        v-for="tick in activeResponseTimeChart?.yAxisTicks ?? []"
                        :key="`${activeService.slug}-detail-tick-${tick.y}`"
                        class="response-time-chart__y-axis-label"
                        :x="RESPONSE_TIME_CHART_PLOT_START_X - 2"
                        :y="tick.y"
                        text-anchor="end"
                      >
                        {{ tick.label }}
                      </text>
                      <line
                        class="response-time-chart__baseline"
                        :x1="RESPONSE_TIME_CHART_PLOT_START_X"
                        :x2="RESPONSE_TIME_CHART_PLOT_END_X"
                        :y1="56"
                        :y2="56"
                      />
                      <path
                        v-for="(path, index) in activeResponseTimeChart?.linePaths ?? []"
                        :key="`${activeService.slug}-detail-line-${index}`"
                        class="response-time-chart__line"
                        :d="path"
                      />
                    </svg>
                  </div>

                  <div class="response-time-chart__axis">
                    <span>{{ activeResponseTimeChart?.startLabel }}</span>
                    <span>{{ activeResponseTimeChart?.endLabel }}</span>
                  </div>
                </div>
              </section>

              <form class="shell-card form-card" @submit.prevent="saveService">
                <div class="form-card__head">
                  <h2>{{ $t('dashboard.console.serviceSettings') }}</h2>
                  <p>{{ loadingDetail ? $t('dashboard.console.loading') : formatDate(activeService.runtime.lastCheckAt) }}</p>
                </div>

                <div class="form-layout">
                  <div class="input-group">
                    <label>{{ $t('services.fields.name') }}</label>
                    <input v-model="form.name" type="text" required />
                  </div>

                  <div class="input-group">
                    <label>{{ targetFieldLabel }}</label>
                    <input v-model="form.target" :type="targetFieldInputType" required :placeholder="targetFieldPlaceholder" />
                  </div>

                  <div class="form-row">
                    <div class="input-group">
                      <label>{{ $t('services.fields.type') }}</label>
                      <select v-model="form.type">
                        <option value="GET">GET</option>
                        <option value="TCP">TCP</option>
                      </select>
                    </div>

                    <div v-if="!formUsesTcp" class="input-group">
                      <label>{{ $t('services.fields.expectedStatus') }}</label>
                      <input v-model.number="form.expectedStatus" type="number" required min="100" max="599" />
                    </div>

                    <div v-else class="input-group">
                      <label>{{ $t('services.fields.port') }}</label>
                      <input v-model.number="form.port" type="number" required min="1" max="65535" />
                    </div>

                    <div class="input-group">
                      <label>{{ $t('services.fields.timeoutMs') }}</label>
                      <input v-model.number="form.timeoutMs" type="number" step="500" required />
                    </div>
                  </div>

                  <label class="toggle-row">
                    <input v-model="form.enabled" type="checkbox" />
                    <span>{{ $t('dashboard.console.enableMonitoring') }}</span>
                  </label>

                  <div class="form-actions form-actions--between">
                    <div class="left-actions">
                      <BaseButton type="button" variant="ghost" :disabled="testing || loadingDetail" @click="runTest">
                        {{ testing ? $t('dashboard.console.testing') : $t('dashboard.console.testNow') }}
                      </BaseButton>

                      <BaseButton type="submit" :disabled="saving || loadingDetail">
                        {{ saving ? $t('dashboard.console.saving') : $t('dashboard.console.saveChanges') }}
                      </BaseButton>
                    </div>

                    <button class="danger-btn" type="button" :disabled="deleting" @click="removeService">
                      {{ deleting ? $t('dashboard.console.deleting') : $t('dashboard.console.deleteService') }}
                    </button>
                  </div>
                </div>
              </form>

              <p v-if="manualTest" class="test-result" :class="manualTest.ok ? 'is-ok' : 'is-fail'">
                {{ manualTest.ok ? $t('dashboard.console.testOk', { latency: manualTest.responseTimeMs ?? 0 }) : manualTest.failureMessage }}
              </p>
            </template>

            <section v-else class="shell-card empty-state empty-state--large">
              <h2>{{ $t('dashboard.console.noServiceSelected') }}</h2>
              <p>{{ $t('services.empty') }}</p>
              <div class="empty-state__actions">
                <BaseButton type="button" @click="openOverview">{{ $t('nav.dashboard') }}</BaseButton>
              </div>
            </section>
          </template>
        </div>
      </main>
    </div>

    <div class="toasts">
      <div v-if="statusMessage" class="toast success">{{ statusMessage }}</div>
      <div v-if="errorMessage" class="toast error">{{ errorMessage }}</div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-shell {
  min-height: 100vh;
  background: radial-gradient(circle at top, rgba(59, 130, 246, 0.08), transparent 22%), var(--page-bg);
  color: var(--text);
}

.dashboard-header {
  position: sticky;
  top: 0;
  z-index: 30;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--page-bg) 88%, transparent);
  backdrop-filter: blur(18px);
  overflow-x: auto;
  scrollbar-width: none;
}

.dashboard-header::-webkit-scrollbar {
  display: none;
}

.dashboard-header__inner {
  width: max-content;
  min-width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  padding: 6px 24px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

.brand-button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  color: var(--text-soft);
  font-size: clamp(1.3rem, 2.3vw, 1.8rem);
  font-weight: 800;
  letter-spacing: -0.04em;
  cursor: pointer;
  white-space: nowrap;
}

.brand-logo {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
}

.dashboard-header__actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: nowrap;
}

.header-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  box-shadow: var(--shadow);
  transition: border-color 180ms ease, background-color 180ms ease, color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
}

.header-switch:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}

.header-switch.is-active {
  border-color: color-mix(in srgb, var(--accent) 68%, var(--border));
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent-soft) 88%, var(--surface)), var(--surface));
}

.header-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.header-switch__control {
  position: relative;
  width: 34px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border) 78%, var(--surface));
  transition: background-color 180ms ease;
}

.header-switch.is-active .header-switch__control {
  background: color-mix(in srgb, var(--accent) 60%, var(--surface));
}

.header-switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--surface);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.16);
  transition: transform 180ms ease;
}

.header-switch.is-active .header-switch__thumb {
  transform: translateX(14px);
}

.header-switch__label {
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
}

.dashboard-header__refresh {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-width: 180px;
  padding: 0;
  min-height: 0;
  text-align: center;
  align-self: center;
  justify-content: center;
  flex: 0 0 180px;
}

.dashboard-header__refresh::before,
.dashboard-header__refresh::after {
  content: '';
  width: 18px;
  height: 1px;
  background: color-mix(in srgb, var(--text-faint) 55%, transparent);
}

.dashboard-header__refresh.is-critical::before,
.dashboard-header__refresh.is-critical::after {
  background: color-mix(in srgb, var(--danger) 55%, transparent);
}

.dashboard-header__refresh strong {
  font-size: clamp(1.3rem, 2.3vw, 1.8rem);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--text);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.dashboard-header__refresh.is-critical strong {
  color: var(--danger);
}

.header-action,
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  transition: transform 180ms ease, border-color 180ms ease, background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
}

.header-action:hover,
.icon-btn:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}

.header-action {
  padding: 0 12px;
  font-weight: 700;
  font-size: 0.9rem;
  box-shadow: var(--shadow);
  white-space: nowrap;
  min-width: 0;
}

.header-action span {
  min-width: 0;
}

.header-action.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.icon-btn {
  width: 38px;
  padding: 0;
  flex: 0 0 auto;
}

.header-action:disabled,
.icon-btn:disabled,
.service-nav-card:disabled,
.danger-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  transform: none;
}

.dashboard-body {
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  padding: 8px 24px 2px;
}

.dashboard-body--detail {
  display: grid;
  grid-template-columns: minmax(270px, 320px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.dashboard-main {
  min-width: 0;
}

.dashboard-content {
  display: grid;
  gap: 18px;
}

.shell-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 24px;
  box-shadow: var(--shadow-lg);
}

.page-header {
  padding: 28px;
  display: grid;
  gap: 10px;
}

.page-header h1,
.service-focus__titles h1,
.empty-state h2 {
  margin: 0;
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  line-height: 1;
  letter-spacing: -0.04em;
}

.page-header p,
.empty-state p,
.form-card__head p {
  margin: 0;
  color: var(--text-soft);
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-faint);
}

.service-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 12px;
  row-gap: 10px;
  align-items: start;
}

.overview-service-card {
  --overview-card-height: 190px;
  padding: 13px 15px 11px;
  display: grid;
  gap: 11px;
  grid-template-rows: auto auto auto auto;
  overflow: hidden;
  cursor: pointer;
  transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
}

.overview-service-card--expanded {
  min-height: calc(var(--overview-card-height) * 2);
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
}

.overview-service-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
}

.overview-service-card:focus-visible {
  outline: 2px solid var(--accent-strong);
  outline-offset: 2px;
}

.overview-service-card.is-up,
.service-focus.is-up {
  background: linear-gradient(180deg, color-mix(in srgb, var(--success) 9%, var(--surface)), var(--surface) 42%);
}

.overview-service-card.is-down,
.service-focus.is-down {
  background: linear-gradient(180deg, color-mix(in srgb, var(--danger) 10%, var(--surface)), var(--surface) 42%);
}

.overview-service-card.is-paused,
.service-focus.is-paused,
.overview-service-card.is-idle,
.service-focus.is-idle {
  background: linear-gradient(180deg, color-mix(in srgb, var(--border) 14%, var(--surface)), var(--surface) 42%);
}

.overview-service-card__head,
.service-focus__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.overview-service-card__titles,
.service-focus__titles {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.overview-service-card__titles h2 {
  margin: 0;
  font-size: 1.38rem;
  line-height: 1.02;
  letter-spacing: -0.04em;
}

.service-target-link {
  color: var(--text-soft);
  text-decoration: underline;
  text-underline-offset: 3px;
  overflow-wrap: anywhere;
  font-size: 0.84rem;
  line-height: 1.2;
}

.service-target-link:hover {
  color: var(--text);
}

.service-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-weight: 800;
  font-size: 0.74rem;
  white-space: nowrap;
}

.service-badge.is-up,
.health-chip.is-up {
  background: color-mix(in srgb, var(--success) 18%, transparent);
  border-color: color-mix(in srgb, var(--success) 38%, transparent);
  color: var(--success);
}

.service-badge.is-down,
.health-chip.is-down {
  background: color-mix(in srgb, var(--danger) 18%, transparent);
  border-color: color-mix(in srgb, var(--danger) 38%, transparent);
  color: var(--danger);
}

.service-badge.is-paused,
.service-badge.is-idle {
  background: var(--surface-muted);
  border-color: var(--border);
  color: var(--text-soft);
}

.health-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.signal-bars {
  display: grid;
  grid-template-columns: repeat(30, minmax(0, 1fr));
  gap: 5px;
  align-items: end;
}

.signal-bars--overview {
  min-height: 42px;
  gap: 4px;
}

.signal-bars--focus {
  min-height: 72px;
}

.signal-bar {
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

.service-metrics-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--border);
}

.service-metrics-row--focus {
  margin-top: 4px;
}

.check-metric {
  display: grid;
  gap: 2px;
}

.check-metric--right {
  text-align: right;
  justify-items: end;
}

.check-metric span {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-soft);
}

.check-metric strong {
  font-size: 0.88rem;
  color: var(--text);
}

.probe-failure-message {
  display: grid;
  gap: 4px;
  margin: 0;
}

.probe-failure-message span {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-soft);
}

.probe-failure-message strong {
  color: var(--danger);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.probe-failure-message--compact strong {
  font-size: 0.86rem;
}

.service-focus {
  padding: 28px;
  display: grid;
  gap: 22px;
}

.response-time-chart {
  display: grid;
  grid-template-rows: 1fr auto;
  gap: 8px;
  min-height: 0;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.overview-service-card > .response-time-chart {
  grid-row: 5;
  align-self: stretch;
}

.response-time-chart--detail-card {
  padding-top: 0;
  border-top: 0;
}

.response-time-chart__plot {
  position: relative;
  min-height: 100px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--accent-soft) 32%, transparent), transparent 55%),
    color-mix(in srgb, var(--surface-muted) 82%, var(--surface));
  overflow: hidden;
}

.response-time-chart__plot--detail-card {
  min-height: 240px;
  max-height: 240px;
}

.response-time-chart__svg {
  display: block;
  width: 100%;
  height: 100%;
}

.response-time-chart__grid,
.response-time-chart__baseline {
  stroke: color-mix(in srgb, var(--border) 76%, transparent);
  stroke-width: 0.8;
}

.response-time-chart__baseline {
  stroke: color-mix(in srgb, var(--text-faint) 34%, transparent);
}

.response-time-chart__line {
  fill: none;
  stroke: var(--accent-strong);
  stroke-width: 1.1;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.response-time-chart__y-axis-label {
  fill: var(--text-faint);
  font-size: 3.2px;
  dominant-baseline: middle;
}

.response-time-chart__axis {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-faint);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.detail-response-time-card {
  padding: 18px 24px 16px;
}

.detail-sidebar {
  min-width: 0;
}

.detail-sidebar__panel {
  padding: 18px;
  display: grid;
  gap: 16px;
}

.detail-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.detail-sidebar__list {
  display: grid;
  gap: 10px;
}

.service-nav-card {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  display: grid;
  gap: 12px;
  text-align: left;
  cursor: pointer;
  transition: transform 180ms ease, border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease;
}

.service-nav-card:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}

.service-nav-card.is-active {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
  background: linear-gradient(180deg, var(--accent-soft), var(--surface) 54%);
}

.service-info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex: 0 0 auto;
  background: var(--text-faint);
}

.service-nav-card.is-up .status-dot {
  background: var(--success);
  box-shadow: 0 0 12px color-mix(in srgb, var(--success) 60%, transparent);
}

.service-nav-card.is-down .status-dot {
  background: var(--danger);
  box-shadow: 0 0 12px color-mix(in srgb, var(--danger) 60%, transparent);
}

.service-nav-card.is-paused .status-dot {
  background: var(--warning);
}

.service-text {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.service-text strong,
.service-text span,
.meta-date,
.meta-latency {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-text strong {
  color: var(--text);
  font-size: 0.96rem;
}

.service-text span,
.meta-date {
  color: var(--text-soft);
  font-size: 0.78rem;
}

.meta-latency {
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 700;
}

.service-checks {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 4px;
}

.check-stripe {
  display: block;
  width: 100%;
  min-width: 0;
  height: 22px;
  border-radius: 999px;
  background: var(--surface-muted);
}

.check-stripe.is-ok,
.mini-check-bar.is-ok {
  background: var(--success);
}

.check-stripe.is-fail,
.mini-check-bar.is-fail {
  background: var(--danger);
}

.check-stripe.is-empty,
.mini-check-bar.is-empty {
  background: color-mix(in srgb, var(--border) 65%, var(--surface));
}

.service-nav-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.service-health-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

.health-card {
  min-height: 170px;
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
}

.health-card--top {
  justify-content: flex-start;
}

.health-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.health-card__header strong,
.health-card__value,
.uptime-stat-item strong,
.command-metric strong {
  color: var(--text);
}

.health-card__label,
.uptime-stat-item span,
.command-metric span {
  color: var(--text-soft);
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.health-card__value {
  font-size: 1.6rem;
  line-height: 1.1;
}

.health-card__value.is-up,
.uptime-stat-item strong {
  color: var(--success);
}

.health-card__value.is-down {
  color: var(--danger);
}

.health-card__value.is-paused,
.health-card__value.is-idle {
  color: var(--text-soft);
}

.health-card__value--compact {
  font-size: 1.05rem;
  line-height: 1.4;
}

.health-card small,
.uptime-stat-item small {
  color: var(--text-soft);
}

.mini-check-bars {
  display: grid;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  gap: 4px;
}

.mini-check-bar {
  display: block;
  width: 100%;
  min-width: 0;
  height: 24px;
  border-radius: 999px;
  background: var(--surface-muted);
}

.uptime-stats-card {
  padding: 24px;
  display: grid;
  gap: 22px;
}

.uptime-stats-card h2,
.form-card__head h2 {
  margin: 0;
  font-size: 1.2rem;
}

.uptime-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
}

.uptime-stat-item {
  min-height: 128px;
  padding: 18px 20px;
  border-radius: 18px;
  background: var(--surface-muted);
  display: grid;
  align-content: start;
  gap: 8px;
}

.form-card {
  padding: 24px;
  display: grid;
  gap: 24px;
}

.form-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.form-layout {
  display: grid;
  gap: 24px;
}

.form-row,
.filter-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.filter-row {
  padding: 20px;
  align-items: end;
}

.filter-btns {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.input-group {
  display: grid;
  gap: 8px;
}

.input-group label {
  color: var(--text-soft);
  font-size: 0.84rem;
  font-weight: 700;
}

.input-group input,
.input-group select {
  width: 100%;
  min-height: 48px;
  padding: 0 16px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  transition: border-color 180ms ease, box-shadow 180ms ease;
}

.input-group input:focus,
.input-group select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  font-weight: 600;
}

.toggle-row input {
  width: 18px;
  height: 18px;
}

.form-actions {
  display: flex;
  align-items: center;
}

.form-actions--between {
  justify-content: space-between;
  gap: 16px;
}

.left-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.danger-btn {
  min-height: 44px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  color: var(--danger);
  font-weight: 700;
  cursor: pointer;
  transition: transform 180ms ease, background-color 180ms ease;
}

.danger-btn:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

.incidents-list {
  display: grid;
  gap: 16px;
}

.incident-card {
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.incident-info {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  min-width: 0;
}

.incident-info h2 {
  margin: 0 0 4px;
  font-size: 1.08rem;
}

.incident-info p {
  margin: 0;
  color: var(--text-soft);
  overflow-wrap: anywhere;
}

.indicator {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  margin-top: 6px;
  flex: 0 0 auto;
}

.incident-card.open .indicator {
  background: var(--danger);
  box-shadow: 0 0 10px color-mix(in srgb, var(--danger) 60%, transparent);
}

.incident-card.resolved .indicator {
  background: var(--success);
}

.incident-meta {
  display: grid;
  gap: 8px;
  justify-items: end;
  text-align: right;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: var(--surface-muted);
}

.incident-card.open .status-tag {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 16%, transparent);
}

.incident-card.resolved .status-tag {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 16%, transparent);
}

.empty-state {
  display: grid;
  gap: 10px;
  place-items: center;
  text-align: center;
  color: var(--text-soft);
}

.empty-state--large {
  padding: 56px 28px;
}

.empty-state--compact {
  padding: 24px;
}

.empty-state__actions {
  margin-top: 8px;
}

.test-result {
  margin: 0;
  padding: 16px 18px;
  border-radius: 18px;
  font-weight: 700;
  border: 1px solid currentColor;
}

.test-result.is-ok {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, transparent);
}

.test-result.is-fail {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.toasts {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.toast {
  min-width: min(420px, calc(100vw - 32px));
  padding: 14px 18px;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  border-left: 4px solid var(--accent);
  font-weight: 700;
}

.toast.success {
  border-color: var(--success);
  color: var(--success);
}

.toast.error {
  border-color: var(--danger);
  color: var(--danger);
}

@media (max-width: 1120px) {
  .dashboard-body--detail {
    grid-template-columns: 1fr;
  }

  .detail-sidebar {
    order: -1;
  }

  .service-health-grid,
  .uptime-stats-grid,
  .form-row,
  .filter-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 920px) {
  .service-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .dashboard-header {
    position: static;
    overflow-x: visible;
  }

  .dashboard-header__inner,
  .dashboard-body {
    padding-left: 16px;
    padding-right: 16px;
  }

  .dashboard-header__inner {
    width: 100%;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding-top: 8px;
    padding-bottom: 8px;
  }

  .brand-button {
    font-size: 1.18rem;
  }

  .brand-logo {
    width: 30px;
    height: 30px;
  }

  .dashboard-header__refresh {
    width: 100%;
    flex: 0 0 auto;
    justify-content: center;
    gap: 10px;
  }

  .dashboard-header__refresh::before,
  .dashboard-header__refresh::after {
    width: 14px;
  }

  .dashboard-header__refresh strong {
    white-space: normal;
    font-size: 1.18rem;
  }

  .dashboard-header__actions {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
  }

  .header-switch {
    grid-column: 1 / -1;
    justify-content: center;
    min-height: 44px;
    padding: 0 10px;
  }

  .header-switch__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-action {
    width: 100%;
    min-height: 44px;
    padding: 0 8px;
    font-size: 0.82rem;
  }

  .header-action span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .icon-btn {
    width: 100%;
    min-height: 44px;
    flex: 0 0 auto;
  }

  .page-header,
  .service-focus,
  .form-card,
  .uptime-stats-card,
  .detail-sidebar__panel {
    padding: 20px;
    border-radius: 20px;
  }

  .overview-service-card {
    --overview-card-height: 198px;
    padding: 15px 17px 13px;
    border-radius: 20px;
  }

  .overview-service-card--expanded {
    min-height: calc(var(--overview-card-height) * 2);
    grid-template-rows: auto auto auto auto minmax(0, 1fr);
  }

  .overview-service-card__head,
  .service-focus__head,
  .form-card__head,
  .incident-card,
  .form-actions--between {
    flex-direction: column;
    align-items: stretch;
  }

  .incident-meta {
    grid-template-columns: 1fr;
    justify-items: start;
    text-align: left;
  }

  .left-actions,
  .filter-btns {
    display: grid;
    grid-template-columns: 1fr;
  }

  .signal-bars {
    gap: 4px;
  }

  .signal-bars--overview,
  .signal-bars--focus {
    min-height: 52px;
  }

  .toasts {
    left: 16px;
    right: 16px;
    bottom: 16px;
  }

  .toast {
    min-width: 0;
  }
}
</style>
