import type { Account, Transaction } from '../types/ledger'
import { balanceMap, accountPath, monthEnd, pastMonths } from './accounting'
export interface ReportRange {
  start: string
  end: string
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= '1901-01-01' &&
    value <= '2198-12-31' &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
  )
}
export function shiftDate(value: string, days: number) {
  return new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
}
export function rangeDays(range: ReportRange) {
  return (
    Math.round(
      (Date.parse(range.end + 'T00:00:00Z') - Date.parse(range.start + 'T00:00:00Z')) / 86400000,
    ) + 1
  )
}
export function validRange(range: ReportRange) {
  return (
    validDate(range.start) &&
    range.start >= '1902-01-01' &&
    validDate(range.end) &&
    range.start <= range.end &&
    rangeDays(range) <= 732
  )
}
export function monthlyRange(month: string, count: number): ReportRange {
  if (!validDate(month + '-01') || ![1, 3, 6, 12, 24].includes(count))
    throw new Error('기준 월과 기간을 확인하세요.')
  return { start: pastMonths(month, count)[0] + '-01', end: monthEnd(month) }
}
export function previousRange(range: ReportRange, months?: number): ReportRange {
  if (!validRange(range))
    throw new Error('시작일과 종료일을 확인하세요. 최대 732일까지 조회할 수 있어요.')
  const end = shiftDate(range.start, -1)
  return months
    ? monthlyRange(end.slice(0, 7), months)
    : { start: shiftDate(range.start, -rangeDays(range)), end }
}
export function positionAt(accounts: Account[], transactions: Transaction[], date: string) {
  const balances = balanceMap(accounts, transactions, date)
  const sum = (type: string) =>
    accounts.filter((a) => a.type === type).reduce((s, a) => s + (balances.get(a.id) || 0n), 0n)
  const assets = sum('ASSET'),
    liabilities = sum('LIABILITY')
  return { balances, assets, liabilities, netWorth: assets - liabilities }
}
export function transactionFlow(accounts: Account[], transaction: Transaction, ids?: Set<string>) {
  const types = new Map(accounts.map((a) => [a.id, a.type]))
  let income = 0n,
    expense = 0n,
    grossExpense = 0n,
    refund = 0n
  for (const line of transaction.lines) {
    if (ids && !ids.has(line.account_id)) continue
    const type = types.get(line.account_id),
      amount = BigInt(line.amount)
    if (type === 'INCOME') income += line.entry_type === 'CREDIT' ? amount : -amount
    if (type === 'EXPENSE') {
      expense += line.entry_type === 'DEBIT' ? amount : -amount
      if (line.entry_type === 'DEBIT') grossExpense += amount
      else refund += amount
    }
  }
  return { income, expense, grossExpense, refund }
}
export function periodFlow(accounts: Account[], transactions: Transaction[], range: ReportRange) {
  let income = 0n,
    expense = 0n,
    grossExpense = 0n,
    refund = 0n,
    count = 0
  for (const t of transactions) {
    if (t.transaction_date < range.start || t.transaction_date > range.end) continue
    const flow = transactionFlow(accounts, t)
    income += flow.income
    expense += flow.expense
    grossExpense += flow.grossExpense
    refund += flow.refund
    if (
      t.lines.some((l) =>
        ['INCOME', 'EXPENSE'].includes(accounts.find((a) => a.id === l.account_id)?.type || ''),
      )
    )
      count++
  }
  return { income, expense, surplus: income - expense, grossExpense, refund, count }
}
export function categoryReport(
  accounts: Account[],
  transactions: Transaction[],
  range: ReportRange,
  previous: ReportRange,
  grouping: 'root' | 'account',
) {
  const expenses = accounts.filter((a) => a.type === 'EXPENSE')
  const groups = new Map<
    string,
    {
      id: string
      label: string
      ids: Set<string>
      current: bigint
      previous: bigint
      active: boolean
    }
  >()
  const groupById = new Map<string, string>()
  for (const a of expenses) {
    let root = a
    const visited = new Set([a.id])
    if (grouping === 'root')
      while (root.parent_account_id) {
        const p = expenses.find((x) => x.id === root.parent_account_id)
        if (!p || visited.has(p.id)) break
        visited.add(p.id)
        root = p
      }
    if (!groups.has(root.id))
      groups.set(root.id, {
        id: root.id,
        label: accountPath(accounts, root.id),
        ids: new Set(),
        current: 0n,
        previous: 0n,
        active: false,
      })
    groups.get(root.id)!.ids.add(a.id)
    groupById.set(a.id, root.id)
  }
  for (const t of transactions) {
    const period =
      t.transaction_date >= range.start && t.transaction_date <= range.end
        ? 'current'
        : t.transaction_date >= previous.start && t.transaction_date <= previous.end
          ? 'previous'
          : null
    if (!period) continue
    for (const l of t.lines) {
      const key = groupById.get(l.account_id)
      if (key) {
        groups.get(key)![period] += (l.entry_type === 'DEBIT' ? 1n : -1n) * BigInt(l.amount)
        groups.get(key)!.active = true
      }
    }
  }
  return [...groups.values()]
    .filter((g) => g.active)
    .sort((a, b) =>
      a.current === b.current ? a.label.localeCompare(b.label) : a.current > b.current ? -1 : 1,
    )
}
export function monthlySeries(
  accounts: Account[],
  transactions: Transaction[],
  range: ReportRange,
) {
  const [sy, sm] = range.start.slice(0, 7).split('-').map(Number),
    [ey, em] = range.end.slice(0, 7).split('-').map(Number)
  const count = (ey! - sy!) * 12 + em! - sm! + 1
  if (count < 1 || count > 25) return []
  return pastMonths(range.end.slice(0, 7), count).map((month) => {
    const start = month + '-01' > range.start ? month + '-01' : range.start,
      end = monthEnd(month) < range.end ? monthEnd(month) : range.end
    return { month, ...periodFlow(accounts, transactions, { start, end }) }
  })
}
export function changePercent(current: bigint, previous: bigint): string | null {
  if (previous <= 0n) return null
  const value = ((current - previous) * 1000n) / previous
  return `${value > 0n ? '+' : ''}${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 10n}.${(value < 0n ? -value : value) % 10n}%`
}
export function ratioPercent(value: bigint, total: bigint): string | null {
  if (total <= 0n) return null
  const n = (value * 1000n) / total
  return `${n < 0n ? '-' : ''}${(n < 0n ? -n : n) / 10n}.${(n < 0n ? -n : n) % 10n}%`
}
export function reportCsv(rows: (string | bigint | number)[][]) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value)
            if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(s)) s = "'" + s
            return '"' + s.replaceAll('"', '""') + '"'
          })
          .join(','),
      )
      .join('\r\n')
  )
}
