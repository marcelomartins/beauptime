import type { Incident, IncidentStatus, PublicStatusIncident, ServiceTimelineIncident } from '@bea-uptime/contracts'
import { execute, queryAll, queryFirst } from '@/lib/db'

type IncidentRow = {
  id: number
  service_id: number
  service_name: string
  started_at: string
  resolved_at: string | null
  failure_message: string | null
}

type IncidentQuery = {
  serviceId?: number
  status?: IncidentStatus
  from?: string
  to?: string
}

type PublicIncidentRow = {
  service_name: string
  started_at: string
  resolved_at: string | null
}

const INCIDENT_SELECT = `
  SELECT
    i.id,
    i.service_id,
    s.name AS service_name,
    i.started_at,
    i.resolved_at,
    i.failure_message
  FROM incidents i
  INNER JOIN services s ON s.id = i.service_id
`

const mapIncident = (row: IncidentRow): Incident => ({
  id: row.id,
  serviceId: row.service_id,
  serviceName: row.service_name,
  status: row.resolved_at ? 'resolved' : 'open',
  startedAt: row.started_at,
  resolvedAt: row.resolved_at,
  failureMessage: row.failure_message,
})

const mapPublicIncident = (row: PublicIncidentRow): PublicStatusIncident => ({
  serviceName: row.service_name,
  status: row.resolved_at ? 'resolved' : 'open',
  startedAt: row.started_at,
  resolvedAt: row.resolved_at,
})

export const listIncidents = async (db: D1Database, filters: IncidentQuery) => {
  const conditions: string[] = []
  const bindings: Array<number | string> = []

  if (filters.serviceId) {
    conditions.push('i.service_id = ?')
    bindings.push(filters.serviceId)
  }

  if (filters.status) {
    conditions.push(filters.status === 'open' ? 'i.resolved_at IS NULL' : 'i.resolved_at IS NOT NULL')
  }

  if (filters.from) {
    conditions.push('i.started_at >= ?')
    bindings.push(filters.from)
  }

  if (filters.to) {
    conditions.push('i.started_at <= ?')
    bindings.push(filters.to)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const statement = db.prepare(`${INCIDENT_SELECT} ${whereClause} ORDER BY i.started_at DESC LIMIT 200`)
  const rows = await queryAll<IncidentRow>(bindings.length > 0 ? statement.bind(...bindings) : statement)
  return rows.map(mapIncident)
}

export const countOpenIncidents = async (db: D1Database) => {
  const row = await queryFirst<{ total: number }>(db.prepare('SELECT COUNT(*) AS total FROM services WHERE open_incident_id IS NOT NULL'))
  return Number(row?.total ?? 0)
}

export const createIncident = async (
  db: D1Database,
  input: { serviceId: number; failureMessage: string | null; startedAt: string },
) => {
  const result = await db
    .prepare(
      'INSERT INTO incidents (service_id, started_at, resolved_at, failure_message) VALUES (?, ?, ?, ?)',
    )
    .bind(input.serviceId, input.startedAt, null, input.failureMessage)
    .run()

  const id = Number(result.meta.last_row_id)
  const row = await queryFirst<IncidentRow>(db.prepare(`${INCIDENT_SELECT} WHERE i.id = ?`).bind(id))
  return row ? mapIncident(row) : null
}

export const resolveIncident = async (db: D1Database, incidentId: number, resolvedAt: string) => {
  await execute(
    db
      .prepare('UPDATE incidents SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL')
      .bind(resolvedAt, incidentId),
  )

  const row = await queryFirst<IncidentRow>(db.prepare(`${INCIDENT_SELECT} WHERE i.id = ?`).bind(incidentId))
  return row ? mapIncident(row) : null
}

export const listPublicOpenIncidents = async (db: D1Database, limit = 10) => {
  const rows = await queryAll<PublicIncidentRow>(
    db.prepare(
      `SELECT
         s.name AS service_name,
         i.started_at,
         i.resolved_at
       FROM incidents i
       INNER JOIN services s ON s.id = i.service_id
       WHERE s.enabled = 1 AND i.resolved_at IS NULL
       ORDER BY i.started_at DESC
       LIMIT ?`,
    ).bind(limit),
  )

  return rows.map(mapPublicIncident)
}

export const listPublicRecentIncidents = async (db: D1Database, sinceIso: string, limit = 10) => {
  const rows = await queryAll<PublicIncidentRow>(
    db.prepare(
      `SELECT
         s.name AS service_name,
         i.started_at,
         i.resolved_at
       FROM incidents i
       INNER JOIN services s ON s.id = i.service_id
        WHERE s.enabled = 1 AND i.resolved_at IS NOT NULL AND i.resolved_at >= ?
        ORDER BY i.resolved_at DESC
        LIMIT ?`,
    ).bind(sinceIso, limit),
  )

  return rows.map(mapPublicIncident)
}

export const listIncidentsOverlappingWindowByServiceId = async (db: D1Database, serviceId: number, sinceIso: string) => {
  const rows = await queryAll<{ started_at: string; resolved_at: string | null }>(
    db.prepare(
      `SELECT started_at, resolved_at
       FROM incidents
       WHERE service_id = ?
         AND started_at < ?
         AND (resolved_at IS NULL OR resolved_at >= ?)
       ORDER BY started_at DESC`,
    ).bind(serviceId, new Date().toISOString(), sinceIso),
  )

  return rows.map(row => ({
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
  }))
}

export const listIncidentsOverlappingWindowByServiceIds = async (db: D1Database, serviceIds: number[], sinceIso: string) => {
  if (serviceIds.length === 0) {
    return [] satisfies ServiceTimelineIncident[]
  }

  const placeholders = serviceIds.map(() => '?').join(', ')
  const nowIso = new Date().toISOString()
  const rows = await queryAll<{ service_id: number; started_at: string; resolved_at: string | null }>(
    db.prepare(
      `SELECT service_id, started_at, resolved_at
       FROM incidents
       WHERE service_id IN (${placeholders})
         AND started_at < ?
         AND (resolved_at IS NULL OR resolved_at >= ?)
       ORDER BY started_at DESC`,
    ).bind(...serviceIds, nowIso, sinceIso),
  )

  return rows.map((row): ServiceTimelineIncident => ({
    serviceId: row.service_id,
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
  }))
}
