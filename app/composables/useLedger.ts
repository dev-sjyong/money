import type { Snapshot } from '~/types/ledger'
export function useLedger() {
  const data = useState<Snapshot>('ledger', () => ({
      accounts: [],
      transactions: [],
      budgets: [],
      members: [],
    })),
    loading = useState('ledger-loading', () => false),
    error = useState('ledger-error', () => ''),
    generation = useState('ledger-generation', () => 0)
  const { householdId } = useHousehold()
  const { user } = useAuth()
  const { $supabase } = useNuxtApp()
  async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!$supabase) throw new Error('Supabase 연결 설정이 필요합니다.')
    const { data: result, error: e } = await $supabase.rpc(name, args)
    if (e) throw new Error(e.message)
    return result as T
  }
  async function refresh() {
    const h = householdId.value,
      token = ++generation.value
    if (!h) {
      loading.value = false
      error.value = ''
      data.value = { accounts: [], transactions: [], budgets: [], members: [] }
      return
    }
    loading.value = true
    error.value = ''
    try {
      const next = await rpc<Snapshot>('ledger_snapshot', { p_household: h })
      if (token === generation.value && h === householdId.value) data.value = next
    } catch (e) {
      if (token === generation.value) error.value = message(e)
    } finally {
      if (token === generation.value) loading.value = false
    }
  }
  const isOwner = computed(() =>
    data.value.members.some((m) => m.user_id === user.value?.id && m.role === 'OWNER'),
  )
  return { data, loading, error, refresh, rpc, isOwner }
}
export function message(e: unknown) {
  return e instanceof Error ? e.message : '요청을 처리하지 못했습니다. 다시 시도하세요.'
}
