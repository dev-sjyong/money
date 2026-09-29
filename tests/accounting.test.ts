import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  amount,
  simpleLines,
  validateLines,
  totals,
  balanceMap,
  budgetUsage,
  topBudgets,
  descendantIds,
  monthEnd,
  pastMonths,
} from '../app/utils/accounting'
import type { Account, Transaction, Line, Budget } from '../app/types/ledger'
const account = (id: string, type: Account['type'], parent: string | null = null): Account => ({
  id,
  name: id,
  type,
  household_id: 'h',
  parent_account_id: parent,
  is_system: false,
  is_archived: false,
  code: null,
})
const accounts = [
  account('bank', 'ASSET'),
  account('saving', 'ASSET'),
  account('cash', 'ASSET'),
  account('card', 'LIABILITY'),
  account('equity', 'EQUITY'),
  account('salary', 'INCOME'),
  account('food', 'EXPENSE'),
  account('dining', 'EXPENSE', 'food'),
]
const get = (id: string) => accounts.find((a) => a.id === id)!
const tx = (lines: Line[], i: number): Transaction => ({
  id: String(i),
  household_id: 'h',
  transaction_date: '2026-10-01',
  description: 'test',
  memo: null,
  created_by: 'u',
  updated_at: '',
  is_opening: i === 0,
  lines,
})
test('required accounting scenario: every step balances and matches assets, liabilities, net worth, income, expense', () => {
  const transactions = [
    tx(
      [
        { account_id: 'bank', entry_type: 'DEBIT', amount: '4000000' },
        { account_id: 'saving', entry_type: 'DEBIT', amount: '10000000' },
        { account_id: 'card', entry_type: 'CREDIT', amount: '500000' },
        { account_id: 'equity', entry_type: 'CREDIT', amount: '13500000' },
      ],
      0,
    ),
  ]
  const expected = [
    [14000000n, 500000n, 13500000n, 0n, 0n],
    [18000000n, 500000n, 17500000n, 4000000n, 0n],
    [18000000n, 550000n, 17450000n, 4000000n, 50000n],
    [18000000n, 550000n, 17450000n, 4000000n, 50000n],
    [17500000n, 50000n, 17450000n, 4000000n, 50000n],
    [17480000n, 50000n, 17430000n, 4000000n, 70000n],
  ]
  const entries = [
    simpleLines('income', get('bank'), get('salary'), '4000000'),
    simpleLines('expense', get('dining'), get('card'), '50000'),
    simpleLines('transfer', get('saving'), get('bank'), '1000000'),
    simpleLines('card', get('card'), get('bank'), '500000'),
    simpleLines('expense', get('food'), get('cash'), '20000'),
  ]
  for (let i = 0; i < 6; i++) {
    if (i) transactions.push(tx(entries[i - 1]!, i))
    for (const t of transactions) validateLines(t.lines)
    const s = totals(accounts, transactions, '2026-10')
    assert.deepEqual([s.assets, s.liabilities, s.netWorth, s.income, s.expense], expected[i])
  }
  assert.deepEqual(
    [...balanceMap(accounts, transactions)],
    [
      ['bank', 6500000n],
      ['saving', 11000000n],
      ['cash', -20000n],
      ['card', 50000n],
      ['equity', 13500000n],
      ['salary', 4000000n],
      ['food', 20000n],
      ['dining', 50000n],
    ],
  )
})
test('money remains exact above JS safe integer and rejects invalid/overflow values', () => {
  assert.equal(amount('9007199254740993'), 9007199254740993n)
  for (const v of ['0', '-1', '1.1', '1e4', '', '9223372036854775808'])
    assert.throws(() => amount(v))
  assert.throws(() =>
    validateLines([
      { account_id: 'a', entry_type: 'DEBIT', amount: '1' },
      { account_id: 'b', entry_type: 'CREDIT', amount: '2' },
    ]),
  )
})
test('transfer and repayment validate types; same account and foreign tenant cannot be used', () => {
  assert.throws(() => simpleLines('transfer', get('food'), get('bank'), '100'))
  assert.throws(() => simpleLines('transfer', get('bank'), get('bank'), '100'))
  assert.throws(() =>
    simpleLines('expense', get('food'), { ...get('bank'), household_id: 'other' }, '100'),
  )
  assert.throws(() =>
    simpleLines('expense', get('food'), { ...get('bank'), is_archived: true }, '100'),
  )
})
test('budgets include descendants and exclude overlapping child budgets from total', () => {
  const b: Budget = { id: 'b1', account_id: 'food', year: 2026, month: 10, amount: '600000' }
  const child: Budget = { ...b, id: 'b2', account_id: 'dining', amount: '200000' }
  const t = tx(simpleLines('expense', get('dining'), get('card'), '50000'), 1)
  assert.equal(budgetUsage(accounts, [t], b), 50000n)
  assert.equal(budgetUsage(accounts, [{ ...t, transaction_date: '2026-11-01' }], b), 0n)
  assert.deepEqual(topBudgets(accounts, [b, child]), [b])
  assert.deepEqual(descendantIds(accounts, 'food'), new Set(['food', 'dining']))
})
test('refunds lower expenses while budget follows debit-only specification', () => {
  const ts = [
    tx(simpleLines('expense', get('dining'), get('card'), '50000'), 1),
    tx(
      [
        { account_id: 'card', entry_type: 'DEBIT', amount: '10000' },
        { account_id: 'dining', entry_type: 'CREDIT', amount: '10000' },
      ],
      2,
    ),
  ]
  assert.equal(totals(accounts, ts, '2026-10').expense, 40000n)
  assert.equal(
    budgetUsage(accounts, ts, {
      id: 'b',
      account_id: 'food',
      year: 2026,
      month: 10,
      amount: '60000',
    }),
    50000n,
  )
})
test('historical balances respect dates and month boundaries', () => {
  const t = tx(simpleLines('income', get('bank'), get('salary'), '100'), 1)
  assert.equal(totals(accounts, [t], '2026-09', '2026-09-30').netWorth, 0n)
  assert.equal(monthEnd('2024-02'), '2024-02-29')
  assert.deepEqual(pastMonths('2026-02', 3), ['2025-12', '2026-01', '2026-02'])
})

// Input and copy tests share the exact bigint/line helpers used by the UI.
test('copy keeps source immutable, defaults to today and preserves all split-line memos', async () => {
  const { copyTransactionDraft, inferTransactionKind } =
    await import('../app/utils/transactionDraft')
  const source = tx(
    [
      { account_id: 'food', entry_type: 'DEBIT', amount: '1000', memo: '분개 메모' },
      { account_id: 'cash', entry_type: 'CREDIT', amount: '1000' },
    ],
    1,
  )
  source.transaction_date = '2020-01-01'
  source.memo = '전체 메모'
  const draft = copyTransactionDraft(source)
  assert.notEqual(draft.date, source.transaction_date)
  assert.equal(draft.memo, '전체 메모')
  assert.equal(draft.lines[0]!.memo, '분개 메모')
  draft.lines[0]!.amount = '2000'
  assert.equal(source.lines[0]!.amount, '1000')
  assert.equal(inferTransactionKind(source.lines, accounts), 'journal')
  assert.equal(
    inferTransactionKind(simpleLines('expense', get('food'), get('cash'), '1000'), accounts),
    'expense',
  )
  assert.equal(
    inferTransactionKind(simpleLines('income', get('bank'), get('salary'), '1000'), accounts),
    'income',
  )
  assert.equal(
    inferTransactionKind(simpleLines('transfer', get('saving'), get('bank'), '1000'), accounts),
    'transfer',
  )
  assert.equal(
    inferTransactionKind(simpleLines('card', get('card'), get('bank'), '1000'), accounts),
    'journal',
  )
  assert.throws(() => copyTransactionDraft({ ...source, is_opening: true }))
})
test('mobile amount input supports commas and quick additions without precision loss', async () => {
  const { displayAmount, normalizeAmountInput, incrementAmount } =
    await import('../app/utils/transactionDraft')
  assert.equal(displayAmount('9007199254740993'), '9,007,199,254,740,993')
  assert.equal(normalizeAmountInput('0012,345'), '12345')
  assert.equal(incrementAmount('9007199254740993', 1000n), '9007199254741993')
  assert.equal(incrementAmount('', 1000n), '1000')
  assert.equal(normalizeAmountInput('-1'), '-1')
  assert.equal(normalizeAmountInput('1.5'), '1.5')
  assert.throws(() => incrementAmount('1.5', 1000n))
  assert.throws(() => incrementAmount('9223372036854775807', 1000n))
})
