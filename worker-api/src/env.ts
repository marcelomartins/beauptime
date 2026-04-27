import type { AdminSession } from '@/modules/auth/auth-types'

export type AppBindings = {
  DB: D1Database
  ASSETS: Fetcher
  AUTH_ROOT_SECRET: string
  ALERT_FROM_EMAIL?: string
  ALERT_TO_EMAIL?: string
  SERVICE_LIMIT?: string
  DEFAULT_TIMEOUT_MS?: string
  INCIDENT_RETENTION_DAYS?: string
  CORS_ALLOWED_ORIGINS?: string
  SEND_EMAIL?: SendEmail
}

export type AppVariables = {
  currentAdminSession: AdminSession | null
  requestId: string
}

export type AppEnv = {
  Bindings: AppBindings
  Variables: AppVariables
}
