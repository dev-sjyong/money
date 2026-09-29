export interface RepaymentPayment {
  id: string
  date: string
  amount: string
}
export interface RepaymentRow {
  id: string
  due_date: string
  amount: string
  payments: RepaymentPayment[]
}
export interface RepaymentPlan {
  id: string
  household_id: string
  name: string
  note: string
  rows: RepaymentRow[]
  revision: number
  archived: boolean
}
