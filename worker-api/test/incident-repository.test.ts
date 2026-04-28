import { describe, expect, test } from 'bun:test'
import { listPublicRecentIncidents } from '../src/modules/incident/incident-repository'

describe('listPublicRecentIncidents', () => {
  test('filters and orders by resolution time for recent public incidents', async () => {
    const recorded: { sql: string; bindings: unknown[] }[] = []

    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            recorded.push({ sql, bindings })

            return {
              all: async () => ({
                results: [{
                  service_name: 'Main API',
                  started_at: '2026-04-01T00:00:00.000Z',
                  resolved_at: '2026-04-20T12:00:00.000Z',
                }],
              }),
            }
          },
        }
      },
    } as never

    const incidents = await listPublicRecentIncidents(db, '2026-04-14T00:00:00.000Z', 5)
    const [query] = recorded

    expect(query?.sql).toContain('i.resolved_at >= ?')
    expect(query?.sql).toContain('ORDER BY i.resolved_at DESC')
    expect(query?.bindings).toEqual(['2026-04-14T00:00:00.000Z', 5])
    expect(incidents).toEqual([{
      serviceName: 'Main API',
      status: 'resolved',
      startedAt: '2026-04-01T00:00:00.000Z',
      resolvedAt: '2026-04-20T12:00:00.000Z',
    }])
  })
})
