import type { MiddlewareHandler } from 'hono'

export const security = (): MiddlewareHandler => {
  return async (c, next) => {
    c.header('x-content-type-options', 'nosniff')
    c.header('x-frame-options', 'DENY')
    c.header('referrer-policy', 'strict-origin-when-cross-origin')
    c.header('permissions-policy', 'camera=(), microphone=(), geolocation=()')
    await next()
  }
}
