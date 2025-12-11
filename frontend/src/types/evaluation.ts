export type EvaluationValue = 'meh' | 'okay' | 'good'

export type Evaluation = {
  id: string
  messageId: string
  criteriaId: string
  value: EvaluationValue
  createdAt?: Date
}

