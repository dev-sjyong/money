<script setup lang="ts">
import type { FixedSnapshot } from '~/types/fixed'
import type { RepaymentPlan } from '~/types/repayment'
import type { RepaymentLink } from '~/utils/upcoming'
import { upcomingRepayments, linkNeedsReview } from '~/utils/upcoming'
import { fixedRows, koreaToday, fixedMonth } from '~/utils/fixed'
import { monthEnd, balanceMap } from '~/utils/accounting'
import { periodFlow } from '~/utils/analytics'
import { duplicateGroups, monthReviewSignature } from '~/utils/workflow'
const { data, rpc, refresh } = useLedger(),
  { householdId } = useHousehold(),
  { user } = useAuth(),
  { label } = useAccounts()
const { preferences, update, error: storageError } = useWorkflowPreferences()
const month = ref(koreaToday().slice(0, 7)),
  fixed = ref<FixedSnapshot>({ templates: [], records: [], linked_transactions: [] }),
  plans = ref<RepaymentPlan[]>([]),
  links = ref<RepaymentLink[]>([]),
  loading = ref(false),
  error = ref(''),
  checks = ref(false),
  actual = ref<Record<string, string>>({})
let generation = 0
const end = computed(() => (fixedMonth(month.value) ? monthEnd(month.value) : ''))
const flow = computed(() =>
  periodFlow(data.value.accounts, data.value.transactions, {
    start: month.value + '-01',
    end: end.value,
  }),
)
const balance = computed(() => balanceMap(data.value.accounts, data.value.transactions, end.value))
const cashAccounts = computed(() =>
  data.value.accounts.filter(
    (a) => a.type === 'ASSET' && (!a.is_archived || (balance.value.get(a.id) ?? 0n) !== 0n),
  ),
)
const monthly = computed(() =>
  data.value.transactions.filter((t) => t.transaction_date.startsWith(month.value)),
)
const duplicates = computed(() => duplicateGroups(monthly.value))
const pending = computed(() =>
  fixedRows(fixed.value, month.value, data.value.transactions, koreaToday()).filter((r) =>
    ['pending', 'overdue', 'review'].includes(r.status),
  ),
)
const repayments = computed(() => upcomingRepayments(plans.value, month.value))
const reviews = computed(() =>
  links.value.filter((l) => {
    const plan = plans.value.find((p) => p.id === l.plan_id)
    return (
      plan &&
      !plan.archived &&
      plan.rows.some((r) => r.id === l.row_id && r.due_date.startsWith(month.value)) &&
      linkNeedsReview(l, data.value.transactions)
    )
  }),
)
const signature = computed(() =>
  monthReviewSignature(data.value.accounts, data.value.transactions, end.value, [
    fixed.value,
    plans.value,
    links.value,
  ]),
)
const saved = computed(() => preferences.value.reviews[month.value])
const unchanged = computed(() => saved.value?.signature === signature.value)
const validBalances = computed(() =>
  cashAccounts.value.every((a) => /^-?\d+$/.test(actual.value[a.id] ?? '')),
)
const differences = computed(() =>
  cashAccounts.value.filter(
    (a) =>
      /^-?\d+$/.test(actual.value[a.id] ?? '') &&
      BigInt(actual.value[a.id]!) !== (balance.value.get(a.id) ?? 0n),
  ),
)
const canComplete = computed(
  () =>
    !loading.value &&
    !error.value &&
    fixedMonth(month.value) &&
    end.value < koreaToday() &&
    checks.value &&
    validBalances.value &&
    !differences.value.length &&
    !pending.value.length &&
    !repayments.value.length &&
    !reviews.value.length,
)
async function load() {
  const run = ++generation,
    h = householdId.value,
    u = user.value?.id,
    m = month.value
  checks.value = false
  error.value = ''
  fixed.value = { templates: [], records: [], linked_transactions: [] }
  plans.value = []
  links.value = []
  actual.value = { ...preferences.value.reviews[m]?.balances }
  if (!h || !u || !fixedMonth(m)) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const [f, p, l] = await Promise.all([
      rpc<FixedSnapshot>('fixed_expense_snapshot', { p_household: h, p_month: m + '-01' }),
      rpc<RepaymentPlan[]>('get_repayment_plans', { p_household: h }),
      rpc<RepaymentLink[]>('get_repayment_links', { p_household: h }),
      refresh(),
    ])
    if (run !== generation || h !== householdId.value || m !== month.value || u !== user.value?.id)
      return
    fixed.value = f
    plans.value = p
    links.value = l
  } catch (e) {
    if (run === generation) error.value = message(e)
  } finally {
    if (run === generation) loading.value = false
  }
}
watch([householdId, () => user.value?.id, month], load, { immediate: true })
function complete() {
  if (canComplete.value)
    update((p) => {
      p.reviews[month.value] = { signature: signature.value, balances: { ...actual.value } }
    })
}
function clearReview() {
  update((p) => {
    delete p.reviews[month.value]
  })
  checks.value = false
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">한 달의 기록을 확인해요</span>
      <h1>월 마감 점검</h1>
      <p class="muted">납부와 중복 후보를 살펴보고 월말 실제 잔액을 장부와 비교하세요.</p>
    </div>
    <label>점검 월<input v-model="month" type="month" aria-label="월 마감 조회 월" /></label>
  </div>
  <p class="fineprint">
    점검 표시는 현재 브라우저에 저장하며 거래를 잠그지 않습니다. 실제 잔액은 계정별 월말 잔액을
    입력하세요. 투자 평가액이 아닌 장부 기준 금액을 비교해요.
  </p>
  <p v-if="loading" role="status">월 마감 자료를 불러오고 있어요…</p>
  <p v-if="error || storageError" class="alert error" role="alert">{{ error || storageError }}</p>
  <template v-if="fixedMonth(month) && !loading && !error">
    <div class="stat-grid">
      <div class="panel"><span>월 수입</span><MoneyValue :value="flow.income" /></div>
      <div class="panel"><span>월 지출 · 환급 반영</span><MoneyValue :value="flow.expense" /></div>
      <div class="panel">
        <span>남은 돈</span><MoneyValue :value="flow.income - flow.expense" />
      </div>
    </div>
    <p v-if="saved" class="alert" role="status">
      {{
        unchanged
          ? '이 달의 점검을 완료했어요.'
          : '점검 후 장부 또는 일정이 바뀌었어요. 다시 확인하세요.'
      }}
      <button class="text-button" @click="clearReview">점검 표시 해제</button>
    </p>
    <section class="panel">
      <h2>1. 미처리 납부 확인</h2>
      <p>
        고정지출 {{ pending.length }}건 · 남은 변제 회차 {{ repayments.length }}건 · 연결 거래 확인
        {{ reviews.length }}건
      </p>
      <ul>
        <li v-for="r in pending" :key="r.template.id">
          <NuxtLink to="/fixed-expenses"
            >{{ r.expected.title }} · {{ r.expected.due_date }} · 고정지출 처리 ↗</NuxtLink
          >
        </li>
        <li v-for="r in repayments" :key="r.row.id">
          <NuxtLink to="/repayment"
            >{{ r.plan.name }} · {{ r.row.due_date }} · <MoneyValue :value="r.remaining" /> · 납부
            확인 ↗</NuxtLink
          >
        </li>
      </ul>
      <NuxtLink v-if="reviews.length" to="/repayment" class="secondary">연결 거래 확인</NuxtLink>
      <p v-if="!pending.length && !repayments.length && !reviews.length" class="muted">
        미처리 납부가 없어요.
      </p>
    </section>
    <section class="panel">
      <h2>2. 중복 후보 확인</h2>
      <p class="fineprint">
        같은 날짜·계정·금액도 실제로 여러 번 발생할 수 있어요. 자동 삭제하지 않습니다.
      </p>
      <p v-if="!duplicates.length" class="muted">중복 후보가 없어요.</p>
      <div v-for="group in duplicates" :key="group[0]!.id" class="alert">
        <NuxtLink v-for="t in group" :key="t.id" class="block" :to="'/transactions/' + t.id"
          >{{ t.transaction_date }} · {{ t.description }} · 거래 확인 ↗</NuxtLink
        >
      </div>
    </section>
    <section class="panel">
      <h2>3. 실제 월말 잔액 대조</h2>
      <p class="fineprint">
        각 계정에 직접 기록된 잔액입니다. 하위 계정에 기록한 금액을 부모 계정에 다시 입력하지
        마세요. 자산 계정이 없으면 이 단계는 생략됩니다.
      </p>
      <div v-for="a in cashAccounts" :key="a.id" class="reconciliation-row">
        <div>
          <strong>{{ label(a.id) }}</strong>
          <p>장부 <MoneyValue :value="balance.get(a.id) ?? 0n" /></p>
        </div>
        <label
          >실제 잔액 (원)<input
            v-model="actual[a.id]"
            :aria-label="a.name + ' 실제 잔액'"
            inputmode="numeric"
            placeholder="음수 가능 · 쉼표 없이 입력"
        /></label>
        <p v-if="/^-?\d+$/.test(actual[a.id] ?? '')">
          차이 <MoneyValue :value="BigInt(actual[a.id]!) - (balance.get(a.id) ?? 0n)" />
        </p>
      </div>
      <p v-if="differences.length" class="alert" role="status">
        잔액 차이가 {{ differences.length }}개 있어요. 누락 거래나 초기 잔액을 확인하세요. 이
        입력으로 장부를 자동 조정하지 않습니다.
      </p>
    </section>
    <section class="panel">
      <h2>4. 월 점검 완료</h2>
      <label class="repayment-check"
        ><input v-model="checks" type="checkbox" />중복 후보와 누락 여부를 확인했어요</label
      >
      <p v-if="end >= koreaToday()" class="fineprint">
        진행 중이거나 미래인 달은 미리 점검할 수 있으며, 월이 끝난 뒤 완료 표시가 가능합니다.
      </p>
      <p class="fineprint">모든 납부를 처리하고 실제 잔액의 차이가 없으면 완료할 수 있어요.</p>
      <button class="button" :disabled="!canComplete" @click="complete">월 점검 완료 표시</button
      ><NuxtLink class="text-button" to="/transactions">거래 내역 확인 →</NuxtLink>
    </section>
  </template>
  <p v-else-if="!fixedMonth(month)" class="alert">조회 월을 선택하세요.</p>
</template>
