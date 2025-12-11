export type Message = {
  id: string
  content: string
  role: 'user' | 'assistant' | 'system'
  authorId: string
  createdAt?: Date
}

