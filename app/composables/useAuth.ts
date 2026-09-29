import type { User } from '@supabase/supabase-js'
import type { Household, Snapshot } from '~/types/ledger'
export function useAuth() {
  const user = useState<User | null>('auth-user', () => null)
  const ready = useState('auth-ready', () => false)
  const { $supabase } = useNuxtApp()
  const householdId = useState<string>('household-id', () => '')
  const households = useState<Household[]>('households', () => [])
  const ledger = useState<Snapshot>('ledger', () => ({
    accounts: [],
    transactions: [],
    budgets: [],
    members: [],
  }))
  async function init() {
    if (ready.value) return
    if ($supabase) {
      const { data } = await $supabase.auth.getSession()
      user.value = data.session?.user ?? null
      $supabase.auth.onAuthStateChange((_event, session) => {
        const previous = user.value?.id
        user.value = session?.user ?? null
        if (previous !== user.value?.id) {
          householdId.value = ''
          households.value = []
          ledger.value = { accounts: [], transactions: [], budgets: [], members: [] }
        }
        if (_event === 'SIGNED_OUT' && !location.pathname.startsWith('/login'))
          void navigateTo('/login')
      })
    }
    ready.value = true
  }
  async function signOut() {
    const result = await $supabase?.auth.signOut()
    if (result?.error) throw result.error
    user.value = null
    await navigateTo('/login')
  }
  return { user, ready, init, signOut, configured: !!$supabase }
}
