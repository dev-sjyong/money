import test from 'node:test'
import assert from 'node:assert/strict'
import {
  monthlyRepayments,
  repaymentSummary,
  validateRepayments,
  validRepaymentDate,
} from '../app/utils/repayment'
let n = 0
const id = () => String(++n)
test('monthly dates clamp to month end including leap years and reject invalid periods', () => {
  const rows = monthlyRepayments('2024-01', '2024-03', 31, '500000', id)
  assert.deepEqual(
    rows.map((r) => r.due_date),
    ['2024-01-31', '2024-02-29', '2024-03-31'],
  )
  assert.equal(monthlyRepayments('2025-02', '2025-02', 31, '1', id)[0]!.due_date, '2025-02-28')
  assert.throws(() => monthlyRepayments('2026-12', '2026-01', 25, '1', id))
  assert.throws(() => monthlyRepayments('2026-13', '2027-01', 25, '1', id))
  assert.throws(() => monthlyRepayments('2026-01', '2026-01', 0, '1', id))
  assert.equal(validRepaymentDate('2026-02-30'), false)
  assert.equal(validRepaymentDate('2026-99-99'), false)
})
test('variable schedules count partial payments, advance payments and overdue by remaining amount', () => {
  const rows = monthlyRepayments('2026-08', '2026-10', 25, '500000', id)
  rows[1]!.amount = '800000'
  rows[2]!.amount = '650000'
  rows[0]!.payments = [{ id: id(), date: '2026-08-25', amount: '500000' }]
  rows[1]!.payments = [
    { id: id(), date: '2026-09-20', amount: '100000' },
    { id: id(), date: '2026-09-26', amount: '200000' },
  ]
  rows[2]!.payments = [{ id: id(), date: '2026-09-29', amount: '650000' }]
  validateRepayments(rows, '2026-09-30')
  const s = repaymentSummary(rows, '2026-09-30')
  assert.equal(s.total, 1950000n)
  assert.equal(s.paid, 1450000n)
  assert.equal(s.remaining, 500000n)
  assert.equal(s.overdue, 500000n)
  assert.equal(s.monthRemaining, 500000n)
  assert.equal(s.remainingCount, 1)
  assert.equal(s.end, '2026-10-25')
  assert.equal(s.days, 25)
  assert.equal(s.next, '2026-09-25')
  assert.equal(repaymentSummary(rows, '2026-09-25').overdue, 0n)
})
test('precision, invalid payments, future dates and duplicate schedules', () => {
  const rows = monthlyRepayments('2026-09', '2026-09', 30, '9007199254740993', id)
  assert.equal(repaymentSummary(rows, '2026-09-30').remaining, 9007199254740993n)
  assert.throws(() => validateRepayments([...rows, ...rows], '2026-09-30'))
  for (const amount of ['-1', '0', '1.5', '9223372036854775808'])
    assert.throws(() => monthlyRepayments('2026-09', '2026-09', 30, amount, id))
  rows[0]!.payments = [{ id: id(), date: '2026-10-01', amount: '1' }]
  assert.throws(() => validateRepayments(rows, '2026-09-30'))
  rows[0]!.payments = [{ id: id(), date: '2026-09-30', amount: '9007199254740994' }]
  assert.throws(() => validateRepayments(rows, '2026-09-30'))
  assert.equal(repaymentSummary([], '2026-09-30').remaining, 0n)
})
