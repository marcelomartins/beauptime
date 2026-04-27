import { connect } from 'cloudflare:sockets'
import type { CleanupResult, MonitorSummary, MonitorSweepResult, ServiceProbeResult, ServiceProbeTarget, UpsertServiceInput } from '@bea-uptime/contracts'
import { ApiError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { nowIso } from '@/lib/db'
import type { AppBindings } from '@/env'
import { getRuntimeConfig } from '@/lib/runtime-config'
import {
  applyServiceProbeResult,
  countEnabledServices,
  countServices,
  listEnabledProbeTargets,
} from '@/modules/service/service-repository'
import {
  countOpenIncidents,
  createIncident,
  resolveIncident,
} from '@/modules/incident/incident-repository'
import { deleteResolvedIncidentsOlderThan } from './monitor-repository'

const MONITOR_CONCURRENCY_LIMIT = 5
const CLEANUP_BATCH_SIZE = 500
const SCHEDULED_CLEANUP_BATCH_BUFFER = 10

const escapeHtml = (value: string) => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

type CleanupRunOptions = {
  maxIncidentBatches?: number
}

type CleanupRunResult = CleanupResult & {
  hasMoreResolvedIncidentsToDelete: boolean
  incidentBatchesRun: number
}

const dayToMilliseconds = (days: number) => days * 24 * 60 * 60 * 1000

const getScheduledCleanupMaxBatches = (serviceLimit: number) => {
  return Math.max(4, Math.ceil(serviceLimit / CLEANUP_BATCH_SIZE) + SCHEDULED_CLEANUP_BATCH_BUFFER)
}

const normalizeTcpTarget = (value: string, port: number) => {
  const rawTarget = value.trim()

  if (!rawTarget) {
    throw new ApiError(400, 'invalid_service_host', 'TCP target must include a hostname or IP.')
  }

  try {
    const parsedTarget = rawTarget.includes('://') ? new URL(rawTarget) : new URL(`tcp://${rawTarget}`)

    if (parsedTarget.username || parsedTarget.password) {
      throw new ApiError(400, 'service_host_credentials_forbidden', 'TCP target must not include embedded credentials.')
    }

    if (parsedTarget.port && Number(parsedTarget.port) !== port) {
      throw new ApiError(400, 'service_port_mismatch', 'TCP target must not include a different port than the Port field.')
    }

    if (!parsedTarget.hostname) {
      throw new Error('Missing hostname.')
    }

    return parsedTarget.hostname
  }
  catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    throw new ApiError(400, 'invalid_service_host', 'TCP target must be a valid hostname or IP.')
  }
}

export const normalizeServiceInput = (input: UpsertServiceInput, defaultTimeoutMs: number) => {
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs

  if (input.type === 'TCP') {
    return {
      ...input,
      name: input.name.trim(),
      target: normalizeTcpTarget(input.target, input.port),
      timeoutMs,
    }
  }

  const normalizedUrl = new URL(input.target.trim())

  if (normalizedUrl.protocol !== 'http:' && normalizedUrl.protocol !== 'https:') {
    throw new ApiError(400, 'invalid_service_url', 'Service URL must use http or https.')
  }

  if (normalizedUrl.username || normalizedUrl.password) {
    throw new ApiError(400, 'service_url_credentials_forbidden', 'Service URL must not include embedded credentials.')
  }

  normalizedUrl.hash = ''

  return {
    ...input,
    name: input.name.trim(),
    target: normalizedUrl.toString(),
    timeoutMs,
  }
}

const isTimeoutError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false
  }

  return error.name === 'TimeoutError' || error.name === 'AbortError'
}

export const probeService = async (service: Pick<ServiceProbeTarget, 'id' | 'target' | 'type' | 'expectedStatus' | 'port' | 'timeoutMs'>): Promise<ServiceProbeResult> => {
  if (service.type === 'TCP') {
    const startedAt = Date.now()
    let socket: ReturnType<typeof connect> | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      socket = connect({
        hostname: service.target,
        port: service.port!,
      })

      await Promise.race([
        socket.opened,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            if (socket) {
              void socket.close().catch(() => {})
            }

            reject(new DOMException('TCP probe timed out.', 'TimeoutError'))
          }, service.timeoutMs)
        }),
      ])

      return {
        checkedAt: nowIso(),
        ok: true,
        responseTimeMs: Date.now() - startedAt,
        failureMessage: null,
      }
    }
    catch (error) {
      return {
        checkedAt: nowIso(),
        ok: false,
        responseTimeMs: Date.now() - startedAt,
        failureMessage: isTimeoutError(error)
          ? `Timed out after ${service.timeoutMs}ms.`
          : error instanceof Error ? error.message : `Unable to reach TCP port ${service.port}.`,
      }
    }
    finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (socket) {
        await socket.close().catch(() => {})
      }
    }
  }

  const startedAt = Date.now()

  try {
    const response = await fetch(service.target, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(service.timeoutMs),
      headers: {
        'user-agent': 'BeaUptime/1.0',
      },
    })

    const responseTimeMs = Date.now() - startedAt
    const checkedAt = nowIso()

    if (response.status !== service.expectedStatus) {
      return {
        checkedAt,
        ok: false,
        responseTimeMs,
        failureMessage: `Expected HTTP ${service.expectedStatus}, received ${response.status}.`,
      }
    }

    return {
      checkedAt,
      ok: true,
      responseTimeMs,
      failureMessage: null,
    }
  }
  catch (error) {
    return {
      checkedAt: nowIso(),
      ok: false,
      responseTimeMs: Date.now() - startedAt,
      failureMessage: isTimeoutError(error)
        ? `Timed out after ${service.timeoutMs}ms.`
        : error instanceof Error ? error.message : 'Network error.',
    }
  }
}

const formatProbeTarget = (service: Pick<ServiceProbeTarget, 'target' | 'type' | 'port'>) => {
  return service.type === 'TCP' ? `${service.target}:${service.port}` : service.target
}

const sendAlert = async (
  env: AppBindings,
  input: {
    subject: string
    text: string
  },
) => {
  const config = getRuntimeConfig(env)
  const recipientEmail = config.alertToEmail ?? ''

  if (!recipientEmail) {
    return false
  }

  const senderEmail = config.alertFromEmail ?? ''

  if (!env.SEND_EMAIL || !senderEmail) {
    logger.warn('Alert delivery is not configured', {
      subject: input.subject,
    })
    return false
  }

  try {
    await env.SEND_EMAIL.send({
      from: senderEmail,
      to: recipientEmail,
      subject: input.subject,
      text: input.text,
      html: `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap;">${escapeHtml(input.text)}</pre>`,
    })

    return true
  }
  catch (error) {
    logger.error('Notification delivery failed', {
      message: error instanceof Error ? error.message : 'Unable to send notification.',
    })

    return false
  }
}

const runWithConcurrency = async <TItem, TResult>(items: TItem[], limit: number, worker: (item: TItem) => Promise<TResult>) => {
  const results: TResult[] = []
  const queue = [...items]

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()

      if (!item) {
        return
      }

      results.push(await worker(item))
    }
  })

  await Promise.all(runners)
  return results
}

const applyIncidentLifecycle = async (env: AppBindings, service: ServiceProbeTarget, result: ServiceProbeResult) => {
  let consecutiveFailures = service.runtime.consecutiveFailures
  let firstFailureAt: string | null = null
  let currentStateStartedAt = service.runtime.currentStateStartedAt
  let openIncidentId = service.runtime.openIncidentId

  if (result.ok) {
    consecutiveFailures = 0
    firstFailureAt = null
    currentStateStartedAt = openIncidentId ? result.checkedAt : (currentStateStartedAt ?? result.checkedAt)

    if (openIncidentId) {
      const resolvedIncident = await resolveIncident(env.DB, openIncidentId, result.checkedAt)
      openIncidentId = null

        if (resolvedIncident) {
          await sendAlert(env, {
            subject: `[BeaUptime] ${service.name} recovered`,
            text: `${service.name} recovered at ${resolvedIncident.resolvedAt}.\nTarget: ${formatProbeTarget(service)}`,
          })
        }
      }
  }
  else {
    consecutiveFailures += 1
    firstFailureAt = consecutiveFailures > 1 ? service.runtime.currentStateStartedAt ?? result.checkedAt : result.checkedAt
    currentStateStartedAt = firstFailureAt

    if (!openIncidentId && consecutiveFailures >= 2 && result.failureMessage) {
      const incident = await createIncident(env.DB, {
        serviceId: service.id,
        failureMessage: result.failureMessage,
        startedAt: firstFailureAt,
      })

      openIncidentId = incident?.id ?? null

      if (incident) {
        await sendAlert(env, {
          subject: `[BeaUptime] ${service.name} is down`,
          text: `${service.name} entered incident state at ${incident.startedAt}.\nReason: ${incident.failureMessage ?? 'Probe failed.'}.\nTarget: ${formatProbeTarget(service)}`,
        })
      }
    }
  }

  await applyServiceProbeResult(env.DB, {
    serviceId: service.id,
    result,
    consecutiveFailures,
    firstFailureAt,
    currentStateStartedAt,
    openIncidentId,
  })
}

export const getMonitorSummary = async (env: AppBindings): Promise<MonitorSummary> => {
  const [servicesCount, enabledServicesCount, openIncidentsCount] = await Promise.all([
    countServices(env.DB),
    countEnabledServices(env.DB),
    countOpenIncidents(env.DB),
  ])

  return {
    servicesCount,
    enabledServicesCount,
    openIncidentsCount,
  }
}

const runCleanupBatches = async (deleteBatch: () => Promise<number>, maxBatches: number | undefined) => {
  let deletedTotal = 0
  let batchesRun = 0

  while (maxBatches === undefined || batchesRun < maxBatches) {
    const deleted = await deleteBatch()
    deletedTotal += deleted
    batchesRun += 1

    if (deleted < CLEANUP_BATCH_SIZE) {
      return {
        deletedTotal,
        batchesRun,
        hasMoreToDelete: false,
      }
    }
  }

  return {
    deletedTotal,
    batchesRun,
    hasMoreToDelete: true,
  }
}

const runCleanupInternal = async (
  env: AppBindings,
  options: CleanupRunOptions = {},
  config = getRuntimeConfig(env),
): Promise<CleanupRunResult> => {
  const incidentsBeforeIso = new Date(Date.now() - dayToMilliseconds(config.incidentRetentionDays)).toISOString()

  const incidentsCleanup = await runCleanupBatches(
    () => deleteResolvedIncidentsOlderThan(env.DB, incidentsBeforeIso, CLEANUP_BATCH_SIZE),
    options.maxIncidentBatches,
  )

  return {
    deletedResolvedIncidents: incidentsCleanup.deletedTotal,
    hasMoreResolvedIncidentsToDelete: incidentsCleanup.hasMoreToDelete,
    incidentBatchesRun: incidentsCleanup.batchesRun,
  }
}

export const runCleanup = async (env: AppBindings): Promise<CleanupResult> => {
  const result = await runCleanupInternal(env)

  return {
    deletedResolvedIncidents: result.deletedResolvedIncidents,
  }
}

export const runScheduledCleanup = async (env: AppBindings) => {
  const config = getRuntimeConfig(env)
  const maxBatchesPerTable = getScheduledCleanupMaxBatches(config.serviceLimit)
  const result = await runCleanupInternal(env, { maxIncidentBatches: maxBatchesPerTable }, config)

  const payload = {
    deletedResolvedIncidents: result.deletedResolvedIncidents,
    incidentBatchesRun: result.incidentBatchesRun,
    maxBatchesPerTable,
    hasMoreResolvedIncidentsToDelete: result.hasMoreResolvedIncidentsToDelete,
  }

  if (result.hasMoreResolvedIncidentsToDelete) {
    logger.warn('Scheduled cleanup reached the batch cap', payload)
    return
  }

  logger.info('Scheduled cleanup completed', payload)
}

export const runScheduledMonitorSweep = async (env: AppBindings): Promise<MonitorSweepResult> => {
  const services = await listEnabledProbeTargets(env.DB)

  let successCount = 0
  let failureCount = 0

  await runWithConcurrency(services, MONITOR_CONCURRENCY_LIMIT, async (service) => {
    try {
      const result = await probeService(service)
      await applyIncidentLifecycle(env, service, result)

      if (result.ok) {
        successCount += 1
      }
      else {
        failureCount += 1
      }
    }
    catch (error) {
      failureCount += 1
      logger.error('Service probe failed unexpectedly', {
        serviceId: service.id,
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  return {
    totalServices: services.length,
    successCount,
    failureCount,
  }
}
