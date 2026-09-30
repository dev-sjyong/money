<script setup lang="ts">
import { today, pastMonths, totals } from '~/utils/accounting'
const month = ref(today().slice(0, 7))
const { data } = useLedger()
const { expenses } = useDashboard(month)
const rows = computed(() =>
  pastMonths(month.value, 12)
    .map((m) => ({ month: m, ...totals(data.value.accounts, data.value.transactions, m) }))
    .reverse(),
)
watch(month, (value) => {
  if (!/^\d{4}-\d{2}$/.test(value)) month.value = today().slice(0, 7)
})
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">숫자로 읽는 우리의 생활</span>
      <h1>월별 수입·지출</h1>
      <p class="muted">이체와 부채 상환을 제외한 실제 수입과 지출입니다.</p>
    </div>
    <input v-model="month" type="month" required aria-label="보고서 기준 월" />
  </div>
  <NuxtLink to="/reports" class="secondary">기간 비교·지출 상세 분석 →</NuxtLink>
  <div class="report-grid">
    <section class="panel">
      <h2>최근 12개월</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>월</th>
              <th class="right">수입</th>
              <th class="right">지출</th>
              <th class="right">수지</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.month">
              <td>{{ r.month }}</td>
              <td class="right positive"><MoneyValue :value="r.income" /></td>
              <td class="right"><MoneyValue :value="r.expense" /></td>
              <td class="right"><MoneyValue :value="r.surplus" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="panel">
      <h2>{{ month }} 지출 분석</h2>
      <p class="fineprint">상위 항목별로 하위 지출을 포함합니다.</p>
      <ReportChart :items="expenses" title="상위 계정별 월 지출" />
    </section>
  </div>
</template>
