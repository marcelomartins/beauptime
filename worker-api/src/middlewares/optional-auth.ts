import { getCookie } from 'hono/cookie'
import type { MiddlewareHandler } from 'hono'
import { getSessionCookieName } from '@/lib/session'
import { resolveSession } from '@/modules/auth/auth-service'

export const optionalAuth = (): MiddlewareHandler => {
  return async (c, next) => {
    const token = getCookie(c, getSessionCookieName())

    if (!token) {
      c.set('currentAdminSession', null)
      await next()
      return
    }

    const resolved = await resolveSession(c.env, token)
    c.set('currentAdminSession', resolved)
    await next()
  }
}
