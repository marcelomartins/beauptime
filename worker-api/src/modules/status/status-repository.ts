import type { PublicStatusLevel, PublicStatusServiceSnapshot } from '@bea-uptime/contracts'
import { queryAll } from '@/lib/db'

type PublicServiceStatusRow = {
  slug: string
  name: string
  enabled: number
  open_incident_id: number | null
  last_check_at: string | null
  last_check_ok: number | null
  last_check_response_time_ms: number | null
  current_state_started_at: string | null
}

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
         slug,
         name,
         enabled,
         open_incident_id,
         last_check_at,
         last_check_ok,
         last_check_response_time_ms,
         current_state_started_at
        FROM services
        WHERE enabled = 1
        ORDER BY name COLLATE NOCASE ASC`,
    ),
  )

  return rows.map((row): PublicStatusServiceSnapshot => ({
    slug: row.slug,
    name: row.name,
    status: resolveServiceStatus(row),
    currentStateStartedAt: row.current_state_started_at,
    lastCheckedAt: row.last_check_at,
    lastResponseTimeMs: row.last_check_response_time_ms,
  }))
}
