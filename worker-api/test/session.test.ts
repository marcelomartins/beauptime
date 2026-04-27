import { describe, expect, test } from 'bun:test'
import {
  createAdminSession,
  isMatchingRootPassword,
  signAdminSessionToken,
  verifyAdminSessionToken,
} from '../src/lib/session'

describe('session helpers', () => {
  test('matches the configured root password', async () => {
    expect(await isMatchingRootPassword('super-secret', 'super-secret')).toBe(true)
    expect(await isMatchingRootPassword('super-secret', 'different-secret')).toBe(false)
    expect(await isMatchingRootPassword('super-secret', '')).toBe(false)
  })

  test('signs and verifies an admin session token', async () => {
    const session = createAdminSession(Date.now())
    const token = await signAdminSessionToken('root-secret', session)

    await expect(verifyAdminSessionToken('root-secret', token)).resolves.toEqual(session)
    await expect(verifyAdminSessionToken('wrong-secret', token)).resolves.toBeNull()
  })

  test('rejects expired session tokens', async () => {
    const expiredToken = await signAdminSessionToken('root-secret', {
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) - 60,
    })

    await expect(verifyAdminSessionToken('root-secret', expiredToken)).resolves.toBeNull()
  })
})
