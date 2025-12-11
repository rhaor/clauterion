export type Message = {
  id: string
  content: string
  role: 'user' | 'assistant' | 'system'
  authorId: string
  createdAt?: Date
  // Stage when message was generated (frozen for UI rendering)
  generatedStage?: 'Discover' | 'Define' | 'Deploy'
  // Discover stage metadata
  discoverVariant?: 'a' | 'b'
  discoverQueryNumber?: number
  discoverDimension?: string
  discoverPairId?: string
}

