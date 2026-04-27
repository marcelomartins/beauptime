import type { ServiceDetail, ServiceListItem, ServiceProbeResult, ServiceProbeRuntime, ServiceProbeTarget, ServiceRuntime, ServiceState, ServiceTimeline24h, ServiceUptimeSummary, ServiceUptimeWindow, UpsertServiceInput } from '@bea-uptime/contracts'
import { execute, nowIso, queryAll, queryFirst } from '@/lib/db'
import { listIncidentsOverlappingWindowByServiceId, listIncidentsOverlappingWindowByServiceIds } from '@/modules/incident/incident-repository'

type ServiceRow = {
  id: number
  slug: string
  name: string
  target: string
  type: string
  expected_status: number | null
  port: number | null
  timeout_ms: number
  enabled: number
  monitoring_started_at: string
  last_check_at: string | null
  last_check_ok: number | null
  last_check_response_time_ms: number | null
  last_check_failure_message: string | null
  current_state_started_at: string | null
  consecutive_failures: number
  first_failure_at: string | null
  open_incident_id: number | null
  created_at: string
  updated_at: string
}

type ServiceIdentityRow = {
  id: number
  slug: string
  name: string
}

const SERVICE_SELECT = `
  SELECT
    id,
    slug,
    name,
    target,
    type,
    expected_status,
    port,
    timeout_ms,
    enabled,
    monitoring_started_at,
    last_check_at,
    last_check_ok,
    last_check_response_time_ms,
    last_check_failure_message,
    current_state_started_at,
    consecutive_failures,
    first_failure_at,
    open_incident_id,
    created_at,
    updated_at
  FROM services
`

const reservedDashboardServiceSlugs = new Set(['new', 'incidents'])

const mapServiceType = (value: string): ServiceDetail['type'] => {
  return value === 'TCP' ? 'TCP' : 'GET'
}

const resolveStatus = (row: ServiceRow): ServiceState => {
  if (!row.enabled) {
    return 'paused'
  }

  if (!row.last_check_at) {
    return 'unknown'
  }

  if (row.open_incident_id || row.last_check_ok === 0) {
    return 'down'
  }

  return 'up'
}

const mapRuntime = (row: ServiceRow): ServiceRuntime => ({
  status: resolveStatus(row),
  currentStateStartedAt: row.current_state_started_at,
  lastCheckAt: row.last_check_at,
  lastResponseTimeMs: row.last_check_response_time_ms,
  lastFailureMessage: row.last_check_failure_message,
})

const mapProbeRuntime = (row: ServiceRow): ServiceProbeRuntime => ({
  currentStateStartedAt: row.current_state_started_at,
  consecutiveFailures: Number(row.consecutive_failures),
  openIncidentId: row.open_incident_id,
})

const mapService = (row: ServiceRow): ServiceListItem => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  target: row.target,
  type: mapServiceType(row.type),
  expectedStatus: row.expected_status,
  port: row.port,
  timeoutMs: row.timeout_ms,
  enabled: Boolean(row.enabled),
  monitoringStartedAt: row.monitoring_started_at,
  runtime: mapRuntime(row),
})

const slugifyServiceName = (name: string) => {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'service'
}

const createUniqueServiceSlug = async (db: D1Database, name: string) => {
  const baseSlug = slugifyServiceName(name)
  let slug = baseSlug
  let suffix = 2

  while (
    reservedDashboardServiceSlugs.has(slug)
    || await queryFirst<{ id: number }>(db.prepare('SELECT id FROM services WHERE slug = ?').bind(slug))
  ) {
    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }

  return slug
}

export const listServiceListItems = async (db: D1Database) => {
  const rows = await queryAll<ServiceRow>(db.prepare(`${SERVICE_SELECT} ORDER BY name COLLATE NOCASE ASC`))
  return rows.map(mapService)
}

export const listEnabledProbeTargets = async (db: D1Database) => {
  const rows = await queryAll<ServiceRow>(db.prepare(`${SERVICE_SELECT} WHERE enabled = 1 ORDER BY id ASC`))

  return rows.map((row): ServiceProbeTarget => ({
    id: row.id,
    name: row.name,
    target: row.target,
    type: mapServiceType(row.type),
    expectedStatus: row.expected_status,
    port: row.port,
    timeoutMs: row.timeout_ms,
    enabled: Boolean(row.enabled),
    runtime: mapProbeRuntime(row),
  }))
}

export const findServiceDetailBySlug = async (db: D1Database, slug: string) => {
  const row = await queryFirst<ServiceRow>(db.prepare(`${SERVICE_SELECT} WHERE slug = ?`).bind(slug))
  return row ? ({ ...mapService(row) } satisfies ServiceDetail) : null
}

export const findServiceIdentityBySlug = async (db: D1Database, slug: string) => {
  return queryFirst<ServiceIdentityRow>(db.prepare('SELECT id, slug, name FROM services WHERE slug = ?').bind(slug))
}

export const countServices = async (db: D1Database) => {
  const row = await queryFirst<{ total: number }>(db.prepare('SELECT COUNT(*) AS total FROM services'))
  return Number(row?.total ?? 0)
}

export const countEnabledServices = async (db: D1Database) => {
  const row = await queryFirst<{ total: number }>(db.prepare('SELECT COUNT(*) AS total FROM services WHERE enabled = 1'))
  return Number(row?.total ?? 0)
}

export const listAllServiceIds = async (db: D1Database) => {
  return queryAll<{ id: number }>(db.prepare('SELECT id FROM services ORDER BY id ASC'))
}

export const createService = async (db: D1Database, input: UpsertServiceInput & { timeoutMs: number }) => {
  const slug = await createUniqueServiceSlug(db, input.name)
  const timestamp = nowIso()

  await execute(
    db.prepare(
       `INSERT INTO services (
         slug,
         name,
         target,
         type,
         expected_status,
         port,
         timeout_ms,
         enabled,
         monitoring_started_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
     ).bind(
       slug,
       input.name,
       input.target,
       input.type,
       input.type === 'GET' ? input.expectedStatus : null,
       input.type === 'TCP' ? input.port : null,
       input.timeoutMs,
       input.enabled ? 1 : 0,
       timestamp,
      timestamp,
      timestamp,
    ),
  )

  return findServiceDetailBySlug(db, slug)
}

export const updateService = async (db: D1Database, id: number, input: UpsertServiceInput & { timeoutMs: number }) => {
  const currentRow = await queryFirst<ServiceRow>(db.prepare(`${SERVICE_SELECT} WHERE id = ?`).bind(id))

  if (!currentRow) {
    return null
  }

  const timestamp = nowIso()
  const reenabled = !Boolean(currentRow.enabled) && input.enabled
  const disabled = Boolean(currentRow.enabled) && !input.enabled
  const resetMonitoringState = reenabled
  const monitoringStartedAt = reenabled ? timestamp : currentRow.monitoring_started_at

  if (currentRow.open_incident_id && (reenabled || disabled)) {
    await execute(
      db.prepare('UPDATE incidents SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL').bind(timestamp, currentRow.open_incident_id),
    )
  }

  await execute(
    db.prepare(
      `UPDATE services
       SET
         name = ?,
         target = ?,
         type = ?,
         expected_status = ?,
         port = ?,
         timeout_ms = ?,
         enabled = ?,
         monitoring_started_at = ?,
         last_check_at = CASE WHEN ? THEN NULL ELSE last_check_at END,
         last_check_ok = CASE WHEN ? THEN NULL ELSE last_check_ok END,
         last_check_response_time_ms = CASE WHEN ? THEN NULL ELSE last_check_response_time_ms END,
         last_check_failure_message = CASE WHEN ? THEN NULL ELSE last_check_failure_message END,
         current_state_started_at = CASE WHEN ? THEN NULL ELSE current_state_started_at END,
         consecutive_failures = CASE WHEN ? THEN 0 ELSE consecutive_failures END,
         first_failure_at = CASE WHEN ? THEN NULL ELSE first_failure_at END,
         open_incident_id = CASE WHEN ? THEN NULL ELSE open_incident_id END,
         updated_at = ?
       WHERE id = ?`,
     ).bind(
       input.name,
       input.target,
       input.type,
       input.type === 'GET' ? input.expectedStatus : null,
       input.type === 'TCP' ? input.port : null,
       input.timeoutMs,
       input.enabled ? 1 : 0,
       monitoringStartedAt,
      resetMonitoringState ? 1 : 0,
      resetMonitoringState ? 1 : 0,
      resetMonitoringState ? 1 : 0,
      resetMonitoringState ? 1 : 0,
      resetMonitoringState ? 1 : 0,
      resetMonitoringState ? 1 : 0,
      resetMonitoringState ? 1 : 0,
      (resetMonitoringState || disabled) ? 1 : 0,
      timestamp,
      id,
    ),
  )

  const row = await queryFirst<ServiceRow>(db.prepare(`${SERVICE_SELECT} WHERE id = ?`).bind(id))
  return row ? mapService(row) : null
}

export const deleteService = async (db: D1Database, id: number) => {
  await execute(db.prepare('DELETE FROM services WHERE id = ?').bind(id))
}

export const applyServiceProbeResult = async (
  db: D1Database,
  input: {
    serviceId: number
    result: ServiceProbeResult
    consecutiveFailures: number
    firstFailureAt: string | null
    currentStateStartedAt: string | null
    openIncidentId: number | null
  },
) => {
  await execute(
    db.prepare(
      `UPDATE services
       SET
         last_check_at = ?,
         last_check_ok = ?,
         last_check_response_time_ms = ?,
         last_check_failure_message = ?,
         consecutive_failures = ?,
         first_failure_at = ?,
         current_state_started_at = ?,
         open_incident_id = ?,
         updated_at = ?
       WHERE id = ?`,
    ).bind(
      input.result.checkedAt,
      input.result.ok ? 1 : 0,
      input.result.responseTimeMs,
      input.result.failureMessage,
      input.consecutiveFailures,
      input.firstFailureAt,
      input.currentStateStartedAt,
      input.openIncidentId,
      nowIso(),
      input.serviceId,
    ),
  )
}

const buildWindow = (windowDays: number, monitoringStartedAt: string, incidents: Array<{ startedAt: string; resolvedAt: string | null }>) => {
  const now = Date.now()
  const windowStart = now - windowDays * 24 * 60 * 60 * 1000
  const monitoredStart = new Date(monitoringStartedAt).getTime()
  const effectiveStart = Math.max(windowStart, monitoredStart)
  const effectiveDurationMs = Math.max(0, now - effectiveStart)

  if (effectiveDurationMs === 0) {
    return {
      windowDays,
      uptimePercentage: null,
      downtimeMinutes: 0,
      incidentsCount: 0,
    } satisfies ServiceUptimeWindow
  }

  let downtimeMs = 0
  let incidentsCount = 0

  for (const incident of incidents) {
    const startedAt = new Date(incident.startedAt).getTime()
    const resolvedAt = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : now
    const overlapStart = Math.max(startedAt, effectiveStart)
    const overlapEnd = Math.min(resolvedAt, now)

    if (overlapEnd > overlapStart) {
      downtimeMs += overlapEnd - overlapStart
      incidentsCount += 1
    }
  }

  return {
    windowDays,
    uptimePercentage: ((effectiveDurationMs - Math.min(downtimeMs, effectiveDurationMs)) / effectiveDurationMs) * 100,
    downtimeMinutes: Math.floor(downtimeMs / 60_000),
    incidentsCount,
  } satisfies ServiceUptimeWindow
}

export const getServiceUptimeSummary = async (db: D1Database, slug: string) => {
  const row = await queryFirst<ServiceRow>(db.prepare(`${SERVICE_SELECT} WHERE slug = ?`).bind(slug))

  if (!row) {
    return null
  }

  const windowDays = [1, 7, 30, 365, 730] as const
  const incidents = await listIncidentsOverlappingWindowByServiceId(db, row.id, new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString())

  return {
    currentStateStartedAt: row.current_state_started_at,
    lastIncident: incidents[0]
      ? {
          startedAt: incidents[0].startedAt,
          resolvedAt: incidents[0].resolvedAt,
        }
      : null,
    windows: windowDays.map(days => buildWindow(days, row.monitoring_started_at, incidents)),
  } satisfies ServiceUptimeSummary
}

export const getServicesTimeline24h = async (db: D1Database) => {
  const services = await listAllServiceIds(db)
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const incidents = await listIncidentsOverlappingWindowByServiceIds(db, services.map(service => service.id), sinceIso)

  return {
    generatedAt: nowIso(),
    incidents,
  } satisfies ServiceTimeline24h
}
