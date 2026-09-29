import type { Household } from '~/types/ledger'
export function useHousehold() {
  const households = useState<Household[]>('households', () => []),
    householdId = useState<string>('household-id', () => ''),
    { $supabase } = useNuxtApp()
  const current = computed(() => households.value.find((h) => h.id === householdId.value))
  const { user } = useAuth()
  async function load() {
    const requestedUser = user.value?.id
    if (!$supabase) return
    const { data, error } = await $supabase
      .from('households')
      .select('id,name,created_by')
      .order('created_at')
    if (requestedUser !== user.value?.id) return
    if (error) throw error
    households.value = data
    if (!data.some((h) => h.id === householdId.value)) householdId.value = data[0]?.id ?? ''
  }
  return { households, householdId, current, load }
}
