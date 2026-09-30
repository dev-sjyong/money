export interface FixedRule {
  effective_month: string
  title: string
  amount: string
  due_day: number
  expense_account: string
  payment_account: string
  end_month: string | null
  active: boolean
}
export interface FixedTemplate {
  id: string
  household_id: string
  revision: number
  rules: FixedRule[]
}
export interface FixedExpected {
  title: string
  amount: string
  due_date: string
  expense_account: string
  payment_account: string
}
export interface FixedRecord {
  fixed_id: string
  household_id: string
  month: string
  snapshot: FixedExpected
  transaction_id: string | null
  skipped: boolean
  revision: number
}
export interface FixedSnapshot {
  templates: FixedTemplate[]
  records: FixedRecord[]
  linked_transactions: string[]
}
