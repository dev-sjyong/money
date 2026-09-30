<script setup lang="ts">
import { today, pastMonths, monthEnd, won } from '~/utils/accounting'
import { positionAt, validDate, reportCsv } from '~/utils/analytics'
import { downloadCsv } from '~/utils/download'
const month = ref(today().slice(0, 7)),
  count = ref(12),
  metric = ref<'netWorth' | 'assets' | 'liabilities'>('netWorth')
const { data, loading, error } = useLedger()
const names = { netWorth: '순자산', assets: '자산', liabilities: '부채' }
const valid = computed(() => validDate(month.value + '-01'))
const rows = computed(() =>
  valid.value
    ? pastMonths(month.value, Number(count.value)).map((m) => {
        const current = positionAt(data.value.accounts, data.value.transactions, monthEnd(m))
        const prev = positionAt(
          data.value.accounts,
          data.value.transactions,
          monthEnd(pastMonths(m, 2)[0]!),
        )
        return { month: m, ...current, change: current.netWorth - prev.netWorth }
      })
    : [],
)
const last = computed(() => rows.value.at(-1))
const chart = computed(() => rows.value.map((r) => ({ label: r.month, value: r[metric.value] })))
function csv() {
  downloadCsv(
    `두런-순자산-${month.value}.csv`,
    reportCsv([
      ['월', '자산', '부채', '순자산', '전월 대비 순자산 증감'],
      ...rows.value.map((r) => [r.month, r.assets, r.liabilities, r.netWorth, r.change]),
    ]),
  )
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">조금씩, 앞으로</span>
      <h1>순자산 추이</h1>
      <p class="muted">매월 말까지 기록된 자산과 부채의 변화를 확인해요.</p>
    </div>
    <button class="secondary" :disabled="!valid || loading || !!error" @click="csv">
      추이 CSV 내보내기
    </button>
  </div>
  <NuxtLink to="/reports">← 통계 한눈에</NuxtLink>
  <div class="panel analytics-filters">
    <label>순자산 기준 월<input v-model="month" type="month" min="1902-01" max="2198-12" /></label
    ><label
      >추이 기간<select v-model="count">
        <option :value="6">6개월</option>
        <option :value="12">12개월</option>
        <option :value="24">24개월</option>
      </select></label
    ><label
      >차트 지표<select v-model="metric">
        <option value="netWorth">순자산</option>
        <option value="assets">자산</option>
        <option value="liabilities">부채</option>
      </select></label
    >
  </div>
  <p v-if="!valid" class="alert error" role="alert">올바른 기준 월을 선택하세요.</p>
  <template v-else>
    <div v-if="last" class="analytics-kpis">
      <article class="panel">
        <span class="muted">{{ month }} 말 자산</span><MoneyValue :value="last.assets" />
      </article>
      <article class="panel">
        <span class="muted">{{ month }} 말 부채</span><MoneyValue :value="last.liabilities" />
      </article>
      <article class="panel">
        <span class="muted">{{ month }} 말 순자산</span><MoneyValue :value="last.netWorth" />
      </article>
      <article class="panel">
        <span class="muted">전월 대비 순자산 증감</span><MoneyValue :value="last.change" />
      </article>
    </div>
    <section class="panel">
      <h2>{{ count }}개월 {{ names[metric] }}</h2>
      <ReportChart :items="chart" :title="`${count}개월 월말 ${names[metric]}`" />
      <p class="fineprint">
        기록이 없는 달은 직전 잔액을 이어갑니다. 미래 날짜의 거래도 해당 월말에 포함되며, 예상
        수익이나 시세를 추정하지 않습니다.
      </p>
    </section>
    <section class="panel">
      <div class="table-wrap" tabindex="0">
        <table class="analytics-table">
          <thead>
            <tr>
              <th>기준 월</th>
              <th class="right">자산</th>
              <th class="right">부채</th>
              <th class="right">순자산</th>
              <th class="right">전월 대비</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in [...rows].reverse()" :key="r.month">
              <td>{{ r.month }}</td>
              <td class="right"><MoneyValue :value="r.assets" /></td>
              <td class="right"><MoneyValue :value="r.liabilities" /></td>
              <td class="right"><MoneyValue :value="r.netWorth" /></td>
              <td class="right">{{ r.change > 0n ? '+' : '' }}{{ won(r.change) }}원</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>
