import { z } from 'zod'

const serviceBaseSchema = {
  name: z.string().trim().min(2).max(120),
  timeoutMs: z.number().int().min(1000).max(20000).optional().nullable(),
  enabled: z.boolean(),
}

export const serviceSchema = z.discriminatedUnion('type', [
  z.object({
    ...serviceBaseSchema,
    target: z.string().trim().url(),
    type: z.literal('GET'),
    expectedStatus: z.number().int().min(100).max(599),
  }),
  z.object({
    ...serviceBaseSchema,
    target: z.string().trim().min(1).max(255),
    type: z.literal('TCP'),
    port: z.number().int().min(1).max(65535),
  }),
])
