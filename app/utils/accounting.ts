import type { Account, Budget, Line, Transaction, TransactionKind } from '../types/ledger'
export const MAX_AMOUNT = 9223372036854775807n
export function amount(value: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error('금액은 0보다 큰 정수로 입력하세요.')
  const n = BigInt(value)
  if (n > MAX_AMOUNT) throw new Error('입력 가능한 금액을 초과했습니다.')
  return n
}
export function validateLines(lines: Line[]) {
  if (lines.length < 2 || lines.length > 100) throw new Error('분개는 2~100줄이어야 합니다.')
  let debit = 0n
  let credit = 0n
  for (const l of lines) {
    if (!l.account_id) throw new Error('계정을 선택하세요.')
    const n = amount(l.amount)
    if (l.entry_type === 'DEBIT') debit += n
    else if (l.entry_type === 'CREDIT') credit += n
    else throw new Error('분개 유형이 올바르지 않습니다.')
  }
  if (debit !== credit) throw new Error('차변과 대변의 합계가 일치해야 합니다.')
  return { debit, credit }
}
export function simpleLines(
  kind: Exclude<TransactionKind, 'journal'>,
  debit: Account,
  credit: Account,
  value: string,
): Line[] {
  amount(value)
  const allowed: Record<Exclude<TransactionKind, 'journal'>, [string[], string[]]> = {
    expense: [['EXPENSE'], ['ASSET', 'LIABILITY']],
    income: [['ASSET'], ['INCOME']],
    transfer: [['ASSET'], ['ASSET']],
    card: [['LIABILITY'], ['ASSET']],
    loan: [['LIABILITY'], ['ASSET']],
  }
  if (
    debit.id === credit.id ||
    debit.is_archived ||
    credit.is_archived ||
    debit.household_id !== credit.household_id ||
    !allowed[kind][0].includes(debit.type) ||
    !allowed[kind][1].includes(credit.type)
  )
    throw new Error('거래 유형에 맞는 서로 다른 계정을 선택하세요.')
  return [
    { account_id: debit.id, entry_type: 'DEBIT', amount: value },
    { account_id: credit.id, entry_type: 'CREDIT', amount: value },
  ]
}
export function balanceMap(accounts: Account[], transactions: Transaction[], until?: string) {
  const result = new Map(accounts.map((a) => [a.id, 0n]))
  const types = new Map(accounts.map((a) => [a.id, a.type]))
  for (const t of transactions) {
    if (until && t.transaction_date > until) continue
    for (const l of t.lines) {
      const positive =
        ['ASSET', 'EXPENSE'].includes(types.get(l.account_id) || '') === (l.entry_type === 'DEBIT')
      result.set(
        l.account_id,
        (result.get(l.account_id) || 0n) + (positive ? 1n : -1n) * BigInt(l.amount),
      )
    }
  }
  return result
}
export function totals(
  accounts: Account[],
  transactions: Transaction[],
  month: string,
  until?: string,
) {
  const balances = balanceMap(accounts, transactions, until)
  const monthly = balanceMap(
    accounts,
    transactions.filter((t) => t.transaction_date.startsWith(month)),
  )
  const sum = (type: string, map: Map<string, bigint>) =>
    accounts.filter((a) => a.type === type).reduce((s, a) => s + (map.get(a.id) || 0n), 0n)
  const assets = sum('ASSET', balances),
    liabilities = sum('LIABILITY', balances),
    income = sum('INCOME', monthly),
    expense = sum('EXPENSE', monthly)
  return {
    assets,
    liabilities,
    netWorth: assets - liabilities,
    income,
    expense,
    surplus: income - expense,
  }
}
export function descendantIds(accounts: Account[], id: string): Set<string> {
  const ids = new Set([id])
  let size = 0
  while (size !== ids.size) {
    size = ids.size
    for (const a of accounts) if (a.parent_account_id && ids.has(a.parent_account_id)) ids.add(a.id)
  }
  return ids
}
export function budgetUsage(accounts: Account[], transactions: Transaction[], b: Budget): bigint {
  const ids = descendantIds(accounts, b.account_id)
  const month = `${b.year}-${String(b.month).padStart(2, '0')}`
  return transactions
    .filter((t) => t.transaction_date.startsWith(month))
    .flatMap((t) => t.lines)
    .filter((l) => ids.has(l.account_id) && l.entry_type === 'DEBIT')
    .reduce((s, l) => s + BigInt(l.amount), 0n)
}
export function topBudgets(accounts: Account[], budgets: Budget[]) {
  return budgets.filter(
    (b) =>
      !budgets.some(
        (other) => other.id !== b.id && descendantIds(accounts, other.account_id).has(b.account_id),
      ),
  )
}
export function won(n: bigint | string) {
  return BigInt(n).toLocaleString('ko-KR')
}
export function percent(used: bigint, total: bigint) {
  return total > 0n ? Number((used * 10000n) / total) / 100 : 0
}
export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function pastMonths(end: string, count = 6) {
  const [y, m] = end.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(y!, m! - count + i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}
export function monthEnd(month: string) {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${new Date(y!, m!, 0).getDate()}`
}
export function accountPath(accounts: Account[], id: string): string {
  const parts: string[] = []
  const seen = new Set<string>()
  let a = accounts.find((a) => a.id === id)
  while (a && !seen.has(a.id)) {
    seen.add(a.id)
    parts.unshift(a.name)
    a = accounts.find((p) => p.id === a!.parent_account_id)
  }
  return parts.join(' › ')
}
