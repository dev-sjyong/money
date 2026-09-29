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
    <div class="heading-actions">
      <NuxtLink v-if="t && !t.is_opening" :to="`/transactions/new?copy=${t.id}`" class="secondary"
        >이 거래 복사</NuxtLink
      >
      <button v-if="t && isOwner" class="danger secondary" @click="confirmDelete = true">
        거래 삭제
      </button>
    </div>
  </div>
  <div v-if="confirmDelete" class="alert error" role="alert">
    <p>
      이 거래를 휴지통으로 이동할까요? 잔액과 보고서에서 제외되며, 소유자가 휴지통에서 복구할 수
      있어요.
    </p>
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
  <div v-else class="empty panel">
    <p>거래를 불러오는 중이거나, 삭제 또는 접근할 수 없는 거래입니다.</p>
    <NuxtLink v-if="isOwner" class="secondary" to="/transactions/trash">휴지통 확인</NuxtLink>
  </div>
  <TransactionHistory v-if="t" :transaction-id="t.id" :version="t.updated_at" />
</template>
