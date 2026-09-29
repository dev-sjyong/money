<script setup lang="ts">
import type { RepaymentPlan, RepaymentRow } from '~/types/repayment'
import { monthlyRepayments, paidFor, repaymentAmount, validateRepayments } from '~/utils/repayment'
import { today, won } from '~/utils/accounting'
const props = defineProps<{ plan: RepaymentPlan; busy: boolean }>()
const emit = defineEmits<{ save: [plan: RepaymentPlan]; cancel: [] }>()
const draft = ref<RepaymentPlan>(JSON.parse(JSON.stringify(props.plan)))
const start = ref(today().slice(0, 7)),
  end = ref(today().slice(0, 7)),
  day = ref(25),
  amount = ref('')
const error = ref(''),
  paying = ref(''),
  paymentDate = ref(today()),
  paymentAmount = ref('')
const confirmRemoval = ref<{ row: string; payment?: string } | null>(null)
const rows = computed(() =>
  [...draft.value.rows].sort((a, b) => a.due_date.localeCompare(b.due_date)),
)
function append() {
  error.value = ''
  try {
    const added = monthlyRepayments(start.value, end.value, Number(day.value), amount.value, () =>
      crypto.randomUUID(),
    )
    if (added.some((r) => draft.value.rows.some((old) => old.due_date === r.due_date)))
      throw new Error('이미 등록된 납부일이 있어요. 기존 회차를 수정하거나 다른 기간을 선택하세요.')
    if (draft.value.rows.length + added.length > 600)
      throw new Error('최대 600회차까지 등록할 수 있어요.')
    draft.value.rows.push(...added)
  } catch (e) {
    error.value = message(e)
  }
}
function scheduled(row: RepaymentRow) {
  try {
    return repaymentAmount(row.amount)
  } catch {
    return 0n
  }
}
function beginPayment(row: RepaymentRow) {
  error.value = ''
  try {
    const left = repaymentAmount(row.amount) - paidFor(row)
    if (left <= 0n)
      throw new Error('이미 납부 완료한 회차입니다. 예정액이나 기존 기록을 확인하세요.')
    paying.value = row.id
    paymentDate.value = today()
    paymentAmount.value = String(left)
  } catch (e) {
    error.value = message(e)
  }
}
function addPayment() {
  error.value = ''
  try {
    const row = draft.value.rows.find((r) => r.id === paying.value)!
    repaymentAmount(paymentAmount.value)
    const candidate: RepaymentRow = {
      ...row,
      payments: [
        ...row.payments,
        { id: crypto.randomUUID(), date: paymentDate.value, amount: paymentAmount.value },
      ],
    }
    validateRepayments([candidate], today())
    row.payments = candidate.payments
    paying.value = ''
  } catch (e) {
    error.value = message(e)
  }
}
function removeConfirmed() {
  const target = confirmRemoval.value!
  const row = draft.value.rows.find((r) => r.id === target.row)!
  if (target.payment) row.payments = row.payments.filter((p) => p.id !== target.payment)
  else if (!row.payments.length)
    draft.value.rows = draft.value.rows.filter((r) => r.id !== target.row)
  confirmRemoval.value = null
}
function save() {
  error.value = ''
  try {
    if (!draft.value.name.trim()) throw new Error('이름 또는 별칭을 입력하세요.')
    validateRepayments(draft.value.rows, today())
    draft.value.rows = rows.value
    emit('save', JSON.parse(JSON.stringify(draft.value)))
  } catch (e) {
    error.value = message(e)
  }
}
</script>
<template>
  <section class="panel repayment-editor" aria-label="변제 일정 편집">
    <h2>{{ plan.revision ? '변제 일정 수정' : '새 변제 일정' }}</h2>
    <p class="muted">변경사항과 납부 기록은 아래 ‘일정 저장’을 눌러야 반영됩니다.</p>
    <fieldset :disabled="busy">
      <div class="form-grid">
        <label
          >이름 또는 별칭<input v-model="draft.name" maxlength="80" placeholder="본인 / 배우자"
        /></label>
        <label
          >메모<input v-model="draft.note" maxlength="2000" placeholder="일정에 필요한 메모"
        /></label>
      </div>
      <label v-if="plan.revision" class="repayment-check"
        ><input v-model="draft.archived" type="checkbox" />계획 보관 (합계에서 제외)</label
      >
      <section class="repayment-bulk" aria-label="기간별 일정 추가">
        <h3>같은 금액의 기간을 한 번에 추가</h3>
        <div class="form-grid">
          <label>시작 월<input v-model="start" type="month" min="1900-01" max="2199-12" /></label>
          <label>마지막 월<input v-model="end" type="month" min="1900-01" max="2199-12" /></label>
          <label
            >매월 납부일<input v-model="day" type="number" min="1" max="31" inputmode="numeric"
          /></label>
          <label
            >기간 내 월 변제금 (원)<AmountInput v-model="amount" label="기간 내 월 변제금"
          /></label>
        </div>
        <p class="fineprint">
          해당 월에 없는 날짜는 말일로 맞춥니다. 금액이 달라지는 기간은 나눠 추가하세요.
        </p>
        <button type="button" class="secondary" @click="append">기간 추가</button>
      </section>
      <p v-if="!rows.length" class="empty-text">
        먼저 납부 기간을 추가하세요. 회차마다 날짜와 금액을 바꿀 수 있어요.
      </p>
      <article v-for="(row, index) in rows" :key="row.id" class="repayment-row">
        <div class="repayment-row-heading">
          <h3>{{ index + 1 }}회차</h3>
          <span>{{
            paidFor(row) >= scheduled(row) && paidFor(row) > 0n
              ? '납부 완료'
              : paidFor(row) > 0n
                ? '부분 납부'
                : '납부 전'
          }}</span>
        </div>
        <div class="form-grid">
          <label
            >납부 예정일<input
              v-model="row.due_date"
              type="date"
              min="1900-01-01"
              max="2199-12-31"
              :aria-label="`${index + 1}회차 예정일`"
          /></label>
          <label
            >예정금액 (원)<AmountInput v-model="row.amount" :label="`${index + 1}회차 예정금액`"
          /></label>
        </div>
        <p>실제 납부 {{ won(paidFor(row)) }}원</p>
        <ul v-if="row.payments.length" class="repayment-payments">
          <li v-for="payment in row.payments" :key="payment.id">
            <span>{{ payment.date }} · {{ won(payment.amount) }}원</span>
            <button
              type="button"
              class="text-button danger"
              @click="confirmRemoval = { row: row.id, payment: payment.id }"
            >
              납부 기록 삭제
            </button>
          </li>
        </ul>
        <div class="repayment-actions">
          <button type="button" class="secondary" @click="beginPayment(row)">납부 기록 추가</button>
          <button
            type="button"
            class="text-button danger"
            :disabled="!!row.payments.length"
            @click="confirmRemoval = { row: row.id }"
          >
            회차 삭제
          </button>
        </div>
        <p v-if="row.payments.length" class="fineprint">
          납부 기록이 있는 회차는 기록을 먼저 정정해야 삭제할 수 있어요.
        </p>
        <div
          v-if="paying === row.id"
          class="repayment-payment"
          role="group"
          aria-label="실제 납부 입력"
        >
          <div class="form-grid">
            <label
              >실제 납부일<input v-model="paymentDate" type="date" :max="today()" min="1900-01-01"
            /></label>
            <label
              >실제 납부금액 (원)<AmountInput v-model="paymentAmount" label="실제 납부금액"
            /></label>
          </div>
          <div class="repayment-actions">
            <button type="button" class="secondary" @click="addPayment">납부 기록 반영</button
            ><button type="button" class="text-button" @click="paying = ''">입력 닫기</button>
          </div>
        </div>
      </article>
      <div v-if="confirmRemoval" class="alert" role="alert">
        <p>
          {{
            confirmRemoval.payment
              ? '이 납부 기록을 삭제할까요? 잔여 금액이 다시 늘어납니다.'
              : '이 회차를 삭제할까요?'
          }}
        </p>
        <button type="button" class="secondary" @click="removeConfirmed">삭제 확인</button>
        <button type="button" class="text-button" @click="confirmRemoval = null">돌아가기</button>
      </div>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <div class="repayment-save">
        <button type="button" class="secondary" @click="emit('cancel')">편집 취소</button>
        <button type="button" class="button" :disabled="!!paying || !!confirmRemoval" @click="save">
          {{ busy ? '저장 중…' : '일정 저장' }}
        </button>
      </div>
    </fieldset>
  </section>
</template>
