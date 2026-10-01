import type { Transaction, Line, Account } from '../types/ledger'
export function journalSignature(date: string, lines: Line[]) {
  return JSON.stringify([
    date,
    lines
      .map((l) => [l.account_id, l.entry_type, l.amount])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ])
}
export function duplicateCandidates(
  transactions: Transaction[],
  date: string,
  lines: Line[],
  exclude?: string,
) {
  const signature = journalSignature(date, lines)
  return transactions.filter(
    (t) =>
      !t.is_opening &&
      t.id !== exclude &&
      journalSignature(t.transaction_date, t.lines) === signature,
  )
}
export function duplicateGroups(transactions: Transaction[]) {
  const groups = new Map<string, Transaction[]>()
  for (const t of transactions.filter((t) => !t.is_opening)) {
    const key = journalSignature(t.transaction_date, t.lines)
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}
export function transactionAmount(t: Transaction) {
  return t.lines.filter((l) => l.entry_type === 'DEBIT').reduce((s, l) => s + BigInt(l.amount), 0n)
}
export function monthReviewSignature(
  accounts: Account[],
  transactions: Transaction[],
  end: string,
  obligations: unknown,
) {
  return JSON.stringify([
    accounts.map((a) => [a.id, a.type, a.name, a.is_archived]).sort(),
    transactions
      .filter((t) => t.transaction_date <= end)
      .map((t) => [t.id, t.updated_at, journalSignature(t.transaction_date, t.lines)])
      .sort(),
    obligations,
  ])
}
