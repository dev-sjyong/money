import type { RepaymentRow } from '../types/repayment'
const maximum = 9223372036854775807n
export function repaymentAmount(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value) || BigInt(value) > maximum)
    throw new Error('금액은 1원 이상의 정수로 입력하세요.')
  return BigInt(value)
}
export function validRepaymentDate(value: string): boolean {
  if (!Number.isFinite(Date.parse(value + 'T00:00:00Z'))) return false
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= '1900-01-01' &&
    value <= '2199-12-31' &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
  )
}
export function monthlyRepayments(
  start: string,
  end: string,
  day: number,
  amount: string,
  id: () => string,
): RepaymentRow[] {
  repaymentAmount(amount)
  if (
    !/^\d{4}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}$/.test(end) ||
    !validRepaymentDate(start + '-01') ||
    !validRepaymentDate(end + '-01') ||
    start > end ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31
  )
    throw new Error('기간과 납부일(1~31일)을 확인하세요.')
  const [sy, sm] = start.split('-').map(Number),
    [ey, em] = end.split('-').map(Number)
  const first = sy! * 12 + sm! - 1,
    last = ey! * 12 + em! - 1
  if (last - first >= 600) throw new Error('한 계획에는 최대 600회차까지 등록할 수 있어요.')
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const m = first + i,
      year = Math.floor(m / 12),
      month = (m % 12) + 1
    const d = Math.min(day, new Date(Date.UTC(year, month, 0)).getUTCDate())
    return {
      id: id(),
      due_date: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      amount,
      payments: [],
    }
  })
}
export function paidFor(row: RepaymentRow) {
  return row.payments.reduce((sum, p) => sum + BigInt(p.amount), 0n)
}
export function repaymentSummary(rows: RepaymentRow[], now: string) {
  const sorted = [...rows].sort((a, b) => a.due_date.localeCompare(b.due_date))
  let total = 0n,
    paid = 0n,
    overdue = 0n,
    month = 0n,
    monthRemaining = 0n,
    remainingCount = 0
  for (const row of sorted) {
    const amount = BigInt(row.amount),
      actual = paidFor(row),
      remaining = amount - actual
    total += amount
    paid += actual
    if (remaining > 0n) {
      remainingCount++
      if (row.due_date < now) overdue += remaining
    }
    if (row.due_date.slice(0, 7) === now.slice(0, 7)) {
      month += amount
      monthRemaining += remaining
    }
  }
  const end = sorted.at(-1)?.due_date ?? ''
  return {
    total,
    paid,
    remaining: total - paid,
    overdue,
    month,
    monthRemaining,
    remainingCount,
    end,
    days: end
      ? Math.max(
          0,
          Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(now + 'T00:00:00Z')) / 86400000),
        )
      : 0,
    next: sorted.find((r) => paidFor(r) < BigInt(r.amount))?.due_date ?? '',
  }
}
export function validateRepayments(rows: RepaymentRow[], now: string) {
  if (!rows.length || rows.length > 600) throw new Error('1~600개 회차를 등록하세요.')
  const ids = new Set<string>(),
    dates = new Set<string>(),
    paymentIds = new Set<string>()
  for (const row of rows) {
    if (!validRepaymentDate(row.due_date) || ids.has(row.id) || dates.has(row.due_date))
      throw new Error('납부 예정일이 잘못되었거나 중복되었어요.')
    ids.add(row.id)
    dates.add(row.due_date)
    const amount = repaymentAmount(row.amount)
    if (row.payments.length > 120) throw new Error('회차별 납부 기록은 최대 120개예요.')
    for (const payment of row.payments) {
      repaymentAmount(payment.amount)
      if (!validRepaymentDate(payment.date) || payment.date > now || paymentIds.has(payment.id))
        throw new Error('실제 납부일은 오늘까지 입력할 수 있어요. 중복 기록도 확인하세요.')
      paymentIds.add(payment.id)
    }
    if (paidFor(row) > amount)
      throw new Error('납부액이 회차 예정액보다 커요. 예정액 또는 납부 기록을 확인하세요.')
  }
}
