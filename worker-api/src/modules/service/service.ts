import { Hono } from 'hono'
import type { AppEnv } from '@/env'
import { ApiError } from '@/lib/errors'
import { getRuntimeConfig } from '@/lib/runtime-config'
import { jsonSuccess } from '@/lib/response'
import { authRequired } from '@/middlewares/auth-required'
import { normalizeServiceInput, probeService } from '@/modules/monitor/monitor-service'
import { serviceSchema } from './service-schema'
import {
  countServices,
  createService,
  deleteService,
  findServiceDetailBySlug,
  findServiceIdentityBySlug,
  getServicesTimeline24h,
  getServiceUptimeSummary,
  listServiceListItems,
  updateService,
} from './service-repository'

const getServiceDetailOrThrow = async (db: D1Database, slug: string) => {
  const service = await findServiceDetailBySlug(db, slug)

  if (!service) {
    throw new ApiError(404, 'service_not_found', 'Service not found.')
  }

  return service
}

const getServiceIdentityOrThrow = async (db: D1Database, slug: string) => {
  const service = await findServiceIdentityBySlug(db, slug)

  if (!service) {
    throw new ApiError(404, 'service_not_found', 'Service not found.')
  }

  return service
}

export const serviceModule = new Hono<AppEnv>()

serviceModule.use('*', authRequired())

serviceModule.get('/', async (c) => {
  return jsonSuccess(c, await listServiceListItems(c.env.DB))
})

serviceModule.get('/timeline-24h', async (c) => {
  return jsonSuccess(c, await getServicesTimeline24h(c.env.DB))
})

serviceModule.post('/', async (c) => {
  const payload = serviceSchema.parse(await c.req.json())
  const config = getRuntimeConfig(c.env)
  const servicesCount = await countServices(c.env.DB)

  if (servicesCount >= config.serviceLimit) {
    throw new ApiError(409, 'service_limit_reached', 'The configured service limit has been reached.')
  }

  const normalized = normalizeServiceInput(payload, config.defaultTimeoutMs)
  const service = await createService(c.env.DB, normalized)

  if (!service) {
    throw new ApiError(500, 'service_create_failed', 'Unable to create service.')
  }

  return jsonSuccess(c, service, 201)
})

serviceModule.get('/:slug', async (c) => {
  return jsonSuccess(c, await getServiceDetailOrThrow(c.env.DB, c.req.param('slug')))
})

serviceModule.put('/:slug', async (c) => {
  const payload = serviceSchema.parse(await c.req.json())
  const config = getRuntimeConfig(c.env)
  const normalized = normalizeServiceInput(payload, config.defaultTimeoutMs)
  const currentService = await getServiceIdentityOrThrow(c.env.DB, c.req.param('slug'))
  const service = await updateService(c.env.DB, currentService.id, normalized)

  if (!service) {
    throw new ApiError(404, 'service_not_found', 'Service not found.')
  }

  return jsonSuccess(c, service)
})

serviceModule.delete('/:slug', async (c) => {
  const service = await getServiceIdentityOrThrow(c.env.DB, c.req.param('slug'))
  await deleteService(c.env.DB, service.id)
  return jsonSuccess(c, { ok: true })
})

serviceModule.post('/:slug/test', async (c) => {
  const service = await getServiceDetailOrThrow(c.env.DB, c.req.param('slug'))
  return jsonSuccess(c, await probeService(service))
})

serviceModule.get('/:slug/uptime', async (c) => {
  await getServiceIdentityOrThrow(c.env.DB, c.req.param('slug'))
  const uptime = await getServiceUptimeSummary(c.env.DB, c.req.param('slug'))

  if (!uptime) {
    throw new ApiError(404, 'service_not_found', 'Service not found.')
  }

  return jsonSuccess(c, uptime)
})
