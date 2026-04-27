import type { AppBindings } from '@/env'

const DEFAULT_SERVICE_LIMIT = 10
const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_INCIDENT_RETENTION_DAYS = 730

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10)

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

export const getRuntimeConfig = (env: AppBindings) => {
  const alertToEmail = env.ALERT_TO_EMAIL?.trim() || null
  const alertFromEmail = env.ALERT_FROM_EMAIL?.trim() || null

  return {
    serviceLimit: parsePositiveInt(env.SERVICE_LIMIT, DEFAULT_SERVICE_LIMIT),
    defaultTimeoutMs: parsePositiveInt(env.DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    incidentRetentionDays: parsePositiveInt(env.INCIDENT_RETENTION_DAYS, DEFAULT_INCIDENT_RETENTION_DAYS),
    alertToEmail,
    alertFromEmail,
    alertsEnabled: Boolean(alertToEmail && alertFromEmail && env.SEND_EMAIL),
  }
}
