import { Hono } from 'hono'
import type { AppEnv } from '@/env'
import { jsonSuccess } from '@/lib/response'
import { authRequired } from '@/middlewares/auth-required'
import { getMonitorSummary, runCleanup, runScheduledMonitorSweep } from './monitor-service'

export const monitorModule = new Hono<AppEnv>()

monitorModule.use('*', authRequired())

monitorModule.get('/summary', async (c) => {
  return jsonSuccess(c, await getMonitorSummary(c.env))
})

monitorModule.post('/cleanup', async (c) => {
  return jsonSuccess(c, await runCleanup(c.env))
})

monitorModule.post('/run-checks', async (c) => {
  return jsonSuccess(c, await runScheduledMonitorSweep(c.env))
})
