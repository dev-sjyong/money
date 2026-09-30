import type { FixedTemplate, FixedRule, FixedSnapshot, FixedExpected } from '../types/fixed'
import type { Transaction } from '../types/ledger'
export function koreaToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
export function fixedMonth(value: string) {
  return /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value)
}
export function ruleAt(template: FixedTemplate, month: string): FixedRule | undefined {
  return [...template.rules]
    .filter((r) => r.effective_month <= month + '-01')
    .sort((a, b) => b.effective_month.localeCompare(a.effective_month))[0]
}
export function fixedDue(month: string, day: number) {
  const [y, m] = month.split('-').map(Number)
  return (
    month + '-' + String(Math.min(day, new Date(Date.UTC(y!, m!, 0)).getUTCDate())).padStart(2, '0')
  )
}
export function matchesFixed(t: Transaction, s: FixedExpected) {
  return (
    !t.is_opening &&
    t.lines.length === 2 &&
    t.lines.some((l) => l.account_id === s.expense_account && l.entry_type === 'DEBIT') &&
    t.lines.some((l) => l.account_id === s.payment_account && l.entry_type === 'CREDIT')
  )
}
export function fixedRows(
  snapshot: FixedSnapshot,
  month: string,
  transactions: Transaction[],
  today: string,
) {
  if (!fixedMonth(month)) return []
  return snapshot.templates
    .flatMap((template) => {
      const record = snapshot.records.find(
          (r) => r.fixed_id === template.id && r.month === month + '-01',
        ),
        rule = ruleAt(template, month)
      if (!record && (!rule || !rule.active || (rule.end_month && rule.end_month < month + '-01')))
        return []
      const expected: FixedExpected = record?.snapshot ?? {
        title: rule!.title,
        amount: rule!.amount,
        due_date: fixedDue(month, rule!.due_day),
        expense_account: rule!.expense_account,
        payment_account: rule!.payment_account,
      }
      const transaction = transactions.find((t) => t.id === record?.transaction_id)
      const paid =
        transaction && transaction.transaction_date <= today && matchesFixed(transaction, expected)
          ? BigInt(transaction.lines.find((l) => l.entry_type === 'DEBIT')!.amount)
          : null
      const status = record?.skipped
        ? 'skipped'
        : record?.transaction_id
          ? paid === null
            ? 'review'
            : 'paid'
          : expected.due_date < today
            ? 'overdue'
            : 'pending'
      return [{ template, record, expected, transaction, paid, status }]
    })
    .sort(
      (a, b) =>
        a.expected.due_date.localeCompare(b.expected.due_date) ||
        a.expected.title.localeCompare(b.expected.title),
    )
}
export type FixedRow = ReturnType<typeof fixedRows>[number]
export function fixedSummary(rows: FixedRow[]) {
  return rows.reduce(
    (s, r) => ({
      expected: s.expected + (r.status === 'skipped' ? 0n : BigInt(r.expected.amount)),
      paid: s.paid + (r.paid ?? 0n),
      remaining:
        s.remaining +
        (['pending', 'overdue', 'review'].includes(r.status) ? BigInt(r.expected.amount) : 0n),
      review: s.review + (r.status === 'review' ? 1 : 0),
      overdue: s.overdue + (r.status === 'overdue' ? 1 : 0),
    }),
    { expected: 0n, paid: 0n, remaining: 0n, review: 0, overdue: 0 },
  )
}
