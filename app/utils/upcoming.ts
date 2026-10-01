import type { RepaymentPlan } from '../types/repayment'
import type { Transaction } from '../types/ledger'
import { paidFor } from './repayment'
export interface RepaymentLink {
  payment_id: string
  plan_id: string
  row_id: string
  transaction_id: string
  snapshot: { date: string; amount: string; expense_account: string; payment_account: string }
}
export function linkNeedsReview(link: RepaymentLink, transactions: Transaction[]) {
  const t = transactions.find((t) => t.id === link.transaction_id),
    s = link.snapshot
  return (
    !t ||
    t.is_opening ||
    t.transaction_date !== s.date ||
    t.lines.length !== 2 ||
    !t.lines.some(
      (l) =>
        l.entry_type === 'DEBIT' && l.account_id === s.expense_account && l.amount === s.amount,
    ) ||
    !t.lines.some(
      (l) =>
        l.entry_type === 'CREDIT' && l.account_id === s.payment_account && l.amount === s.amount,
    )
  )
}
export function upcomingRepayments(plans: RepaymentPlan[], month: string) {
  return plans
    .filter((p) => !p.archived)
    .flatMap((plan) =>
      plan.rows
        .filter((r) => r.due_date.slice(0, 7) === month)
        .map((row) => ({ plan, row, remaining: BigInt(row.amount) - paidFor(row) })),
    )
    .filter((r) => r.remaining > 0n)
    .sort((a, b) => a.row.due_date.localeCompare(b.row.due_date))
}
