<script setup lang="ts">
const route = useRoute()
const { householdId } = useHousehold(),
  { transactions } = useTransactions(),
  { loading } = useLedger()
const { preferences, toggleFavorite, error: storageError } = useWorkflowPreferences()
const favoriteId = computed(() =>
  typeof route.query.favorite === 'string' ? route.query.favorite : '',
)
const { accounts } = useAccounts()
const copyId = computed(() => (typeof route.query.copy === 'string' ? route.query.copy : ''))
const source = computed(() =>
  favoriteId.value
    ? preferences.value.favorites.find((t) => t.id === favoriteId.value)
    : transactions.value.find((t) => t.id === copyId.value && !t.is_opening),
)
const recent = computed(() => {
  const seen = new Set<string>()
  return transactions.value
    .filter((t) => {
      if (t.is_opening) return false
      const signature = JSON.stringify([
        t.description,
        t.lines.map((l) => [l.account_id, l.entry_type, l.amount, l.memo]),
      ])
      if (seen.has(signature)) return false
      seen.add(signature)
      return true
    })
    .slice(0, 5)
})
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">오늘의 한 줄</span>
      <h1>{{ copyId ? '거래 복사' : '거래 기록' }}</h1>
      <p class="muted">익숙한 방식으로 입력하면, 균형 잡힌 기록이 완성돼요.</p>
    </div>
  </div>
  <p v-if="storageError" class="alert" role="alert">{{ storageError }}</p>
  <section
    v-if="!copyId && !favoriteId && preferences.favorites.length"
    class="panel recent-copy"
    aria-label="즐겨찾는 거래"
  >
    <h2>즐겨찾는 거래</h2>
    <p class="fineprint">
      목록의 ☆로 추가해요. 최대 20개를 이 브라우저에 저장하며 날짜는 오늘로 복사됩니다.
    </p>
    <div v-for="t in preferences.favorites" :key="t.id" class="split">
      <NuxtLink class="secondary" :to="'/transactions/new?favorite=' + t.id"
        >{{ t.description }} · 입력</NuxtLink
      ><button
        class="text-button"
        @click="toggleFavorite(t)"
        :aria-label="t.description + ' 즐겨찾기 해제'"
      >
        해제
      </button>
    </div>
  </section>
  <section
    v-if="!copyId && !favoriteId && recent.length"
    class="panel recent-copy"
    aria-label="최근 거래 복사"
  >
    <h2>최근 거래에서 빠르게 시작</h2>
    <div class="copy-shortcuts">
      <NuxtLink
        v-for="t in recent"
        :key="t.id"
        :to="`/transactions/new?copy=${t.id}`"
        class="secondary"
        >{{ t.description }} <span>복사 ↗</span></NuxtLink
      >
    </div>
  </section>
  <TransactionForm
    v-if="((!copyId && !favoriteId) || source) && (!favoriteId || accounts.length > 0)"
    :key="householdId + ':' + (source?.id || 'new')"
    :copy-from="source"
  />
  <p v-else-if="loading" class="panel" role="status">복사할 거래를 불러오고 있어요…</p>
  <div v-else class="panel">
    <p>
      복사할 수 없는 거래입니다. 삭제되었거나 다른 가계부의 거래인지 확인하세요. 초기 자산 거래는
      복사하지 않습니다.
    </p>
    <NuxtLink to="/transactions" class="secondary">거래 목록</NuxtLink>
  </div>
</template>
