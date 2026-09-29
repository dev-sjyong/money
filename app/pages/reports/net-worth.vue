<script setup lang="ts">
import { today, pastMonths, totals, monthEnd } from '~/utils/accounting'
const month = ref(today().slice(0, 7))
const { data } = useLedger()
const rows = computed(() =>
  pastMonths(month.value, 12).map((m) => ({
    month: m,
    ...totals(data.value.accounts, data.value.transactions, m, monthEnd(m)),
  })),
)
const chart = computed(() => rows.value.map((r) => ({ label: r.month, value: r.netWorth })))
watch(month, (value) => {
  if (!/^\d{4}-\d{2}$/.test(value)) month.value = today().slice(0, 7)
})
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">조금씩, 앞으로</span>
      <h1>순자산 추이</h1>
      <p class="muted">매월 말까지 기록된 자산에서 부채를 뺀 값입니다.</p>
    </div>
    <input v-model="month" type="month" required aria-label="순자산 기준 월" />
  </div>
  <section class="panel">
    <h2>우리의 12개월</h2>
    <ReportChart :items="chart" title="12개월 월말 순자산" />
  </section>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>기준 월</th>
            <th class="right">자산</th>
            <th class="right">부채</th>
            <th class="right">순자산</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in [...rows].reverse()" :key="r.month">
            <td>{{ r.month }}</td>
            <td class="right"><MoneyValue :value="r.assets" /></td>
            <td class="right"><MoneyValue :value="r.liabilities" /></td>
            <td class="right"><MoneyValue :value="r.netWorth" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
