export type ServiceType = 'GET' | 'TCP'

export type ServiceState = 'up' | 'down' | 'paused' | 'unknown'

export type ServiceRuntime = {
  status: ServiceState
  currentStateStartedAt: string | null
  lastCheckAt: string | null
  lastResponseTimeMs: number | null
  lastFailureMessage: string | null
}

export type ServiceListItem = {
  id: number
  slug: string
  name: string
  target: string
  type: ServiceType
  expectedStatus: number | null
  port: number | null
  timeoutMs: number
  enabled: boolean
  monitoringStartedAt: string
  runtime: ServiceRuntime
}

export type ServiceDetail = ServiceListItem

export type ServiceProbeRuntime = {
  currentStateStartedAt: string | null
  consecutiveFailures: number
  openIncidentId: number | null
}

export type ServiceProbeTarget = {
  id: number
  name: string
  target: string
  type: ServiceType
  expectedStatus: number | null
  port: number | null
  timeoutMs: number
  enabled: boolean
  runtime: ServiceProbeRuntime
}

export type ServiceProbeResult = {
  checkedAt: string
  ok: boolean
  responseTimeMs: number | null
  failureMessage: string | null
}

export type UpsertServiceInput = {
  name: string
  target: string
  timeoutMs?: number | null
  enabled: boolean
} & (
  | {
    type: 'GET'
    expectedStatus: number
  }
  | {
    type: 'TCP'
    port: number
  }
)

export type IncidentStatus = 'open' | 'resolved'

export type Incident = {
  id: number
  serviceId: number
  serviceName: string
  status: IncidentStatus
  startedAt: string
  resolvedAt: string | null
  failureMessage: string | null
}

export type MonitorSummary = {
  servicesCount: number
  enabledServicesCount: number
  openIncidentsCount: number
}

export type CleanupResult = {
  deletedResolvedIncidents: number
}

export type MonitorSweepResult = {
  totalServices: number
  successCount: number
  failureCount: number
}

export type ServiceUptimeWindow = {
  windowDays: number
  uptimePercentage: number | null
  downtimeMinutes: number
  incidentsCount: number
}

export type ServiceUptimeSummary = {
  currentStateStartedAt: string | null
  lastIncident: {
    startedAt: string
    resolvedAt: string | null
  } | null
  windows: ServiceUptimeWindow[]
}

export type ServiceTimelineIncident = {
  serviceId: number
  startedAt: string
  resolvedAt: string | null
}

export type ServiceTimeline24h = {
  generatedAt: string
  incidents: ServiceTimelineIncident[]
}

export type PublicStatusLevel = 'operational' | 'outage' | 'paused' | 'unknown'

export type PublicStatusCheckState = 'ok' | 'fail' | 'empty'

export type PublicStatusServiceSnapshot = {
  name: string
  status: PublicStatusLevel
  lastCheckedAt: string | null
  checks48h: PublicStatusCheckState[]
  uptimePercentage48h: number | null
}

export type PublicStatusIncident = {
  serviceName: string
  status: IncidentStatus
  startedAt: string
  resolvedAt: string | null
}

export type PublicStatusResponse = {
  generatedAt: string
  services: PublicStatusServiceSnapshot[]
  openIncidents: PublicStatusIncident[]
  recentIncidents: PublicStatusIncident[]
}
