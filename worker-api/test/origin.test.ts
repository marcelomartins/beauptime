import { describe, expect, test } from 'bun:test'
import { getAllowedOrigins, getOriginFromReferer, isAllowedOrigin } from '../src/lib/origin'

describe('origin helpers', () => {
  test('always allows the worker origin and configured browser origins', () => {
    const env = {
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173, https://status.example.com ',
    } as never

    const allowedOrigins = getAllowedOrigins(env, 'https://api.example.com/api/v1/status')

    expect(allowedOrigins.has('https://api.example.com')).toBe(true)
    expect(allowedOrigins.has('http://localhost:5173')).toBe(true)
    expect(allowedOrigins.has('https://status.example.com')).toBe(true)
  })

  test('accepts only normalized allowed origins', () => {
    const env = {
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    } as never

    expect(isAllowedOrigin(env, 'https://api.example.com/auth/session', 'https://api.example.com')).toBe(true)
    expect(isAllowedOrigin(env, 'https://api.example.com/auth/session', 'http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin(env, 'https://api.example.com/auth/session', 'https://malicious.example.com')).toBe(false)
    expect(isAllowedOrigin(env, 'https://api.example.com/auth/session', 'not-an-origin')).toBe(false)
  })

  test('extracts the origin from a referer when present', () => {
    expect(getOriginFromReferer('https://status.example.com/dashboard?tab=incidents')).toBe('https://status.example.com')
    expect(getOriginFromReferer(undefined)).toBeNull()
  })
})
