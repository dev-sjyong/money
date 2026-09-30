import test from 'node:test'
import assert from 'node:assert/strict'
import type { Account, Transaction, Line } from '../app/types/ledger'
import {
  monthlyRange,
  previousRange,
  validRange,
  categoryReport,
  periodFlow,
  transactionFlow,
  positionAt,
  monthlySeries,
  changePercent,
  reportCsv,
  ratioPercent,
} from '../app/utils/analytics'
const account = (id: string, type: Account['type'], parent: string | null = null): Account => ({
  id,
  name: id,
  type,
  parent_account_id: parent,
  household_id: 'h',
  code: null,
  is_system: false,
  is_archived: false,
})
const accounts = [
  account('bank', 'ASSET'),
  account('saving', 'ASSET'),
  account('card', 'LIABILITY'),
  account('equity', 'EQUITY'),
  account('salary', 'INCOME'),
  account('food', 'EXPENSE'),
  account('dining', 'EXPENSE', 'food'),
  account('transport', 'EXPENSE'),
]
let id = 0
const tx = (date: string, lines: Line[]): Transaction => ({
  id: String(++id),
  household_id: 'h',
  transaction_date: date,
  description: 'example',
  memo: null,
  created_by: 'u',
  updated_at: '',
  is_opening: false,
  lines,
})
const pair = (debit: string, credit: string, amount: string): Line[] => [
  { account_id: debit, entry_type: 'DEBIT', amount },
  { account_id: credit, entry_type: 'CREDIT', amount },
]
const range = { start: '2026-09-01', end: '2026-09-30' },
  previous = { start: '2026-08-01', end: '2026-08-31' }
const transactions = [
  tx('2026-08-01', pair('bank', 'equity', '1000000')),
  tx('2026-08-25', pair('transport', 'bank', '100')),
  tx('2026-09-01', pair('bank', 'salary', '1000')),
  tx('2026-09-02', pair('dining', 'card', '300')),
  tx('2026-09-03', pair('bank', 'dining', '50')),
  tx('2026-09-04', pair('saving', 'bank', '100')),
  tx('2026-09-05', pair('card', 'bank', '100')),
  tx('2026-09-06', [
    { account_id: 'food', entry_type: 'DEBIT', amount: '100' },
    { account_id: 'transport', entry_type: 'DEBIT', amount: '200' },
    { account_id: 'bank', entry_type: 'CREDIT', amount: '300' },
  ]),
  tx('2026-10-01', pair('food', 'bank', '999')),
]
test('calendar comparisons handle year boundaries, leap years and custom day counts', () => {
  assert.deepEqual(monthlyRange('2024-02', 1), { start: '2024-02-01', end: '2024-02-29' })
  assert.deepEqual(previousRange(monthlyRange('2026-02', 3), 3), {
    start: '2025-09-01',
    end: '2025-11-30',
  })
  assert.deepEqual(previousRange({ start: '2024-03-01', end: '2024-03-10' }), {
    start: '2024-02-20',
    end: '2024-02-29',
  })
  for (const r of [
    { start: '', end: '' },
    { start: '2026-02-30', end: '2026-03-01' },
    { start: '2026-10-01', end: '2026-09-01' },
    { start: '1901-01-01', end: '1901-01-31' },
    { start: '2020-01-01', end: '2026-01-01' },
  ])
    assert.equal(validRange(r), false)
})
test('net expense subtracts refunds and excludes transfers and debt repayments', () => {
  const s = periodFlow(accounts, transactions, range)
  assert.equal(s.income, 1000n)
  assert.equal(s.expense, 550n)
  assert.equal(s.surplus, 450n)
  assert.equal(s.grossExpense, 600n)
  assert.equal(s.refund, 50n)
  assert.equal(s.count, 4)
  const end = positionAt(accounts, transactions, range.end)
  assert.equal(end.netWorth, 1000350n)
  assert.equal(positionAt(accounts, transactions, '2026-08-31').netWorth, 999900n)
  assert.equal(end.netWorth - positionAt(accounts, transactions, '2026-08-31').netWorth, s.surplus)
})
test('category grouping never double counts parent or split lines; archived accounts remain included', () => {
  accounts.find((a) => a.id === 'dining')!.is_archived = true
  const root = categoryReport(accounts, transactions, range, previous, 'root')
  assert.equal(root.find((c) => c.id === 'food')!.current, 350n)
  assert.equal(
    root.reduce((s, c) => s + c.current, 0n),
    550n,
  )
  const direct = categoryReport(accounts, transactions, range, previous, 'account')
  assert.equal(direct.find((c) => c.id === 'food')!.current, 100n)
  assert.equal(direct.find((c) => c.id === 'dining')!.current, 250n)
  assert.equal(
    transactionFlow(accounts, transactions[7]!, root.find((c) => c.id === 'food')!.ids).expense,
    100n,
  )
  const emptyCurrent = categoryReport(
    accounts,
    transactions,
    { start: '2026-11-01', end: '2026-11-30' },
    previous,
    'root',
  )
  assert.equal(emptyCurrent.find((c) => c.id === 'transport')!.previous, 100n)
})
test('full refunds remain drillable, negative expense and partial months keep their sign', () => {
  const t = [
    tx('2026-09-02', pair('food', 'bank', '100')),
    tx('2026-09-03', pair('bank', 'food', '100')),
  ]
  assert.equal(categoryReport(accounts, t, range, previous, 'root').length, 1)
  t.push(tx('2026-09-04', pair('bank', 'food', '50')))
  assert.equal(periodFlow(accounts, t, range).expense, -50n)
  assert.equal(
    monthlySeries(accounts, transactions, { start: '2026-09-03', end: '2026-10-01' })[0]!.expense,
    250n,
  )
})
test('large integer calculations, zero baselines and CSV spreadsheet injection protection', () => {
  const large = [tx('2026-09-01', pair('food', 'bank', '9007199254740993'))]
  assert.equal(periodFlow(accounts, large, range).expense, 9007199254740993n)
  assert.equal(changePercent(200n, 100n), '+100.0%')
  assert.equal(changePercent(100n, 0n), null)
  assert.equal(changePercent(-50n, 100n), '-150.0%')
  assert.equal(ratioPercent(-1n, 2n), '-50.0%')
  const csv = reportCsv([['=HYPERLINK("bad")', 'a,"b"\nline', 9007199254740993n, -10n]])
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes("'=HYPERLINK"))
  assert.ok(csv.includes('9007199254740993'))
  assert.ok(csv.includes('"-10"'))
  assert.ok(csv.includes('a,""b""\nline'))
})
