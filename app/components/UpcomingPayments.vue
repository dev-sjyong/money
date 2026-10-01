<script setup lang="ts">
import type { RepaymentPlan } from '~/types/repayment'
import type { FixedSnapshot } from '~/types/fixed'
import type { RepaymentLink } from '~/utils/upcoming'
import { upcomingRepayments, linkNeedsReview } from '~/utils/upcoming'
import { fixedRows, koreaToday } from '~/utils/fixed'
const { householdId } = useHousehold(),
  { data, rpc } = useLedger(),
  { user } = useAuth()
const now = ref(koreaToday()),
  plans = ref<RepaymentPlan[]>([]),
  links = ref<RepaymentLink[]>([]),
  fixed = ref<FixedSnapshot>({ templates: [], records: [], linked_transactions: [] }),
  loading = ref(false),
  error = ref('')
let generation = 0
const month = computed(() => now.value.slice(0, 7))
const repayments = computed(() => upcomingRepayments(plans.value, month.value))
const expenses = computed(() =>
  fixedRows(fixed.value, month.value, data.value.transactions, now.value).filter((r) =>
    ['pending', 'overdue', 'review'].includes(r.status),
  ),
)
const total = computed(
  () =>
    repayments.value.reduce((s, r) => s + r.remaining, 0n) +
    expenses.value.reduce((s, r) => s + BigInt(r.expected.amount), 0n),
)
const reviews = computed(
  () =>
    links.value.filter((l) => linkNeedsReview(l, data.value.transactions)).length +
    expenses.value.filter((r) => r.status === 'review').length,
)
async function load() {
  const run = ++generation,
    h = householdId.value,
    u = user.value?.id
  plans.value = []
  links.value = []
  fixed.value = { templates: [], records: [], linked_transactions: [] }
  error.value = ''
  now.value = koreaToday()
  if (!h || !u) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const results = await Promise.all([
      rpc<RepaymentPlan[]>('get_repayment_plans', { p_household: h }),
      rpc<RepaymentLink[]>('get_repayment_links', { p_household: h }),
      rpc<FixedSnapshot>('fixed_expense_snapshot', {
        p_household: h,
        p_month: month.value + '-01',
      }),
    ])
    if (run !== generation || h !== householdId.value || u !== user.value?.id) return
    ;[plans.value, links.value, fixed.value] = results
  } catch (e) {
    if (run === generation) error.value = message(e)
  } finally {
    if (run === generation) loading.value = false
  }
}
watch([householdId, () => user.value?.id, () => data.value.transactions], load, { immediate: true })
</script>
<template>
  <section class="panel upcoming-panel" aria-label="이번 달 남은 납부">
    <div class="section-title">
      <div>
        <span class="eyebrow">{{ month }} · 앞으로 나갈 돈</span>
        <h2>이번 달 남은 납부</h2>
      </div>
      <button class="text-button" :disabled="loading" @click="load">다시 확인 ↻</button>
    </div>
    <p v-if="loading" role="status">납부 예정액을 확인하고 있어요…</p>
    <p v-else-if="error" class="alert error" role="alert">
      {{ error }}<br />예정액을 불러오지 못했어요. 연결 설정과 일정을 확인하세요.
    </p>
    <template v-else>
      <MoneyValue :value="total" />
      <p class="fineprint">
        미처리 고정지출 + 이번 달 회차의 남은 변제금이에요. 지난달 미납액과 생활비는 포함하지
        않으며, 사용 가능한 잔액을 뜻하지 않아요.
      </p>
      <p v-if="reviews" class="alert" role="status">
        연결 거래 {{ reviews }}건 확인 필요 · 거래 변경·삭제 여부를 확인하세요. 변제금 잔액은 저장된
        납부 기록 기준입니다.
      </p>
      <div class="upcoming-grid">
        <div>
          <h3>고정지출</h3>
          <p v-if="!expenses.length" class="muted">이번 달 남은 고정지출이 없어요.</p>
          <ul>
            <li v-for="r in expenses" :key="r.template.id">
              <NuxtLink to="/fixed-expenses"
                >{{ r.expected.title }}
                <small
                  >{{ r.expected.due_date }} ·
                  {{
                    r.status === 'review'
                      ? '확인 필요'
                      : r.status === 'overdue'
                        ? '기한 지남'
                        : '납부 예정'
                  }}</small
                ></NuxtLink
              ><MoneyValue :value="r.expected.amount" />
            </li>
          </ul>
          <NuxtLink class="text-button" to="/fixed-expenses">고정지출 관리 →</NuxtLink>
        </div>
        <div>
          <h3>개인회생 · 각자의 일정</h3>
          <p v-if="!repayments.length" class="muted">이번 달 남은 변제금이 없어요.</p>
          <ul>
            <li v-for="r in repayments" :key="r.row.id">
              <NuxtLink to="/repayment"
                >{{ r.plan.name }}
                <small
                  >{{ r.row.due_date }} ·
                  {{ r.row.due_date < now ? '기한 지남' : '납부 예정' }}</small
                ></NuxtLink
              ><MoneyValue :value="r.remaining" />
            </li>
          </ul>
          <NuxtLink class="text-button" to="/repayment">납부 기록 · 거래 연결 →</NuxtLink>
        </div>
      </div>
    </template>
  </section>
</template>
