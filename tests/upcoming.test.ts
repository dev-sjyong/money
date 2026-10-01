import { test } from 'node:test'
import assert from 'node:assert/strict'
import { upcomingRepayments, linkNeedsReview } from '../app/utils/upcoming'
import type { RepaymentPlan } from '../app/types/repayment'
test('upcoming preserves each person, partial payment, month and archived boundaries', () => {
  const plan: RepaymentPlan = {
    id: 'p',
    household_id: 'h',
    name: '본인',
    note: '',
    revision: 1,
    archived: false,
    rows: [
      {
        id: 'r',
        due_date: '2026-10-25',
        amount: '9007199254740993',
        payments: [{ id: 'payment', date: '2026-10-01', amount: '1' }],
      },
      { id: 'old', due_date: '2026-09-25', amount: '100', payments: [] },
    ],
  }
  const rows = upcomingRepayments(
    [plan, { ...plan, id: 'wife', name: '배우자' }, { ...plan, id: 'archived', archived: true }],
    '2026-10',
  )
  assert.equal(rows.length, 2)
  assert.equal(rows[0]!.remaining, 9007199254740992n)
  assert.equal(rows[1]!.plan.name, '배우자')
})
test('linked deletion, amount/date/account changes require review', () => {
  const link = {
    payment_id: 'p',
    plan_id: 'plan',
    row_id: 'r',
    transaction_id: 't',
    snapshot: {
      date: '2026-10-01',
      amount: '100',
      expense_account: 'expense',
      payment_account: 'bank',
    },
  }
  const t = {
    id: 't',
    household_id: 'h',
    transaction_date: '2026-10-01',
    description: '납부',
    memo: null,
    created_by: 'u',
    updated_at: '',
    is_opening: false,
    lines: [
      { account_id: 'expense', entry_type: 'DEBIT' as const, amount: '100' },
      { account_id: 'bank', entry_type: 'CREDIT' as const, amount: '100' },
    ],
  }
  assert.equal(linkNeedsReview(link, [t]), false)
  assert.equal(linkNeedsReview(link, []), true)
  assert.equal(linkNeedsReview(link, [{ ...t, transaction_date: '2026-10-02' }]), true)
  assert.equal(
    linkNeedsReview(link, [{ ...t, lines: t.lines.map((l) => ({ ...l, amount: '101' })) }]),
    true,
  )
})
