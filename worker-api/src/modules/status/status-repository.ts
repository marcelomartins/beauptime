import type { PublicStatusCheckState, PublicStatusLevel, PublicStatusServiceSnapshot, ServiceTimelineIncident } from '@bea-uptime/contracts'
import { queryAll } from '@/lib/db'

type PublicServiceStatusRow = {
  id: number
  name: string
  enabled: number
  open_incident_id: number | null
  monitoring_started_at: string
  last_check_at: string | null
  last_check_ok: number | null
}

const HOUR_IN_MS = 60 * 60 * 1000
const TIMELINE_HOURS = 48

const resolveServiceStatus = (row: PublicServiceStatusRow): PublicStatusLevel => {
  if (!row.enabled) {
    return 'paused'
  }

  if (!row.last_check_at) {
    return 'unknown'
  }

  if (row.open_incident_id || row.last_check_ok === 0) {
    return 'outage'
  }

  return 'operational'
}

export const listPublicServiceStatuses = async (db: D1Database) => {
  const rows = await queryAll<PublicServiceStatusRow>(
    db.prepare(
      `SELECT
         id,
         name,
         enabled,
         open_incident_id,
         monitoring_started_at,
         last_check_at,
         last_check_ok
        FROM services
        WHERE enabled = 1
        ORDER BY name COLLATE NOCASE ASC`,
    ),
  )

  return rows
}

const incidentOverlapsWindow = (incident: ServiceTimelineIncident, windowStartMs: number, windowEndMs: number) => {
  const incidentStartMs = new Date(incident.startedAt).getTime()
  const incidentEndMs = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : Number.POSITIVE_INFINITY

  return incidentStartMs < windowEndMs && incidentEndMs > windowStartMs
}

const buildChecks48h = (row: PublicServiceStatusRow, incidents: ServiceTimelineIncident[], referenceMs: number): PublicStatusCheckState[] => {
  const currentHourStartMs = Math.floor(referenceMs / HOUR_IN_MS) * HOUR_IN_MS

  if (!row.last_check_at) {
    return Array.from({ length: TIMELINE_HOURS }, () => 'empty')
  }

  return Array.from({ length: TIMELINE_HOURS }, (_, index): PublicStatusCheckState => {
    const hourStartMs = currentHourStartMs - (TIMELINE_HOURS - 1 - index) * HOUR_IN_MS
    const hourEndMs = hourStartMs + HOUR_IN_MS

    if (hourEndMs - 1 < new Date(row.monitoring_started_at).getTime()) {
      return 'empty'
    }

    return incidents.some((incident) => incidentOverlapsWindow(incident, hourStartMs, hourEndMs)) ? 'fail' : 'ok'
  })
}

const calculateUptimePercentage48h = (row: PublicServiceStatusRow, incidents: ServiceTimelineIncident[], referenceMs: number) => {
  if (!row.last_check_at) {
    return null
  }

  const windowStartMs = referenceMs - TIMELINE_HOURS * HOUR_IN_MS
  const effectiveStartMs = Math.max(windowStartMs, new Date(row.monitoring_started_at).getTime())
  const effectiveDurationMs = Math.max(0, referenceMs - effectiveStartMs)

  if (effectiveDurationMs === 0) {
    return null
  }

  let downtimeMs = 0

  for (const incident of incidents) {
    const startedAtMs = new Date(incident.startedAt).getTime()
    const resolvedAtMs = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : referenceMs
    const overlapStartMs = Math.max(startedAtMs, effectiveStartMs)
    const overlapEndMs = Math.min(resolvedAtMs, referenceMs)

    if (overlapEndMs > overlapStartMs) {
      downtimeMs += overlapEndMs - overlapStartMs
    }
  }

  return ((effectiveDurationMs - Math.min(downtimeMs, effectiveDurationMs)) / effectiveDurationMs) * 100
}

export const buildPublicServiceStatuses = (
  rows: PublicServiceStatusRow[],
  incidentsByServiceId: Map<number, ServiceTimelineIncident[]>,
  referenceMs: number,
) => {
  return rows.map((row): PublicStatusServiceSnapshot => {
    const incidents = incidentsByServiceId.get(row.id) ?? []

    return {
      name: row.name,
      status: resolveServiceStatus(row),
      lastCheckedAt: row.last_check_at,
      checks48h: buildChecks48h(row, incidents, referenceMs),
      uptimePercentage48h: calculateUptimePercentage48h(row, incidents, referenceMs),
    }
  })
}
