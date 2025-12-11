import { z } from 'zod'

export const createMessageSchema = z.object({
  topicId: z.string().min(1, 'topicId is required'),
  content: z.string().min(1, 'content is required').max(4000, 'content too long'),
})

export type CreateMessageInput = z.infer<typeof createMessageSchema>

