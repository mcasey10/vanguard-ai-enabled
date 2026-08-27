import type { AccountingMethod, CostBasisMethod } from '../types'

// Explicit forward mapping: UI label → engine value.
// Paired with fromAccountingMethod below — both directions must be updated together.
const TO_ACCOUNTING: Record<CostBasisMethod, AccountingMethod> = {
  SpecID:   'specific_lot_identification',
  AvgCost:  'average_cost',
  MinTax:   'MinTax',
  HIFO:     'HIFO',
  FIFO:     'FIFO',
}

// Explicit reverse mapping: engine value → UI label.
// Paired with TO_ACCOUNTING above — both directions must be updated together.
const FROM_ACCOUNTING: Record<AccountingMethod, CostBasisMethod> = {
  specific_lot_identification: 'SpecID',
  average_cost:                'AvgCost',
  MinTax:                      'MinTax',
  HIFO:                        'HIFO',
  FIFO:                        'FIFO',
}

export function toAccountingMethod(m: CostBasisMethod): AccountingMethod {
  return TO_ACCOUNTING[m]
}

export function fromAccountingMethod(m: AccountingMethod): CostBasisMethod {
  return FROM_ACCOUNTING[m] ?? 'MinTax'
}
