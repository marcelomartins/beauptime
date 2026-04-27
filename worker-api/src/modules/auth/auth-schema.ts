import { z } from 'zod'

export const loginSchema = z.object({
  password: z.string().min(6).max(128),
})
