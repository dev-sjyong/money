<script setup lang="ts">
import { transactionAmount } from '~/utils/workflow'
import type { SavedFilter } from '~/composables/useWorkflowPreferences'
import { descendantIds, today } from '~/utils/accounting'
const { transactions } = useTransactions()
const { isOwner } = useLedger()
const { label } = useAccounts()
const search = ref(''),
  month = ref(today().slice(0, 7)),
  page = ref(1)
const { data } = useLedger(),
  { user } = useAuth(),
  { accounts } = useAccounts()
const { preferences, update, error: storageError } = useWorkflowPreferences()
const recorder = ref(''),
  account = ref(''),
  min = ref(''),
  max = ref(''),
  filterName = ref(''),
  savedId = ref('')
const inputError = computed(() =>
  [min.value, max.value].some((v) => v && !/^\d+$/.test(v))
    ? '금액 범위는 0 이상의 정수로 입력하세요.'
    : min.value && max.value && BigInt(min.value) > BigInt(max.value)
      ? '최소 금액이 최대 금액보다 커요.'
      : '',
)
const filtered = computed(() => {
  if (inputError.value) return []
  const ids = account.value ? descendantIds(accounts.value, account.value) : null
  return transactions.value.filter(
    (t) =>
      (!month.value || t.transaction_date.startsWith(month.value)) &&
      (!recorder.value || t.created_by === recorder.value) &&
      (!ids || t.lines.some((l) => ids.has(l.account_id))) &&
      (!min.value || transactionAmount(t) >= BigInt(min.value)) &&
      (!max.value || transactionAmount(t) <= BigInt(max.value)) &&
      `${t.description} ${t.memo || ''} ${t.lines.map((l) => label(l.account_id)).join(' ')}`
        .toLowerCase()
        .includes(search.value.trim().toLowerCase()),
  )
})
watch([search, month, recorder, account, min, max], () => (page.value = 1))
const count = computed(() => Math.max(1, Math.ceil(filtered.value.length / 25)))
watch(count, (n) => (page.value = Math.min(page.value, n)))
function reset() {
  search.value = ''
  month.value = ''
  recorder.value = ''
  account.value = ''
  min.value = ''
  max.value = ''
  savedId.value = ''
}
function saveFilter() {
  if (!filterName.value.trim() || inputError.value) return
  update((p) => {
    p.filters = [
      {
        id: crypto.randomUUID(),
        name: filterName.value.trim().slice(0, 40),
        search: search.value,
        month: month.value,
        recorder: recorder.value,
        account: account.value,
        min: min.value,
        max: max.value,
      },
      ...p.filters.filter((f) => f.name !== filterName.value.trim()),
    ].slice(0, 10)
  })
  filterName.value = ''
}
function removeFilter() {
  update((p) => {
    p.filters = p.filters.filter((f) => f.id !== savedId.value)
  })
  savedId.value = ''
}
function applyFilter(f?: SavedFilter) {
  if (!f) return
  search.value = f.search
  month.value = f.month
  recorder.value = f.recorder
  account.value = f.account
  min.value = f.min
  max.value = f.max
}
watch(savedId, (id) => applyFilter(preferences.value.filters.find((f) => f.id === id)))
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">차곡차곡 쌓인 일상</span>
      <h1>거래 내역</h1>
      <p class="muted">작은 기록 하나까지, 우리 돈의 흐름.</p>
    </div>
    <div class="heading-actions">
      <NuxtLink v-if="isOwner" to="/transactions/trash" class="secondary">휴지통</NuxtLink
      ><NuxtLink to="/transactions/new" class="button">＋ 거래 기록</NuxtLink>
    </div>
  </div>
  <section class="panel">
    <div class="toolbar">
      <input
        v-model="search"
        type="search"
        aria-label="거래 검색"
        placeholder="설명, 메모, 계정으로 검색"
      /><input v-model="month" type="month" aria-label="거래 조회 월" /><button
        class="secondary"
        @click="month = ''"
      >
        전체 기간</button
      ><span class="muted">{{ filtered.length }}건</span>
    </div>
    <details class="filter-details">
      <summary>상세 검색 · 조건 저장</summary>
      <div class="form-grid">
        <label
          >기록한 사람<select v-model="recorder">
            <option value="">전체 기록자</option>
            <option v-for="m in data.members" :key="m.user_id" :value="m.user_id">
              {{ m.user_id === user?.id ? '본인' : '배우자 / 함께 쓰는 사람' }}
            </option>
          </select></label
        >
        <label
          >계정 · 하위 항목 포함<select v-model="account">
            <option value="">전체 계정</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ label(a.id) }}</option>
          </select></label
        >
        <label>최소 거래 금액<input v-model="min" inputmode="numeric" placeholder="0" /></label
        ><label
          >최대 거래 금액<input v-model="max" inputmode="numeric" placeholder="제한 없음"
        /></label>
      </div>
      <p class="fineprint">
        금액은 거래의 차변 합계이며, 기록자는 실제 사용자가 아닌 거래를 등록한 사람이에요.
      </p>
      <div class="toolbar">
        <button class="secondary" @click="reset">검색 조건 초기화</button
        ><label
          >조건 이름<input
            v-model="filterName"
            maxlength="40"
            placeholder="예: 이번 달 통신비" /></label
        ><button
          class="secondary"
          :disabled="!filterName.trim() || !!inputError"
          @click="saveFilter"
        >
          현재 조건 저장
        </button>
      </div>
      <label
        >저장한 검색 조건<select v-model="savedId">
          <option value="">조건 선택</option>
          <option v-for="f in preferences.filters" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select></label
      >
      <button v-if="savedId" class="text-button danger" @click="removeFilter">
        선택 조건 삭제
      </button>
      <p class="fineprint">
        최대 10개 조건을 현재 브라우저의 사용자·가계부별로 저장해요. 같은 이름은 새 조건으로
        교체합니다.
      </p>
    </details>
    <p v-if="inputError || storageError" class="alert error" role="alert">
      {{ inputError || storageError }}
    </p>
    <TransactionTable
      :items="filtered.slice((page - 1) * 25, page * 25)"
      :empty-text="transactions.length ? '검색 조건에 맞는 거래가 없어요.' : undefined"
    />
    <div class="pagination">
      <button class="secondary" :disabled="page <= 1" @click="page--">이전</button
      ><span>{{ page }} / {{ count }}</span
      ><button class="secondary" :disabled="page >= count" @click="page++">다음</button>
    </div>
  </section>
</template>
