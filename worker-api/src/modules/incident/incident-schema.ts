import { z } from 'zod'

export const incidentsQuerySchema = z.object({
  serviceId: z.coerce.number().int().positive().optional(),
  status: z.enum(['open', 'resolved']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})
