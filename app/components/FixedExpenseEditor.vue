<script setup lang="ts">
import type { FixedTemplate, FixedRule } from '~/types/fixed'
import type { Account } from '~/types/ledger'
import { ruleAt, koreaToday, fixedMonth } from '~/utils/fixed'
import { amount as validateAmount, accountPath } from '~/utils/accounting'
const props = defineProps<{
  template?: FixedTemplate
  month: string
  accounts: Account[]
  busy: boolean
}>()
const emit = defineEmits<{ save: [rule: FixedRule, id: string, revision: number]; cancel: [] }>()
const currentMonth = koreaToday().slice(0, 7)
const minimumMonth = props.template
  ? [
      currentMonth,
      ...props.template.rules
        .map((r) => r.effective_month.slice(0, 7))
        .sort()
        .slice(0, 1),
    ]
      .sort()
      .at(-1)!
  : '1900-01'
const effective = props.template && props.month < minimumMonth ? minimumMonth : props.month
const initial = props.template
  ? (ruleAt(props.template, effective) ?? props.template.rules[0])
  : undefined
const rule = ref<FixedRule>(
  initial
    ? { ...initial, effective_month: effective + '-01' }
    : {
        effective_month: effective + '-01',
        title: '',
        amount: '',
        due_day: 25,
        expense_account: '',
        payment_account: '',
        end_month: null,
        active: true,
      },
)
const effectiveMonth = ref(effective),
  endMonth = ref(initial?.end_month?.slice(0, 7) || ''),
  error = ref(''),
  id = props.template?.id ?? crypto.randomUUID()
function save() {
  error.value = ''
  try {
    validateAmount(rule.value.amount)
    if (
      !rule.value.title.trim() ||
      !fixedMonth(effectiveMonth.value) ||
      (endMonth.value && (!fixedMonth(endMonth.value) || endMonth.value < effectiveMonth.value)) ||
      !Number.isInteger(Number(rule.value.due_day)) ||
      Number(rule.value.due_day) < 1 ||
      Number(rule.value.due_day) > 31
    )
      throw new Error('이름·적용 기간·납부일을 확인하세요.')
    if (props.template && effectiveMonth.value < minimumMonth)
      throw new Error('변경은 이번 달과 최초 시작 월 이후부터 적용할 수 있어요.')
    if (!rule.value.expense_account || !rule.value.payment_account)
      throw new Error('지출과 결제 계정을 선택하세요.')
    emit(
      'save',
      {
        ...rule.value,
        due_day: Number(rule.value.due_day),
        effective_month: effectiveMonth.value + '-01',
        end_month: endMonth.value ? endMonth.value + '-01' : null,
      },
      id,
      props.template?.revision ?? 0,
    )
  } catch (e) {
    error.value = message(e)
  }
}
</script>
<template>
  <form class="panel fixed-editor" aria-label="고정지출 항목 편집" @submit.prevent="save">
    <h2>{{ template ? '적용 월부터 변경' : '고정지출 항목 추가' }}</h2>
    <fieldset :disabled="busy">
      <div class="fixed-fields">
        <label
          >항목 이름<input
            v-model="rule.title"
            required
            maxlength="100"
            placeholder="월세, 보험료, 휴대폰 요금"
        /></label>
        <label
          >예상 금액 (원)<AmountInput v-model="rule.amount" label="고정지출 예상 금액"
        /></label>
        <label
          >매월 납부일<input
            v-model="rule.due_day"
            required
            type="number"
            min="1"
            max="31"
            inputmode="numeric"
        /></label>
        <label
          >적용 시작 월<input
            v-model="effectiveMonth"
            required
            type="month"
            :min="minimumMonth"
            max="2199-12"
        /></label>
        <label
          >종료 월 · 선택<input v-model="endMonth" type="month" :min="effectiveMonth" max="2199-12"
        /></label>
        <label
          >상태<select v-model="rule.active">
            <option :value="true">사용</option>
            <option :value="false">적용 월부터 중단</option>
          </select></label
        >
        <label
          >지출 항목<select v-model="rule.expense_account" required>
            <option value="" disabled>지출 계정 선택</option>
            <option
              v-for="a in accounts.filter(
                (a) => a.type === 'EXPENSE' && (!a.is_archived || a.id === rule.expense_account),
              )"
              :key="a.id"
              :value="a.id"
            >
              {{ accountPath(accounts, a.id) }}{{ a.is_archived ? ' (보관됨)' : '' }}
            </option>
          </select></label
        >
        <label
          >결제 계정<select v-model="rule.payment_account" required>
            <option value="" disabled>은행 또는 카드 선택</option>
            <option
              v-for="a in accounts.filter(
                (a) =>
                  ['ASSET', 'LIABILITY'].includes(a.type) &&
                  (!a.is_archived || a.id === rule.payment_account),
              )"
              :key="a.id"
              :value="a.id"
            >
              {{ accountPath(accounts, a.id) }}{{ a.is_archived ? ' (보관됨)' : '' }}
            </option>
          </select></label
        >
      </div>
      <p class="fineprint">
        해당 월에 없는 납부일은 말일로 맞춥니다. 이미 납부·연결·건너뛰기로 처리한 달은 당시
        예정정보를 유지합니다. 자동 결제나 자동 거래 생성은 하지 않습니다.
      </p>
      <details v-if="template">
        <summary>등록된 적용 월 확인</summary>
        <ul>
          <li v-for="r in template.rules" :key="r.effective_month">
            {{ r.effective_month.slice(0, 7) }}부터 · {{ r.title }} · {{ r.amount }}원 ·
            {{ r.active ? '사용' : '중단'
            }}{{ r.end_month ? ' · 종료 ' + r.end_month.slice(0, 7) : '' }}
          </li>
        </ul>
        <p class="fineprint">같은 적용 월은 변경되며, 이후 월로 이미 예약한 규칙은 유지됩니다.</p>
      </details>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button type="button" class="secondary" @click="emit('cancel')">편집 취소</button
        ><button class="button">{{ busy ? '저장 중…' : '항목 저장' }}</button>
      </div>
    </fieldset>
  </form>
</template>
