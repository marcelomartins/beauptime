import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export const jsonSuccess = <T>(c: Context, data: T, status = 200) => {
  return c.json({ success: true, data }, status as ContentfulStatusCode)
}

export const jsonError = (c: Context, code: string, message: string, status = 400) => {
  return c.json(
    {
      success: false,
      error: {
        code,
        message,
      },
    },
    status as ContentfulStatusCode,
  )
}
