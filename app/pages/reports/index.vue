<script setup lang="ts">
import { today, won } from '~/utils/accounting'
import {
  monthlyRange,
  validRange,
  previousRange,
  periodFlow,
  positionAt,
  shiftDate,
  rangeDays,
  categoryReport,
  monthlySeries,
  changePercent,
  ratioPercent,
  transactionFlow,
  reportCsv,
} from '~/utils/analytics'
import { downloadCsv } from '~/utils/download'
const { data, loading, error } = useLedger(),
  { householdId } = useHousehold()
const month = ref(today().slice(0, 7)),
  period = ref('1'),
  start = ref(today().slice(0, 7) + '-01'),
  end = ref(today()),
  grouping = ref<'root' | 'account'>('root'),
  selected = ref(''),
  page = ref(1)
const range = computed(() => {
  try {
    return period.value === 'custom'
      ? { start: start.value, end: end.value }
      : monthlyRange(month.value, Number(period.value))
  } catch {
    return { start: '', end: '' }
  }
})
const valid = computed(() => validRange(range.value))
const previous = computed(() =>
  valid.value
    ? previousRange(range.value, period.value === 'custom' ? undefined : Number(period.value))
    : { start: '', end: '' },
)
const current = computed(() =>
    periodFlow(data.value.accounts, data.value.transactions, range.value),
  ),
  before = computed(() => periodFlow(data.value.accounts, data.value.transactions, previous.value))
const position = computed(() =>
  positionAt(data.value.accounts, data.value.transactions, range.value.end),
)
const initial = computed(() =>
  positionAt(
    data.value.accounts,
    data.value.transactions,
    valid.value ? shiftDate(range.value.start, -1) : '',
  ),
)
const categories = computed(() =>
  categoryReport(
    data.value.accounts,
    data.value.transactions,
    range.value,
    previous.value,
    grouping.value,
  ),
)
const chosen = computed(() => categories.value.find((c) => c.id === selected.value))
const positiveTotal = computed(() =>
  categories.value.reduce((s, c) => s + (c.current > 0n ? c.current : 0n), 0n),
)
const series = computed(() =>
  valid.value ? monthlySeries(data.value.accounts, data.value.transactions, range.value) : [],
)
const details = computed(() =>
  data.value.transactions
    .filter(
      (t) =>
        t.transaction_date >= range.value.start &&
        t.transaction_date <= range.value.end &&
        t.lines.some(
          (l) =>
            (!chosen.value || chosen.value.ids.has(l.account_id)) &&
            ['INCOME', 'EXPENSE'].includes(
              data.value.accounts.find((a) => a.id === l.account_id)?.type || '',
            ),
        ),
    )
    .map((t) => ({ t, ...transactionFlow(data.value.accounts, t, chosen.value?.ids) }))
    .sort(
      (a, b) =>
        b.t.transaction_date.localeCompare(a.t.transaction_date) || a.t.id.localeCompare(b.t.id),
    ),
)
const pages = computed(() => Math.max(1, Math.ceil(details.value.length / 20)))
watch([range, grouping, householdId], () => {
  selected.value = ''
  page.value = 1
})
watch(selected, () => (page.value = 1))
watch(pages, (n) => {
  page.value = Math.min(page.value, n)
})
watch(categories, (rows) => {
  if (selected.value && !rows.some((r) => r.id === selected.value)) selected.value = ''
})
function signed(value: bigint) {
  return (value > 0n ? '+' : '') + won(value) + '원'
}
function csv() {
  const rows: (string | bigint | number)[][] = [
    ['두런 통계', range.value.start, range.value.end],
    ['비교 기간', previous.value.start, previous.value.end],
    ['지표', '선택 기간', '비교 기간'],
    ['수입', current.value.income, before.value.income],
    ['지출', current.value.expense, before.value.expense],
    ['수지', current.value.surplus, before.value.surplus],
    ['기말 자산', position.value.assets],
    ['기말 부채', position.value.liabilities],
    ['기말 순자산', position.value.netWorth],
    [],
    ['지출 항목', '선택 기간', '비교 기간', '증감'],
    ...categories.value.map((c) => [c.label, c.current, c.previous, c.current - c.previous]),
    [],
    ['거래 상세 범위', chosen.value?.label || '전체 수입·지출'],
    ['날짜', '설명', '메모', '해당 수입', '해당 지출'],
    ...details.value.map((r) => [
      r.t.transaction_date,
      r.t.description,
      r.t.memo || '',
      r.income,
      r.expense,
    ]),
  ]
  downloadCsv(`두런-통계-${range.value.start}-${range.value.end}.csv`, reportCsv(rows))
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">흐름을 읽고, 다음 달을 준비해요</span>
      <h1>통계 한눈에</h1>
      <p class="muted">수입·지출과 자산 변화를 같은 기간으로 살펴보세요.</p>
    </div>
    <button class="secondary" :disabled="!valid || loading || !!error" @click="csv">
      CSV 내보내기
    </button>
  </div>
  <nav class="analytics-links" aria-label="상세 보고서">
    <NuxtLink to="/reports/income-expense">월별 수입·지출 →</NuxtLink
    ><NuxtLink to="/reports/assets">자산·부채 상세 →</NuxtLink
    ><NuxtLink to="/reports/net-worth">순자산 추이 →</NuxtLink>
  </nav>
  <section class="panel analytics-filters" aria-label="통계 조회 기간">
    <label
      >조회 기간<select v-model="period">
        <option value="1">한 달</option>
        <option value="3">최근 3개월</option>
        <option value="6">최근 6개월</option>
        <option value="12">최근 12개월</option>
        <option value="custom">직접 선택</option>
      </select></label
    >
    <label v-if="period !== 'custom'"
      >통계 기준 월<input v-model="month" type="month" min="1902-01" max="2198-12"
    /></label>
    <template v-else
      ><label>시작일<input v-model="start" type="date" min="1902-01-01" max="2198-12-31" /></label
      ><label>종료일<input v-model="end" type="date" min="1902-01-01" max="2198-12-31" /></label
    ></template>
  </section>
  <p v-if="!valid" class="alert error" role="alert">
    시작일과 종료일을 확인하세요. 1902년 이후 최대 732일까지 조회할 수 있어요.
  </p>
  <template v-else>
    <p class="fineprint">
      {{ range.start }} ~ {{ range.end }} · 비교 {{ previous.start }} ~ {{ previous.end }}<br />월
      단위는 직전 동일 개월 수, 직접 선택은 직전 동일 일수와 비교합니다. 해당 기간에 기록된 거래
      전체를 포함합니다.
    </p>
    <div class="analytics-kpis" aria-label="통계 요약">
      <article class="panel">
        <span class="muted">수입</span><MoneyValue :value="current.income" /><small
          >이전 대비 {{ signed(current.income - before.income) }}
          <span v-if="changePercent(current.income, before.income)"
            >({{ changePercent(current.income, before.income) }})</span
          ></small
        >
      </article>
      <article class="panel">
        <span class="muted">지출 · 환불 차감</span><MoneyValue :value="current.expense" /><small
          >이전 대비 {{ signed(current.expense - before.expense) }}
          <span v-if="changePercent(current.expense, before.expense)"
            >({{ changePercent(current.expense, before.expense) }})</span
          ></small
        >
      </article>
      <article class="panel">
        <span class="muted">수지 · 수입 − 지출</span><MoneyValue :value="current.surplus" /><small
          >수지율
          {{ ratioPercent(current.surplus, current.income) || '계산 불가 (수입 0 이하)' }}</small
        >
      </article>
      <article class="panel">
        <span class="muted">기간 말 순자산</span><MoneyValue :value="position.netWorth" /><small
          >기간 시작 전 대비 {{ signed(position.netWorth - initial.netWorth) }}</small
        >
      </article>
    </div>
    <div class="analytics-context panel">
      <span>기간 말 자산 <MoneyValue :value="position.assets" /></span
      ><span>기간 말 부채 <MoneyValue :value="position.liabilities" /></span
      ><span>기간 내 수입·지출 거래 {{ current.count }}건</span
      ><span>하루 평균 지출 {{ won(current.expense / BigInt(rangeDays(range))) }}원</span>
    </div>
    <p class="fineprint">
      이체·카드대금·대출 원금 상환은 수입·지출에서 제외합니다. 하루 평균은 선택한 전체 달력 일수
      기준입니다. 수입/이전값이 0 이하이면 해당 비율을 표시하지 않습니다.
    </p>
    <section class="panel">
      <h2>기간 내 월별 흐름</h2>
      <div class="analytics-trends">
        <div>
          <h3>수입</h3>
          <ReportChart
            :items="series.map((r) => ({ label: r.month, value: r.income }))"
            title="월별 수입"
          />
        </div>
        <div>
          <h3>지출</h3>
          <ReportChart
            :items="series.map((r) => ({ label: r.month, value: r.expense }))"
            title="월별 지출"
          />
        </div>
      </div>
      <p class="fineprint">
        각 차트의 막대 길이는 독립된 비율이며 금액으로 비교하세요. 직접 선택의 첫 달·마지막 달은
        선택한 날짜만 집계합니다.
      </p>
    </section>
    <section class="panel">
      <div class="section-title">
        <h2>어디에 썼을까요?</h2>
        <label
          >항목 구분<select v-model="grouping">
            <option value="root">상위 항목별</option>
            <option value="account">개별 계정별</option>
          </select></label
        >
      </div>
      <p class="fineprint">
        항목을 누르면 아래 거래를 확인할 수 있어요. 비중은 순지출이 양수인 항목의 합계 기준이며 환불
        초과 항목은 별도로 표시합니다. 보관 계정도 포함합니다.
      </p>
      <div class="table-wrap" tabindex="0">
        <table class="analytics-table">
          <thead>
            <tr>
              <th>지출 항목</th>
              <th class="right">선택 기간</th>
              <th class="right">이전 기간</th>
              <th class="right">증감</th>
              <th class="right">비중</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in categories"
              :key="c.id"
              :class="{ 'analytics-selected': selected === c.id }"
            >
              <td>
                <button
                  class="text-button"
                  :aria-pressed="selected === c.id"
                  @click="selected = selected === c.id ? '' : c.id"
                >
                  {{ c.label }}
                </button>
              </td>
              <td class="right"><MoneyValue :value="c.current" /></td>
              <td class="right"><MoneyValue :value="c.previous" /></td>
              <td class="right">{{ signed(c.current - c.previous) }}</td>
              <td class="right">
                {{ c.current < 0n ? '환불 초과' : ratioPercent(c.current, positiveTotal) || '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!categories.length" class="empty-text">선택·비교 기간에 지출 내역이 없어요.</p>
      <p class="fineprint">
        선택 기간 지출 차변 {{ won(current.grossExpense) }}원 − 환불 등 대변
        {{ won(current.refund) }}원 = 순지출 {{ won(current.expense) }}원
      </p>
    </section>
    <section class="panel" aria-label="통계 거래 상세">
      <div class="section-title">
        <h2>{{ chosen?.label || '전체 수입·지출' }} 거래 · {{ details.length }}건</h2>
        <button v-if="chosen" class="secondary" @click="selected = ''">항목 선택 해제</button>
      </div>
      <p class="fineprint">
        여러 항목으로 나눈 거래는 선택한 항목의 금액만 표시합니다. CSV에는 현재 필터의 전체 페이지가
        포함됩니다.
      </p>
      <div class="table-wrap" tabindex="0">
        <table class="analytics-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>설명</th>
              <th class="right">해당 수입</th>
              <th class="right">해당 지출</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in details.slice((page - 1) * 20, page * 20)" :key="r.t.id">
              <td>{{ r.t.transaction_date }}</td>
              <td>
                <NuxtLink :to="`/transactions/${r.t.id}`">{{ r.t.description }}</NuxtLink>
              </td>
              <td class="right"><MoneyValue :value="r.income" /></td>
              <td class="right"><MoneyValue :value="r.expense" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!details.length" class="empty-text">선택한 기간과 항목에 해당하는 거래가 없어요.</p>
      <div v-if="details.length" class="pagination">
        <button class="secondary" :disabled="page === 1" @click="page--">이전</button
        ><span>{{ page }} / {{ pages }}</span
        ><button class="secondary" :disabled="page === pages" @click="page++">다음</button>
      </div>
    </section>
  </template>
</template>
