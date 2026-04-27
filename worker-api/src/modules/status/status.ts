import { Hono } from 'hono'
import type { Context } from 'hono'
import type { PublicStatusLevel, PublicStatusResponse, PublicStatusServiceSnapshot } from '@bea-uptime/contracts'
import type { AppEnv } from '@/env'
import { nowIso } from '@/lib/db'
import { ApiError } from '@/lib/errors'
import { getOriginFromReferer, isAllowedOrigin } from '@/lib/origin'
import { jsonSuccess } from '@/lib/response'
import { listPublicOpenIncidents, listPublicRecentIncidents } from '@/modules/incident/incident-repository'
import { listPublicServiceStatuses } from './status-repository'

const RECENT_INCIDENT_DAYS = 14

const daysToMilliseconds = (days: number) => days * 24 * 60 * 60 * 1000

const isoBefore = (now: string, days: number) => new Date(new Date(now).getTime() - daysToMilliseconds(days)).toISOString()

const isAllowedStatusOrigin = (c: Context<AppEnv>, origin?: string | null) => {
  return Boolean(origin && isAllowedOrigin(c.env, c.req.url, origin))
}

const assertAllowedStatusRequest = (c: Context<AppEnv>) => {
  const fetchSite = c.req.header('sec-fetch-site')?.toLowerCase()
  const origin = c.req.header('origin')
  const refererOrigin = getOriginFromReferer(c.req.header('referer'))

  if (fetchSite === 'same-origin') {
    return
  }

  if (isAllowedStatusOrigin(c, origin) || isAllowedStatusOrigin(c, refererOrigin)) {
    return
  }

  if (fetchSite) {
    throw new ApiError(403, 'status_origin_forbidden', 'Status data can only be requested from an allowed origin.')
  }

  throw new ApiError(403, 'status_origin_required', 'Status data can only be requested from an allowed origin.')
}

const resolveOverallStatus = (services: PublicStatusServiceSnapshot[]): PublicStatusLevel => {
  if (services.some((service) => service.status === 'outage')) {
    return 'outage'
  }

  if (services.some((service) => service.status === 'unknown')) {
    return 'unknown'
  }

  if (services.every((service) => service.status === 'paused')) {
    return 'paused'
  }

  return 'operational'
}

export const statusModule = new Hono<AppEnv>()

statusModule.get('/', async (c) => {
  assertAllowedStatusRequest(c)

  const generatedAt = nowIso()
  const [services, openIncidents, recentIncidents] = await Promise.all([
    listPublicServiceStatuses(c.env.DB),
    listPublicOpenIncidents(c.env.DB),
    listPublicRecentIncidents(c.env.DB, isoBefore(generatedAt, RECENT_INCIDENT_DAYS)),
  ])

  const payload: PublicStatusResponse = {
    generatedAt,
    overallStatus: resolveOverallStatus(services),
    services,
    openIncidents,
    recentIncidents,
  }

  c.header('Cache-Control', 'private, no-store')
  c.header('Vary', 'Origin, Referer, Sec-Fetch-Site')
  return jsonSuccess(c, payload)
})
