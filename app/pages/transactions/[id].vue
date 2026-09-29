<script setup lang="ts">
const route = useRoute()
const { transactions, remove } = useTransactions()
const { isOwner } = useLedger()
const t = computed(() => transactions.value.find((t) => t.id === route.params.id))
const error = ref(''),
  confirmDelete = ref(false),
  busy = ref(false)
async function erase() {
  if (!t.value || busy.value) return
  busy.value = true
  try {
    await remove(t.value)
    await navigateTo('/transactions')
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">기록 살펴보기</span>
      <h1>거래 상세·수정</h1>
    </div>
    <button v-if="t && isOwner" class="danger secondary" @click="confirmDelete = true">
      거래 삭제
    </button>
  </div>
  <div v-if="confirmDelete" class="alert error" role="alert">
    <p>이 거래와 분개를 삭제할까요? 자산 잔액과 보고서에도 반영됩니다.</p>
    <button class="danger secondary" :disabled="busy" @click="erase">삭제 확인</button>
    <button class="secondary" @click="confirmDelete = false">취소</button>
  </div>
  <p v-if="error" class="alert error">{{ error }}</p>
  <TransactionForm
    v-if="t && (!t.is_opening || isOwner)"
    :key="t.id + t.updated_at"
    :existing="t"
  />
  <div v-else-if="t" class="panel">
    <p>초기 자산 기록은 소유자만 수정할 수 있어요.</p>
    <TransactionTable :items="[t]" />
  </div>
  <p v-else class="empty panel">거래를 불러오는 중이거나, 접근할 수 없는 거래입니다.</p>
</template>
