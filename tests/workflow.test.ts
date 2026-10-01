import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  duplicateCandidates,
  duplicateGroups,
  transactionAmount,
  monthReviewSignature,
} from '../app/utils/workflow'
import type { Transaction } from '../app/types/ledger'
const t: Transaction = {
  id: 't',
  household_id: 'h',
  transaction_date: '2026-09-01',
  description: '식비',
  memo: null,
  created_by: 'u',
  updated_at: '1',
  is_opening: false,
  lines: [
    { account_id: 'expense', entry_type: 'DEBIT', amount: '9007199254740993' },
    { account_id: 'bank', entry_type: 'CREDIT', amount: '9007199254740993' },
  ],
}
test('duplicate compares dates and full journal, handles line order and edit exclusion', () => {
  assert.equal(duplicateCandidates([t], t.transaction_date, [...t.lines].reverse()).length, 1)
  assert.equal(duplicateCandidates([t], t.transaction_date, t.lines, 't').length, 0)
  assert.equal(duplicateCandidates([t], '2026-09-02', t.lines).length, 0)
  assert.equal(
    duplicateCandidates([{ ...t, is_opening: true }], t.transaction_date, t.lines).length,
    0,
  )
  assert.equal(
    duplicateGroups([t, { ...t, id: '2' }, { ...t, id: '3', transaction_date: '2026-09-02' }])
      .length,
    1,
  )
  assert.equal(transactionAmount(t), 9007199254740993n)
})
test('month review detects past corrections and removal, ignores later transactions', () => {
  const signature = monthReviewSignature([], [t], '2026-09-30', [])
  assert.equal(
    monthReviewSignature(
      [],
      [t, { ...t, id: 'future', transaction_date: '2026-10-01' }],
      '2026-09-30',
      [],
    ),
    signature,
  )
  assert.notEqual(
    monthReviewSignature([], [{ ...t, updated_at: '2' }], '2026-09-30', []),
    signature,
  )
  assert.notEqual(monthReviewSignature([], [], '2026-09-30', []), signature)
  assert.notEqual(monthReviewSignature([], [t], '2026-09-30', ['changed']), signature)
})
