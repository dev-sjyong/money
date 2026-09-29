<script setup lang="ts">
import type { TrashTransaction } from '~/types/ledger'
const { householdId } = useHousehold(),
  { isOwner } = useLedger(),
  { restore } = useTransactions()
const { trash } = useTransactionHistory(),
  { user } = useAuth()
const items = ref<TrashTransaction[]>([]),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  selected = ref<TrashTransaction | null>(null)
let generation = 0
async function load() {
  const token = ++generation,
    h = householdId.value
  items.value = []
  selected.value = null
  error.value = ''
  loading.value = false
  if (!h || !isOwner.value) return
  loading.value = true
  try {
    const result = await trash(h)
    if (token === generation && h === householdId.value) items.value = result
  } catch (e) {
    if (token === generation) error.value = message(e)
  } finally {
    if (token === generation) loading.value = false
  }
}
watch(
  [householdId, isOwner],
  () => {
    notice.value = ''
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  generation++
})
async function recover() {
  if (!selected.value || busy.value) return
  const h = householdId.value
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await restore(selected.value)
    if (h === householdId.value) {
      await load()
      notice.value = '거래를 복구했어요. 원래 날짜의 잔액·예산·보고서에 다시 반영됩니다.'
    }
  } catch (e) {
    if (h === householdId.value) error.value = message(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">실수해도 괜찮아요</span>
      <h1>거래 휴지통</h1>
      <p class="muted">삭제한 거래를 원래 날짜와 내용으로 복구해요.</p>
    </div>
    <NuxtLink to="/transactions" class="secondary">거래 목록</NuxtLink>
  </div>
  <div v-if="!isOwner" class="panel">휴지통 조회와 복구는 소유자만 할 수 있어요.</div>
  <template v-else>
    <p class="hint">
      휴지통의 거래는 잔액과 보고서에 포함되지 않아요. 보관된 계정이 있다면 먼저 계정을 복구하세요.
      이 기능 도입 전에 영구 삭제한 거래는 복구할 수 없습니다.
    </p>
    <div class="toolbar">
      <span>{{ items.length }}건</span
      ><button class="secondary" :disabled="loading || busy" @click="load">휴지통 새로고침</button>
    </div>
    <p v-if="notice" class="alert" role="status">{{ notice }}</p>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <div v-if="selected" class="panel restore-confirm" role="region" aria-label="거래 복구 확인">
      <h2>이 거래를 복구할까요?</h2>
      <p>{{ selected.snapshot.description }} · {{ selected.snapshot.transaction_date }}</p>
      <p class="fineprint">
        원래 거래가 다시 원장에 포함됩니다. 같은 거래를 새로 입력했는지 먼저 확인하세요.
      </p>
      <div class="form-actions">
        <button class="secondary" :disabled="busy" @click="selected = null">취소</button
        ><button class="button" :disabled="busy" @click="recover">
          {{ busy ? '복구 중…' : '복구 확인' }}
        </button>
      </div>
    </div>
    <p v-if="loading" class="panel" role="status">휴지통을 불러오고 있어요…</p>
    <p v-else-if="!items.length && !error" class="panel empty">휴지통이 비어 있어요.</p>
    <article v-for="item in items" :key="item.transaction_id" class="panel trash-item">
      <div class="section-title">
        <div>
          <h2>{{ item.snapshot.description }}</h2>
          <p class="muted small">
            {{ new Date(item.deleted_at).toLocaleString('ko-KR') }} ·
            {{ item.deleted_by === user?.id ? '나' : '소유자' }} 삭제
          </p>
        </div>
        <button class="button" :disabled="busy" @click="selected = item">복구</button>
      </div>
      <TransactionSnapshot :snapshot="item.snapshot" />
      <details class="trash-history">
        <summary>변경 이력 보기</summary>
        <TransactionHistory :transaction-id="item.transaction_id" :version="item.deleted_at" />
      </details>
    </article>
  </template>
</template>
