import { accountPath, balanceMap } from '~/utils/accounting'
export function useAccounts() {
  const { data } = useLedger()
  return {
    accounts: computed(() => data.value.accounts),
    active: computed(() => data.value.accounts.filter((a) => !a.is_archived)),
    balances: computed(() => balanceMap(data.value.accounts, data.value.transactions)),
    label: (id: string) => accountPath(data.value.accounts, id),
  }
}
