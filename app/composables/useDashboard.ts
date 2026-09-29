import { totals, pastMonths, monthEnd, balanceMap } from '~/utils/accounting'
export function useDashboard(month: Ref<string>) {
  const { data } = useLedger()
  const summary = computed(() => totals(data.value.accounts, data.value.transactions, month.value))
  const trend = computed(() =>
    pastMonths(month.value).map((m) => ({
      label: m.slice(5) + '월',
      value: totals(data.value.accounts, data.value.transactions, m, monthEnd(m)).netWorth,
    })),
  )
  const expenses = computed(() => {
    const balances = balanceMap(
      data.value.accounts,
      data.value.transactions.filter((t) => t.transaction_date.startsWith(month.value)),
    )
    return data.value.accounts
      .filter((a) => a.type === 'EXPENSE' && !a.parent_account_id)
      .map((a) => {
        const ids = new Set([a.id])
        let n = 0
        while (n !== ids.size) {
          n = ids.size
          data.value.accounts.forEach((c) => {
            if (c.parent_account_id && ids.has(c.parent_account_id)) ids.add(c.id)
          })
        }
        return {
          label: a.name,
          value: [...ids].reduce((s, id) => s + (balances.get(id) || 0n), 0n),
        }
      })
      .filter((a) => a.value !== 0n)
      .sort((a, b) => (a.value > b.value ? -1 : 1))
  })
  return { summary, trend, expenses }
}
