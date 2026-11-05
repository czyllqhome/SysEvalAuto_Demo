import type { Answer } from './types'

export const blankAnswer = (): Answer => ({ implementation_status: 'needs_clarification', duration_workdays: null, owner_name: '', implementation_plan: '', limitations: '', alternative: '', estimated_start_date: null, estimated_finish_date: null })

// Share the exact attention rule between domain counts, filters and row highlighting.
export function answerNeedsAttention(answer: Answer | undefined, highRisk: boolean) {
  return answer?.implementation_status === 'no' || highRisk && answer?.implementation_status !== 'yes'
}

export function answerComplete(answer?: Answer) {
  if (!answer) return false
  const duration = answer.duration_workdays
  const legacyZero = duration === 0 && ['no', 'needs_clarification'].includes(answer.implementation_status)
  if (duration != null && !legacyZero && (!Number.isInteger(duration) || duration < 1 || duration > 10000)) return false
  if (answer.implementation_status !== 'yes' && !answer.limitations.trim()) return false
  if (answer.estimated_start_date && answer.estimated_finish_date && answer.estimated_finish_date < answer.estimated_start_date) return false
  return true
}
