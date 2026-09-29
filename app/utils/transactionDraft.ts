import type { Account, Line, Transaction, TransactionKind } from '~/types/ledger'
import { MAX_AMOUNT, today } from './accounting'

// Keep amounts as strings all the way to the RPC, including numbers above 2^53.
export function displayAmount(value: string): string {
  return /^\d+$/.test(value) ? BigInt(value).toLocaleString('ko-KR') : value
}
export function normalizeAmountInput(value: string): string {
  const raw = value.replaceAll(',', '')
  return /^\d+$/.test(raw) ? raw.replace(/^0+(?=\d)/, '') : raw
}
export function incrementAmount(value: string, step: bigint): string {
  const raw = normalizeAmountInput(value)
  if (raw && !/^\d+$/.test(raw)) throw new Error('금액을 정수로 입력하세요.')
  const next = BigInt(raw || '0') + step
  if (next > MAX_AMOUNT) throw new Error('입력 가능한 금액을 초과했습니다.')
  return next.toString()
}
export function copyTransactionDraft(t: Transaction) {
  if (t.is_opening) throw new Error('초기 자산 거래는 복사할 수 없습니다.')
  return {
    date: today(),
    description: t.description,
    memo: t.memo ?? '',
    lines: t.lines.map((l) => ({
      account_id: l.account_id,
      entry_type: l.entry_type,
      amount: l.amount,
      memo: l.memo ?? null,
    })),
  }
}
export function inferTransactionKind(lines: Line[], accounts: Account[]): TransactionKind {
  // A line memo must not disappear when converting a copied entry to simple mode.
  if (lines.length !== 2 || lines.some((l) => l.memo)) return 'journal'
  const d = lines.find((l) => l.entry_type === 'DEBIT'),
    c = lines.find((l) => l.entry_type === 'CREDIT')
  if (!d || !c || d.amount !== c.amount) return 'journal'
  const dt = accounts.find((a) => a.id === d.account_id)?.type
  const ct = accounts.find((a) => a.id === c.account_id)?.type
  if (dt === 'EXPENSE' && (ct === 'ASSET' || ct === 'LIABILITY')) return 'expense'
  if (dt === 'ASSET' && ct === 'INCOME') return 'income'
  if (dt === 'ASSET' && ct === 'ASSET') return 'transfer'
  // LIABILITY alone cannot distinguish a card repayment from a loan repayment.
  return 'journal'
}
