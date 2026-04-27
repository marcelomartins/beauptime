import { queryAll } from '@/lib/db'

export const deleteResolvedIncidentsOlderThan = async (db: D1Database, beforeIso: string, limit: number) => {
  const rows = await queryAll<{ id: number }>(
    db.prepare(
      'SELECT id FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ? ORDER BY resolved_at ASC LIMIT ?',
    ).bind(beforeIso, limit),
  )

  if (rows.length === 0) {
    return 0
  }

  const placeholders = rows.map(() => '?').join(', ')
  await db.prepare(`DELETE FROM incidents WHERE id IN (${placeholders})`).bind(...rows.map(row => row.id)).run()
  return rows.length
}
