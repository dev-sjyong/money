import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fixedDue,
  fixedRows,
  fixedSummary,
  ruleAt,
  koreaToday,
  fixedMonth,
} from '../app/utils/fixed'
import type { FixedSnapshot, FixedTemplate } from '../app/types/fixed'
import type { Transaction } from '../app/types/ledger'
const template: FixedTemplate = {
  id: 'f',
  household_id: 'h',
  revision: 2,
  rules: [
    {
      effective_month: '2026-01-01',
      title: '통신비',
      amount: '50000',
      due_day: 31,
      expense_account: 'expense',
      payment_account: 'bank',
      end_month: null,
      active: true,
    },
    {
      effective_month: '2026-10-01',
      title: '통신비',
      amount: '60000',
      due_day: 25,
      expense_account: 'expense',
      payment_account: 'bank',
      end_month: null,
      active: true,
    },
  ],
}
const snapshot: FixedSnapshot = { templates: [template], records: [], linked_transactions: [] }
const transaction: Transaction = {
  id: 't',
  household_id: 'h',
  transaction_date: '2026-09-20',
  description: '요금',
  memo: null,
  is_opening: false,
  created_by: 'u',
  updated_at: '',
  lines: [
    { account_id: 'expense', entry_type: 'DEBIT', amount: '49000' },
    { account_id: 'bank', entry_type: 'CREDIT', amount: '49000' },
  ],
}
test('monthly rules clamp dates and retain old amounts before change, stop and resume', () => {
  assert.equal(fixedDue('2024-02', 31), '2024-02-29')
  assert.equal(fixedDue('2025-02', 31), '2025-02-28')
  assert.equal(ruleAt(template, '2026-09')!.amount, '50000')
  assert.equal(ruleAt(template, '2026-10')!.amount, '60000')
  assert.equal(fixedRows(snapshot, '2025-12', [], '2026-09-30').length, 0)
  const s = structuredClone(snapshot)
  s.templates[0]!.rules[1]!.active = false
  assert.equal(fixedRows(s, '2026-10', [], '2026-09-30').length, 0)
  assert.equal(fixedRows(s, '2026-09', [], '2026-09-30').length, 1)
  s.templates[0]!.rules[0]!.end_month = '2026-08-01'
  assert.equal(fixedRows(s, '2026-09', [], '2026-09-30').length, 0)
  assert.equal(fixedMonth('2026-13'), false)
  assert.match(koreaToday(), /^\d{4}-\d{2}-\d{2}$/)
})
test('actual amount stays independent of estimate; edited/deleted/restored transactions change status', () => {
  const s = structuredClone(snapshot),
    expected = fixedRows(s, '2026-09', [], '2026-09-30')[0]!.expected
  s.records = [
    {
      fixed_id: 'f',
      household_id: 'h',
      month: '2026-09-01',
      snapshot: expected,
      transaction_id: 't',
      skipped: false,
      revision: 1,
    },
  ]
  let rows = fixedRows(s, '2026-09', [transaction], '2026-09-30')
  assert.equal(rows[0]!.status, 'paid')
  assert.equal(fixedSummary(rows).paid, 49000n)
  assert.equal(fixedSummary(rows).remaining, 0n)
  assert.equal(fixedRows(s, '2026-09', [], '2026-09-30')[0]!.status, 'review')
  const changed = structuredClone(transaction)
  changed.lines[0]!.account_id = 'other'
  assert.equal(fixedRows(s, '2026-09', [changed], '2026-09-30')[0]!.status, 'review')
  assert.equal(fixedRows(s, '2026-09', [transaction], '2026-09-30')[0]!.status, 'paid')
  s.templates[0]!.rules[0]!.amount = '99999'
  assert.equal(fixedRows(s, '2026-09', [transaction], '2026-09-30')[0]!.expected.amount, '50000')
  s.records[0]!.transaction_id = null
  s.records[0]!.skipped = true
  assert.equal(fixedSummary(fixedRows(s, '2026-09', [], '2026-09-30')).expected, 0n)
})
test('pending forecasts never become actual paid totals and amounts remain exact', () => {
  const s = structuredClone(snapshot)
  s.templates[0]!.rules[0]!.amount = '9007199254740993'
  const rows = fixedRows(s, '2026-08', [], '2026-09-30')
  assert.equal(rows[0]!.status, 'overdue')
  assert.equal(fixedSummary(rows).remaining, 9007199254740993n)
  assert.equal(fixedSummary(rows).paid, 0n)
  assert.equal(fixedRows(s, '2026-08', [], '2026-08-31')[0]!.status, 'pending')
})
