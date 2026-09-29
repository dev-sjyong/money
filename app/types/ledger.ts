export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'
export type EntryType = 'DEBIT' | 'CREDIT'
export type TransactionKind = 'expense' | 'income' | 'transfer' | 'card' | 'loan' | 'journal'
export interface Account {
  id: string
  household_id: string
  name: string
  code: string | null
  type: AccountType
  parent_account_id: string | null
  is_system: boolean
  is_archived: boolean
}
export interface Line {
  account_id: string
  entry_type: EntryType
  amount: string
  memo?: string | null
}
export interface Transaction {
  id: string
  household_id: string
  transaction_date: string
  description: string
  memo: string | null
  created_by: string
  updated_at: string
  is_opening: boolean
  lines: Line[]
}
export interface Budget {
  id: string
  account_id: string
  year: number
  month: number
  amount: string
}
export interface Member {
  id: string
  user_id: string
  role: 'OWNER' | 'MEMBER'
}
export interface Household {
  id: string
  name: string
  created_by: string
}
export interface Snapshot {
  accounts: Account[]
  transactions: Transaction[]
  budgets: Budget[]
  members: Member[]
}
export const accountLabels: Record<AccountType, string> = {
  ASSET: '자산',
  LIABILITY: '부채',
  EQUITY: '자본',
  INCOME: '수입',
  EXPENSE: '지출',
}
export const kindLabels: Record<TransactionKind, string> = {
  expense: '지출',
  income: '수입',
  transfer: '계좌이체',
  card: '카드대금',
  loan: '대출상환',
  journal: '직접분개',
}

export type HistoryAction = 'BASELINE' | 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE'
export interface HistorySnapshot extends Transaction {
  created_at: string
  lines: (Line & { account_name?: string })[]
}
export interface TransactionHistory {
  id: string
  household_id: string
  transaction_id: string
  action: HistoryAction
  actor_id: string | null
  before_snapshot: HistorySnapshot | null
  after_snapshot: HistorySnapshot | null
  created_at: string
}
export interface TrashTransaction {
  transaction_id: string
  household_id: string
  snapshot: HistorySnapshot
  deleted_by: string
  deleted_at: string
}
export const historyLabels: Record<HistoryAction, string> = {
  BASELINE: '이력 기능 도입 시점',
  CREATE: '거래 등록',
  UPDATE: '거래 수정',
  DELETE: '휴지통 이동',
  RESTORE: '거래 복구',
}
