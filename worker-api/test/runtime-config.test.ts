import { describe, expect, test } from 'bun:test'
import { getRuntimeConfig } from '../src/lib/runtime-config'

describe('getRuntimeConfig', () => {
  test('uses defaults when optional vars are missing or invalid', () => {
    const config = getRuntimeConfig({} as never)

    expect(config.serviceLimit).toBe(10)
    expect(config.defaultTimeoutMs).toBe(8000)
    expect(config.incidentRetentionDays).toBe(730)
    expect(config.alertToEmail).toBeNull()
    expect(config.alertFromEmail).toBeNull()
    expect(config.alertsEnabled).toBe(false)
  })

  test('parses configured values and enables alerts when fully configured', () => {
    const config = getRuntimeConfig({
      SERVICE_LIMIT: '25',
      DEFAULT_TIMEOUT_MS: '12000',
      INCIDENT_RETENTION_DAYS: '30',
      ALERT_TO_EMAIL: ' ops@example.com ',
      ALERT_FROM_EMAIL: ' alerts@example.com ',
      SEND_EMAIL: {} as never,
    } as never)

    expect(config.serviceLimit).toBe(25)
    expect(config.defaultTimeoutMs).toBe(12000)
    expect(config.incidentRetentionDays).toBe(30)
    expect(config.alertToEmail).toBe('ops@example.com')
    expect(config.alertFromEmail).toBe('alerts@example.com')
    expect(config.alertsEnabled).toBe(true)
  })
})
