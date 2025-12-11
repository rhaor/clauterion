export type Stage = 'Discover' | 'Define' | 'Deploy'

export type Topic = {
  id: string
  title: string
  description?: string
  ownerId: string
  createdAt?: Date
  stage?: Stage
}

