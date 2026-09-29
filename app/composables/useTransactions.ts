import type { Line, Transaction, TrashTransaction } from '~/types/ledger'
import { validateLines } from '~/utils/accounting'
export function useTransactions() {
  const { rpc, refresh, data } = useLedger()
  const { householdId } = useHousehold()
  return {
    transactions: computed(() => data.value.transactions),
    async save(
      input: { date: string; description: string; memo: string; lines: Line[]; id: string },
      existing?: Transaction,
    ) {
      validateLines(input.lines)
      if (existing)
        await rpc('update_transaction', {
          p_id: existing.id,
          p_date: input.date,
          p_description: input.description,
          p_memo: input.memo || null,
          p_lines: input.lines,
          p_expected_updated_at: existing.updated_at,
        })
      else
        await rpc('create_transaction', {
          p_id: input.id,
          p_household: householdId.value,
          p_date: input.date,
          p_description: input.description,
          p_memo: input.memo || null,
          p_lines: input.lines,
        })
      await refresh()
    },
    async restore(t: TrashTransaction) {
      await rpc('restore_transaction', {
        p_id: t.transaction_id,
        p_expected_deleted_at: t.deleted_at,
      })
      await refresh()
    },
    async remove(t: Transaction) {
      await rpc('delete_transaction', { p_id: t.id, p_expected_updated_at: t.updated_at })
      await refresh()
    },
  }
}
