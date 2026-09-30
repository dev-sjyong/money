<script setup lang="ts">
import { accountLabels } from '~/types/ledger'
import { accountPath, today, won } from '~/utils/accounting'
import { positionAt, validDate, shiftDate, reportCsv, ratioPercent } from '~/utils/analytics'
import { downloadCsv } from '~/utils/download'
const { data, loading, error } = useLedger()
const date = ref(today()),
  hideZero = ref(false)
const valid = computed(() => validDate(date.value))
const comparison = computed(() =>
  valid.value ? shiftDate(date.value.slice(0, 7) + '-01', -1) : '',
)
const current = computed(() =>
    positionAt(data.value.accounts, data.value.transactions, date.value),
  ),
  previous = computed(() =>
    positionAt(data.value.accounts, data.value.transactions, comparison.value),
  )
const groups = ['ASSET', 'LIABILITY'] as const
const rows = computed(() =>
  data.value.accounts
    .filter((a) => groups.includes(a.type as (typeof groups)[number]))
    .map((a) => ({
      a,
      label: accountPath(data.value.accounts, a.id),
      balance: current.value.balances.get(a.id) || 0n,
      previous: previous.value.balances.get(a.id) || 0n,
    }))
    .filter((r) => !hideZero.value || r.balance !== 0n || r.previous !== 0n)
    .sort((a, b) =>
      a.balance === b.balance ? a.label.localeCompare(b.label) : a.balance > b.balance ? -1 : 1,
    ),
)
function signed(n: bigint) {
  return (n > 0n ? '+' : '') + won(n) + '원'
}
function csv() {
  downloadCsv(
    `두런-자산부채-${date.value}.csv`,
    reportCsv([
      ['기준일', date.value, '비교일', comparison.value],
      ['유형', '계정', '잔액', '전월 말 잔액', '증감'],
      ...rows.value.map((r) => [
        accountLabels[r.a.type],
        r.label,
        r.balance,
        r.previous,
        r.balance - r.previous,
      ]),
    ]),
  )
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">지금 우리의 자리</span>
      <h1>자산·부채 보고서</h1>
      <p class="muted">기준일까지 기록된 원장 잔액과 전월 말 대비 변화입니다.</p>
    </div>
    <button class="secondary" :disabled="!valid || loading || !!error" @click="csv">
      자산 CSV 내보내기
    </button>
  </div>
  <NuxtLink to="/reports">← 통계 한눈에</NuxtLink>
  <div class="panel analytics-filters">
    <label>자산 기준일<input v-model="date" type="date" min="1901-01-01" max="2198-12-31" /></label
    ><label class="repayment-check"
      ><input v-model="hideZero" type="checkbox" />현재·비교 잔액이 모두 0인 계정 숨기기</label
    >
  </div>
  <p v-if="!valid" class="alert error" role="alert">올바른 기준일을 선택하세요.</p>
  <template v-else>
    <div class="analytics-kpis">
      <article class="panel">
        <span class="muted">자산</span><MoneyValue :value="current.assets" /><small
          >전월 말 대비 {{ signed(current.assets - previous.assets) }}</small
        >
      </article>
      <article class="panel">
        <span class="muted">부채</span><MoneyValue :value="current.liabilities" /><small
          >전월 말 대비 {{ signed(current.liabilities - previous.liabilities) }}</small
        >
      </article>
      <article class="panel">
        <span class="muted">순자산</span><MoneyValue :value="current.netWorth" /><small
          >전월 말 대비 {{ signed(current.netWorth - previous.netWorth) }}</small
        >
      </article>
      <article class="panel">
        <span class="muted">자산 대비 부채</span
        ><strong>{{
          current.liabilities < 0n
            ? '계산 불가'
            : ratioPercent(current.liabilities, current.assets) || '계산 불가'
        }}</strong
        ><small>부채 ÷ 자산 · 자산이 0 이하이거나 부채가 음수이면 미표시</small>
      </article>
    </div>
    <p class="fineprint">
      기준 {{ date }} · 비교 {{ comparison }}. 보관 계정 포함, 각 계정의 직접 분개 잔액입니다. 상위
      계정에 하위 잔액을 중복 합산하지 않습니다. 주식 시세와 별도 일정의 예정액은 포함하지 않습니다.
    </p>
    <section v-for="type in groups" :key="type" class="panel">
      <h2>{{ accountLabels[type] }} 계정별 변화</h2>
      <div class="table-wrap" tabindex="0">
        <table class="analytics-table">
          <thead>
            <tr>
              <th>계정</th>
              <th class="right">기준일 잔액</th>
              <th class="right">전월 말 잔액</th>
              <th class="right">증감</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows.filter((r) => r.a.type === type)" :key="r.a.id">
              <td>{{ r.label }} <small v-if="r.a.is_archived" class="muted">보관됨</small></td>
              <td class="right"><MoneyValue :value="r.balance" /></td>
              <td class="right"><MoneyValue :value="r.previous" /></td>
              <td class="right">{{ signed(r.balance - r.previous) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!rows.some((r) => r.a.type === type)" class="empty-text">표시할 계정이 없어요.</p>
    </section>
  </template>
</template>
