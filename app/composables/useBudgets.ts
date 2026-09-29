import { budgetUsage, topBudgets } from '~/utils/accounting'
export function useBudgets(month: Ref<string>) {
  const { data } = useLedger()
  const budgets = computed(() =>
    data.value.budgets.filter(
      (b) => `${b.year}-${String(b.month).padStart(2, '0')}` === month.value,
    ),
  )
  const rows = computed(() =>
    budgets.value.map((b) => ({
      ...b,
      used: budgetUsage(data.value.accounts, data.value.transactions, b),
    })),
  )
  const summary = computed(() =>
    topBudgets(data.value.accounts, budgets.value).reduce(
      (s, b) => ({
        total: s.total + BigInt(b.amount),
        used: s.used + budgetUsage(data.value.accounts, data.value.transactions, b),
      }),
      { total: 0n, used: 0n },
    ),
  )
  return { rows, summary }
}
