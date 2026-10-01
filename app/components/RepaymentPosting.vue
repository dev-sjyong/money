<script setup lang="ts">
import type { RepaymentPlan } from '~/types/repayment'
import type { RepaymentLink } from '~/utils/upcoming'
import { linkNeedsReview } from '~/utils/upcoming'
import { paidFor } from '~/utils/repayment'
import { koreaToday } from '~/utils/fixed'
const props = defineProps<{ plan: RepaymentPlan; links: RepaymentLink[] }>(),
  emit = defineEmits<{ saved: [] }>()
const { householdId } = useHousehold(),
  { rpc, data, refresh } = useLedger(),
  { user } = useAuth()
const rowId = ref(''),
  mode = ref('pay'),
  expense = ref(''),
  source = ref(''),
  transaction = ref(''),
  date = ref(koreaToday()),
  amount = ref(''),
  busy = ref(false),
  error = ref(''),
  paymentId = ref(crypto.randomUUID())
const unlink = ref<RepaymentLink | null>(null)
const row = computed(() => props.plan.rows.find((r) => r.id === rowId.value))
const accounts = computed(() => data.value.accounts.filter((a) => !a.is_archived))
const candidates = computed(() =>
  data.value.transactions.filter(
    (t) =>
      !t.is_opening &&
      t.transaction_date <= koreaToday() &&
      t.lines.length === 2 &&
      t.lines.some((l) => l.account_id === expense.value && l.entry_type === 'DEBIT') &&
      t.lines.some((l) => l.account_id === source.value && l.entry_type === 'CREDIT') &&
      !props.links.some((l) => l.transaction_id === t.id),
  ),
)
const ownLinks = computed(() => props.links.filter((l) => l.plan_id === props.plan.id))
function begin() {
  error.value = ''
  amount.value = row.value ? String(BigInt(row.value.amount) - paidFor(row.value)) : ''
  paymentId.value = crypto.randomUUID()
  transaction.value = ''
}
watch(rowId, begin)
watch([expense, source], () => (transaction.value = ''))
async function submit(action = 'pay', link?: RepaymentLink) {
  if (busy.value) return
  const h = householdId.value,
    u = user.value?.id
  if (h !== props.plan.household_id) return
  busy.value = true
  error.value = ''
  try {
    if (action !== 'unlink' && (!row.value || !expense.value || !source.value))
      throw new Error('회차와 지출 항목, 출금 자산을 선택하세요.')
    if (
      action !== 'unlink' &&
      ownLinks.value.some(
        (l) => l.row_id === rowId.value && linkNeedsReview(l, data.value.transactions),
      )
    )
      throw new Error('이 회차의 연결 거래를 먼저 확인하거나 연결 해제하세요.')
    await rpc('process_repayment_payment', {
      p_household: h,
      p_plan: props.plan.id,
      p_revision: props.plan.revision,
      p_row: link?.row_id ?? rowId.value,
      p_action: action,
      p_payment: link?.payment_id ?? paymentId.value,
      p_date: date.value,
      p_amount: amount.value,
      p_expense: expense.value || null,
      p_source: source.value || null,
      p_transaction: transaction.value || null,
    })
    if (h !== householdId.value || u !== user.value?.id) return
    rowId.value = ''
    await refresh()
    emit('saved')
  } catch (e) {
    if (h === householdId.value && u === user.value?.id) error.value = message(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="repayment-posting">
    <details>
      <summary>납부 완료 · 거래 연결</summary>
      <p class="fineprint">
        새 거래와 납부를 함께 저장하거나 기존 거래를 연결해요. 일부만 납부한 금액도 입력할 수
        있어요. 카드 결제 대신 실제 출금 자산을 선택하세요.
      </p>
      <form @submit.prevent="submit(mode)">
        <fieldset :disabled="busy || plan.archived">
          <div class="form-grid">
            <label
              >납부할 회차<select v-model="rowId" required>
                <option value="">회차 선택</option>
                <option
                  v-for="r in plan.rows.filter((r) => paidFor(r) < BigInt(r.amount))"
                  :key="r.id"
                  :value="r.id"
                >
                  {{ r.due_date }} · 남은 {{ BigInt(r.amount) - paidFor(r) }}원
                </option>
              </select></label
            >
            <label
              >기록 방식<select v-model="mode">
                <option value="pay">새 거래와 함께 기록</option>
                <option value="link">기존 거래 연결</option>
              </select></label
            >
            <label
              >변제금 지출 항목<select v-model="expense" required>
                <option value="">항목 선택</option>
                <option
                  v-for="a in accounts.filter((a) => a.type === 'EXPENSE')"
                  :key="a.id"
                  :value="a.id"
                >
                  {{ a.name }}
                </option>
              </select></label
            >
            <label
              >출금 자산<select v-model="source" aria-label="출금 자산" required>
                <option value="">자산 선택</option>
                <option
                  v-for="a in accounts.filter((a) => a.type === 'ASSET')"
                  :key="a.id"
                  :value="a.id"
                >
                  {{ a.name }}
                </option>
              </select></label
            >
            <template v-if="mode === 'pay'"
              ><label
                >거래 납부일<input v-model="date" type="date" :max="koreaToday()" required /></label
              ><label
                >거래 납부금액 (원)<AmountInput
                  v-model="amount"
                  label="거래 납부금액"
                  required /></label
            ></template>
            <label v-else
              >연결할 거래<select v-model="transaction" required>
                <option value="">거래 선택</option>
                <option v-for="t in candidates" :key="t.id" :value="t.id">
                  {{ t.transaction_date }} · {{ t.description }} · {{ t.lines[0]?.amount }}원
                </option>
              </select></label
            >
          </div>
          <p v-if="mode === 'link'" class="fineprint">
            선택한 거래의 날짜와 전체 금액을 납부 기록에 반영해요. 하나의 거래는 하나의 회차에
            연결할 수 있어요.
          </p>
          <button class="button">
            {{ busy ? '저장 중…' : mode === 'pay' ? '납부와 거래 함께 저장' : '선택한 거래 연결' }}
          </button>
        </fieldset>
      </form>
    </details>
    <ul class="payment-links">
      <li v-for="l in ownLinks" :key="l.payment_id">
        <span
          >{{ l.snapshot.date }} · <MoneyValue :value="l.snapshot.amount" />
          <NuxtLink :to="'/transactions/' + l.transaction_id">연결 거래 보기 ↗</NuxtLink
          ><strong v-if="linkNeedsReview(l, data.transactions)" class="danger">
            · 거래 확인 필요</strong
          ></span
        ><button class="text-button" :disabled="busy" @click="unlink = l">연결 해제</button>
      </li>
    </ul>
    <div v-if="unlink" class="alert" role="alert">
      <p>
        이 납부 기록을 지우고 연결을 해제할까요? 거래는 그대로 남으며 납부 잔액은 다시 늘어납니다.
      </p>
      <button
        class="secondary"
        :disabled="busy"
        @click="
          submit('unlink', unlink).then(() => {
            if (!error) unlink = null
          })
        "
      >
        연결 해제 확인</button
      ><button class="text-button" @click="unlink = null">취소</button>
    </div>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
  </div>
</template>
