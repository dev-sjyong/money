import type { TransactionHistory, TrashTransaction } from '~/types/ledger'
export function useTransactionHistory() {
  const { rpc } = useLedger()
  return {
    history: (household: string, transaction: string) =>
      rpc<TransactionHistory[]>('get_transaction_history', {
        p_household: household,
        p_transaction: transaction,
      }),
    trash: (household: string) =>
      rpc<TrashTransaction[]>('get_transaction_trash', { p_household: household }),
  }
}
