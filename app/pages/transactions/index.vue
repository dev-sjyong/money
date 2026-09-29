<script setup lang="ts">
import { today } from '~/utils/accounting'
const { transactions } = useTransactions()
const { isOwner } = useLedger()
const { label } = useAccounts()
const search = ref(''),
  month = ref(today().slice(0, 7)),
  page = ref(1)
const filtered = computed(() =>
  transactions.value.filter(
    (t) =>
      (!month.value || t.transaction_date.startsWith(month.value)) &&
      `${t.description} ${t.memo || ''} ${t.lines.map((l) => label(l.account_id)).join(' ')}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
)
watch([search, month], () => (page.value = 1))
const count = computed(() => Math.max(1, Math.ceil(filtered.value.length / 25)))
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
    <TransactionTable :items="filtered.slice((page - 1) * 25, page * 25)" />
    <div class="pagination">
      <button class="secondary" :disabled="page <= 1" @click="page--">이전</button
      ><span>{{ page }} / {{ count }}</span
      ><button class="secondary" :disabled="page >= count" @click="page++">다음</button>
    </div>
  </section>
</template>
