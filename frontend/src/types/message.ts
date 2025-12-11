export type Message = {
  id: string
  content: string
  role: 'user' | 'assistant' | 'system'
  authorId: string
  createdAt?: Date
  // Discover stage metadata
  discoverVariant?: 'a' | 'b'
  discoverQueryNumber?: number
  discoverDimension?: string
  discoverPairId?: string
}

