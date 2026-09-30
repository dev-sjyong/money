<script setup lang="ts">
import type { FixedSnapshot, FixedTemplate, FixedRule } from '~/types/fixed'
import type { FixedRow } from '~/utils/fixed'
import {
  koreaToday,
  fixedMonth,
  fixedRows,
  fixedSummary,
  matchesFixed,
  ruleAt,
} from '~/utils/fixed'
import { won, amount as validateAmount } from '~/utils/accounting'
const { householdId } = useHousehold(),
  { user } = useAuth(),
  { rpc, refresh, data, error: ledgerError } = useLedger(),
  { label } = useAccounts()
const month = ref(koreaToday().slice(0, 7)),
  snapshot = ref<FixedSnapshot>({ templates: [], records: [], linked_transactions: [] }),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  showEditor = ref(false),
  editing = ref<FixedTemplate>(),
  filter = ref('all'),
  now = ref(koreaToday())
const action = ref<{ row: FixedRow; kind: 'pay' | 'link' | 'skip' | 'reset' } | null>(null),
  actualDate = ref(koreaToday()),
  actualAmount = ref(''),
  transactionId = ref('')
let generation = 0
const rows = computed(() =>
    fixedRows(snapshot.value, month.value, data.value.transactions, now.value),
  ),
  summary = computed(() => fixedSummary(rows.value))
const visible = computed(() =>
  rows.value.filter(
    (r) =>
      filter.value === 'all' ||
      (filter.value === 'todo'
        ? ['pending', 'overdue', 'review'].includes(r.status)
        : r.status === filter.value),
  ),
)
const labels: Record<string, string> = {
  pending: '납부 예정',
  overdue: '기한 지남',
  paid: '납부 완료',
  skipped: '이번 달 건너뜀',
  review: '거래 확인 필요',
}
const candidates = computed(() =>
  action.value
    ? data.value.transactions
        .filter(
          (t) =>
            t.transaction_date <= now.value &&
            matchesFixed(t, action.value!.row.expected) &&
            !snapshot.value.linked_transactions.includes(t.id),
        )
        .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    : [],
)
async function load() {
  const run = ++generation,
    h = householdId.value,
    u = user.value?.id,
    m = month.value
  loading.value = true
  error.value = ''
  now.value = koreaToday()
  try {
    if (!h || !u || !fixedMonth(m)) {
      snapshot.value = { templates: [], records: [], linked_transactions: [] }
      return
    }
    const [result] = await Promise.all([
      rpc<FixedSnapshot>('fixed_expense_snapshot', { p_household: h, p_month: m + '-01' }),
      refresh(),
    ])
    if (run === generation && h === householdId.value && u === user.value?.id && m === month.value)
      snapshot.value = result
  } catch (e) {
    if (run === generation) error.value = message(e)
  } finally {
    if (run === generation) loading.value = false
  }
}
watch(
  [householdId, () => user.value?.id, month],
  () => {
    snapshot.value = { templates: [], records: [], linked_transactions: [] }
    showEditor.value = false
    action.value = null
    notice.value = ''
    filter.value = 'all'
    void load()
  },
  { immediate: true },
)
function edit(t?: FixedTemplate) {
  editing.value = t
  showEditor.value = true
  action.value = null
  notice.value = ''
  error.value = ''
}
async function save(rule: FixedRule, id: string, revision: number) {
  await mutate(
    () =>
      rpc('save_fixed_expense', {
        p_household: householdId.value,
        p_id: id,
        p_revision: revision,
        p_effective_month: rule.effective_month,
        p_title: rule.title,
        p_amount: rule.amount,
        p_due_day: rule.due_day,
        p_expense_account: rule.expense_account,
        p_payment_account: rule.payment_account,
        p_end_month: rule.end_month,
        p_active: rule.active,
      }),
    '고정지출 항목을 저장했어요.',
  )
}
function begin(row: FixedRow, kind: 'pay' | 'link' | 'skip' | 'reset') {
  action.value = { row, kind }
  actualDate.value = koreaToday()
  actualAmount.value = row.expected.amount
  transactionId.value = ''
  error.value = ''
  notice.value = ''
}
async function mutate(operation: () => Promise<unknown>, success: string) {
  if (busy.value || loading.value) return
  const h = householdId.value,
    u = user.value?.id,
    m = month.value
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await operation()
    if (h !== householdId.value || u !== user.value?.id || m !== month.value) return
    showEditor.value = false
    action.value = null
    notice.value = success
    await load()
  } catch (e) {
    if (h === householdId.value && u === user.value?.id && m === month.value)
      error.value = message(e)
  } finally {
    busy.value = false
  }
}
async function process() {
  if (!action.value) return
  const { row, kind } = action.value
  error.value = ''
  try {
    if (kind === 'pay') {
      validateAmount(actualAmount.value)
      if (!actualDate.value || actualDate.value > koreaToday() || actualDate.value < '1900-01-01')
        throw new Error('실제 납부일은 오늘까지 입력하세요.')
    }
    if (kind === 'link' && !transactionId.value) throw new Error('연결할 거래를 선택하세요.')
    await mutate(
      () =>
        rpc('process_fixed_expense', {
          p_household: householdId.value,
          p_id: row.template.id,
          p_month: month.value + '-01',
          p_template_revision: row.template.revision,
          p_record_revision: row.record?.revision ?? 0,
          p_action: kind,
          p_date: kind === 'pay' ? actualDate.value : null,
          p_amount: kind === 'pay' ? actualAmount.value : null,
          p_transaction: kind === 'link' ? transactionId.value : null,
        }),
      kind === 'pay'
        ? '납부를 확인하고 거래를 저장했어요.'
        : kind === 'link'
          ? '기존 거래를 연결했어요. 새 거래는 만들지 않았어요.'
          : kind === 'skip'
            ? '이번 달 항목을 건너뛰었어요.'
            : '처리를 취소했어요. 기존 거래는 삭제하지 않았어요.',
    )
  } catch (e) {
    error.value = message(e)
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">매달 챙기는 우리의 생활비</span>
      <h1>고정지출</h1>
      <p class="muted">예정 목록을 확인하고, 실제 납부한 금액만 거래로 기록해요.</p>
    </div>
    <button
      class="button"
      :disabled="busy || loading || !fixedMonth(month) || !householdId || !!ledgerError"
      @click="edit()"
    >
      ＋ 고정지출 추가
    </button>
  </div>
  <div class="panel analytics-filters">
    <label
      >고정지출 조회 월<input
        v-model="month"
        type="month"
        min="1900-01"
        max="2199-12"
        :disabled="busy" /></label
    ><label
      >표시 상태<select v-model="filter">
        <option value="all">전체</option>
        <option value="todo">확인할 항목</option>
        <option value="paid">납부 완료</option>
        <option value="skipped">건너뜀</option>
      </select></label
    ><button class="secondary" :disabled="loading || busy || showEditor || !!action" @click="load">
      고정지출 새로고침
    </button>
  </div>
  <p class="fineprint">
    예정액은 거래·예산·통계에 합산되지 않습니다. 카드로 결제한 고정지출을 기록했다면 카드대금 납부는
    기존 ‘카드대금’ 거래로 입력하세요.
  </p>
  <p v-if="!fixedMonth(month)" class="alert error" role="alert">올바른 조회 월을 선택하세요.</p>
  <p v-if="error" class="alert error" role="alert">
    {{ error
    }}<span class="block"
      >통신 오류 후에는 새로고침해 처리 여부를 먼저 확인하세요. 입력 내용은 유지됩니다.</span
    >
  </p>
  <p v-if="notice" class="alert" role="status">{{ notice }}</p>
  <p v-if="loading" role="status">고정지출을 불러오고 있어요…</p>
  <FixedExpenseEditor
    v-if="showEditor"
    :key="editing?.id || 'new'"
    :template="editing"
    :month="month"
    :accounts="data.accounts"
    :busy="busy"
    @save="save"
    @cancel="showEditor = false"
  />
  <template v-if="!loading && fixedMonth(month)">
    <div class="analytics-kpis" aria-label="고정지출 요약">
      <article class="panel">
        <span class="muted">이달 예상액 · 건너뜀 제외</span><MoneyValue :value="summary.expected" />
      </article>
      <article class="panel">
        <span class="muted">연결된 실제 납부액</span><MoneyValue :value="summary.paid" />
      </article>
      <article class="panel">
        <span class="muted">확인할 항목의 예상액</span><MoneyValue :value="summary.remaining" />
      </article>
      <article class="panel">
        <span class="muted">확인 알림</span><strong>기한 지남 {{ summary.overdue }}건</strong
        ><small>거래 확인 필요 {{ summary.review }}건</small>
      </article>
    </div>
    <p class="fineprint">
      실제 금액이 예상과 달라도 납부 확인하면 완료됩니다. 확인할 예상액은 미납 채무 잔액이 아닙니다.
      다른 달에 낸 거래는 거래 날짜 기준으로 통계에 반영됩니다.
    </p>
    <p v-if="!visible.length" class="panel empty-text">
      선택한 월과 상태에 해당하는 고정지출이 없어요.
    </p>
    <section
      v-for="row in visible"
      :key="row.template.id"
      class="panel fixed-card"
      :aria-label="row.expected.title + ' 고정지출'"
    >
      <div class="section-title">
        <h2>{{ row.expected.title }}</h2>
        <strong :class="{ danger: ['overdue', 'review'].includes(row.status) }">{{
          labels[row.status]
        }}</strong>
      </div>
      <p>
        {{ row.expected.due_date }} 예정 · {{ label(row.expected.expense_account) }} ·
        {{ label(row.expected.payment_account) }}
      </p>
      <div class="fixed-amounts">
        <span>예상 <MoneyValue :value="row.expected.amount" /></span
        ><span v-if="row.paid !== null"
          >실제 <MoneyValue :value="row.paid" /> · 차액
          {{ won(row.paid - BigInt(row.expected.amount)) }}원</span
        >
      </div>
      <p v-if="row.status === 'review'" class="alert">
        연결된 거래가 삭제되었거나 계정·날짜가 바뀌었어요. 거래 상세나 휴지통에서 확인하세요. 원래
        거래를 복구하면 연결도 되살아납니다.
      </p>
      <div class="fixed-actions">
        <template v-if="!row.record?.transaction_id && !row.record?.skipped"
          ><button
            class="button"
            :disabled="busy || showEditor || !!ledgerError"
            @click="begin(row, 'pay')"
          >
            납부 확인</button
          ><button
            class="secondary"
            :disabled="busy || showEditor || !!ledgerError"
            @click="begin(row, 'link')"
          >
            기존 거래 연결</button
          ><button class="text-button" :disabled="busy || showEditor" @click="begin(row, 'skip')">
            이번 달 건너뛰기
          </button></template
        >
        <template v-else
          ><NuxtLink
            v-if="row.transaction"
            class="secondary"
            :to="`/transactions/${row.transaction.id}`"
            >연결 거래 보기</NuxtLink
          ><button class="text-button" :disabled="busy || showEditor" @click="begin(row, 'reset')">
            처리 취소
          </button></template
        >
      </div>
      <form
        v-if="action?.row.template.id === row.template.id"
        class="fixed-confirm"
        aria-label="고정지출 처리 확인"
        @submit.prevent="process"
      >
        <fieldset :disabled="busy">
          <template v-if="action.kind === 'pay'"
            ><h3>실제 납부 내용 확인</h3>
            <div class="fixed-fields">
              <label
                >실제 납부일<input
                  v-model="actualDate"
                  required
                  type="date"
                  min="1900-01-01"
                  :max="now" /></label
              ><label
                >실제 납부금액<AmountInput v-model="actualAmount" label="고정지출 실제 납부금액"
              /></label>
            </div>
            <p class="fineprint">
              확인하면 지출 거래 1건이 저장됩니다. 이미 거래를 입력했다면 닫고 ‘기존 거래 연결’을
              선택하세요.
            </p>
            <p v-if="candidates.length" class="alert">
              같은 계정의 연결 가능한 거래가 {{ candidates.length }}건 있어요. 기존 거래인지 먼저
              확인하세요.
            </p></template
          >
          <template v-else-if="action.kind === 'link'"
            ><label
              >연결할 거래<select v-model="transactionId" required>
                <option value="" disabled>같은 지출·결제 계정의 거래 선택</option>
                <option v-for="t in candidates" :key="t.id" :value="t.id">
                  {{ t.transaction_date }} · {{ t.description }} ·
                  {{ won(t.lines.find((l) => l.entry_type === 'DEBIT')!.amount) }}원
                </option>
              </select></label
            >
            <p class="fineprint">
              기존 거래를 연결하며 새 거래는 만들지 않습니다. 분할 거래는 연결 대상에서 제외됩니다.
            </p>
            <p v-if="!candidates.length">연결 가능한 거래가 없어요.</p></template
          >
          <p v-else-if="action.kind === 'skip'">
            이번 달에만 건너뜁니다. 다음 달 예정 목록과 기존 거래는 바뀌지 않습니다.
          </p>
          <p v-else>
            처리 상태와 거래 연결만 해제합니다. 기존 거래는 남아 있으므로 다시 처리할 때 ‘기존 거래
            연결’을 사용하세요.
          </p>
          <div class="fixed-actions">
            <button class="button" :disabled="action.kind === 'link' && !transactionId">
              {{ busy ? '처리 중…' : '확인하고 저장' }}</button
            ><button class="secondary" type="button" @click="action = null">닫기</button>
          </div>
        </fieldset>
      </form>
    </section>
    <section class="panel">
      <h2>등록 항목 관리</h2>
      <p class="fineprint">
        종료·중단한 항목도 표시합니다. 금액 변경이나 재개는 적용 월을 지정하세요. 개인회생 일정과
        대출 원금 상환은 기존 전용 화면에서 관리하세요.
      </p>
      <div v-for="t in snapshot.templates" :key="t.id" class="fixed-management">
        <span
          >{{ (ruleAt(t, month) ?? t.rules[0])?.title }}
          <small class="muted">· 규칙 {{ t.rules.length }}개</small></span
        ><button class="secondary" :disabled="busy || loading" @click="edit(t)">규칙 수정</button>
      </div>
    </section>
  </template>
</template>
