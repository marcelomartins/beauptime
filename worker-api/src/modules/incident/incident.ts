import { Hono } from 'hono'
import type { AppEnv } from '@/env'
import { jsonSuccess } from '@/lib/response'
import { authRequired } from '@/middlewares/auth-required'
import { incidentsQuerySchema } from './incident-schema'
import { listIncidents } from './incident-repository'

export const incidentModule = new Hono<AppEnv>()

incidentModule.use('*', authRequired())

incidentModule.get('/', async (c) => {
  const filters = incidentsQuerySchema.parse(c.req.query())
  return jsonSuccess(c, await listIncidents(c.env.DB, filters))
})
