import type { Transaction, TransactionKind } from '~/types/ledger'
export interface SavedFilter {
  id: string
  name: string
  search: string
  month: string
  recorder: string
  account: string
  min: string
  max: string
}
interface Preferences {
  favorites: Transaction[]
  recent: Partial<Record<TransactionKind, { debit: string; credit: string }>>
  filters: SavedFilter[]
  reviews: Record<string, { signature: string; balances: Record<string, string> }>
}
function empty(): Preferences {
  return { favorites: [], recent: {}, filters: [], reviews: {} }
}
export function useWorkflowPreferences() {
  const { householdId } = useHousehold(),
    { user } = useAuth()
  const cache = useState<Record<string, Preferences>>('workflow-preferences', () => ({})),
    error = useState('workflow-storage-error', () => '')
  const key = computed(() =>
    user.value?.id && householdId.value
      ? `durun.workflow.v1:${user.value.id}:${householdId.value}`
      : '',
  )
  watch(
    key,
    (k) => {
      error.value = ''
      if (!k || cache.value[k]) return
      try {
        const raw = localStorage.getItem(k),
          v = raw ? JSON.parse(raw) : null
        cache.value[k] =
          v && Array.isArray(v.favorites) && Array.isArray(v.filters) && v.recent && v.reviews
            ? v
            : empty()
      } catch {
        cache.value[k] = empty()
        error.value = '이 브라우저에서 저장한 설정을 읽지 못했어요.'
      }
    },
    { immediate: true },
  )
  const preferences = computed(() => cache.value[key.value] ?? empty())
  function update(edit: (p: Preferences) => void) {
    if (!key.value) return
    const next = JSON.parse(JSON.stringify(preferences.value)) as Preferences
    edit(next)
    try {
      localStorage.setItem(key.value, JSON.stringify(next))
      cache.value[key.value] = next
      error.value = ''
    } catch {
      error.value = '브라우저 저장 공간을 사용할 수 없어 설정을 저장하지 못했어요.'
    }
  }
  function toggleFavorite(t: Transaction) {
    if (t.is_opening) return
    update((p) => {
      const exists = p.favorites.some((f) => f.id === t.id)
      p.favorites = exists
        ? p.favorites.filter((f) => f.id !== t.id)
        : [JSON.parse(JSON.stringify(t)), ...p.favorites].slice(0, 20)
    })
  }
  return { preferences, error, update, toggleFavorite }
}
