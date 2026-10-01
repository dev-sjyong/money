<script setup lang="ts">
import type { Line, Transaction, TransactionKind } from '~/types/ledger'
import { kindLabels } from '~/types/ledger'
import { simpleLines, today, won } from '~/utils/accounting'
import { duplicateCandidates } from '~/utils/workflow'
import { copyTransactionDraft, inferTransactionKind } from '~/utils/transactionDraft'
const props = defineProps<{ existing?: Transaction; copyFrom?: Transaction }>()
const { active, accounts, label } = useAccounts()
const { save } = useTransactions()
const { preferences, update } = useWorkflowPreferences()
const { transactions } = useTransactions()
const duplicates = ref<Transaction[]>([])
const draft = props.copyFrom ? copyTransactionDraft(props.copyFrom) : null
const source = props.existing ?? props.copyFrom
const kind = ref<TransactionKind>(
  props.existing
    ? 'journal'
    : draft
      ? inferTransactionKind(draft.lines, accounts.value)
      : 'expense',
)
const date = ref(props.existing?.transaction_date ?? today()),
  description = ref(source?.description ?? ''),
  memo = ref(source?.memo ?? ''),
  value = ref(draft?.lines.find((l) => l.entry_type === 'DEBIT')?.amount ?? ''),
  debit = ref(draft?.lines.find((l) => l.entry_type === 'DEBIT')?.account_id ?? ''),
  credit = ref(draft?.lines.find((l) => l.entry_type === 'CREDIT')?.account_id ?? ''),
  busy = ref(false),
  error = ref('')
const requestId = crypto.randomUUID()
const lines = ref<Line[]>(
  source
    ? source.lines.map((l) => ({ ...l }))
    : [
        { account_id: '', entry_type: 'DEBIT', amount: '' },
        { account_id: '', entry_type: 'CREDIT', amount: '' },
      ],
)
const choices = computed(() => {
  const types: Record<TransactionKind, [string[], string[]]> = {
    expense: [['EXPENSE'], ['ASSET', 'LIABILITY']],
    income: [['ASSET'], ['INCOME']],
    transfer: [['ASSET'], ['ASSET']],
    card: [['LIABILITY'], ['ASSET']],
    loan: [['LIABILITY'], ['ASSET']],
    journal: [[], []],
  }
  return types[kind.value]
})
const debitOptions = computed(() => active.value.filter((a) => choices.value[0].includes(a.type))),
  creditOptions = computed(() => active.value.filter((a) => choices.value[1].includes(a.type)))
const labels = computed(
  () =>
    ({
      expense: ['지출 항목', '결제 계정'],
      income: ['입금 계정', '수입 항목'],
      transfer: ['입금 계정', '출금 계정'],
      card: ['카드 계정', '출금 계정'],
      loan: ['대출 계정', '출금 계정'],
      journal: ['차변', '대변'],
    })[kind.value],
)
const sums = computed(() =>
  lines.value.reduce(
    (s, l) => {
      if (/^\d+$/.test(l.amount)) s[l.entry_type] += BigInt(l.amount)
      return s
    },
    { DEBIT: 0n, CREDIT: 0n },
  ),
)
function restoreRecent() {
  const recent = preferences.value.recent[kind.value]
  debit.value = debitOptions.value.some((a) => a.id === recent?.debit) ? recent!.debit : ''
  credit.value = creditOptions.value.some((a) => a.id === recent?.credit) ? recent!.credit : ''
}
if (!source) restoreRecent()
watch(kind, restoreRecent)
watch([debitOptions, creditOptions, () => preferences.value.recent[kind.value]], () => {
  if (!source && !debit.value && !credit.value) restoreRecent()
})
watch([date, description, value, debit, credit, lines], () => (duplicates.value = []), {
  deep: true,
})
async function submit(confirmed = false) {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    let journal = lines.value
    if (kind.value !== 'journal') {
      const d = accounts.value.find((a) => a.id === debit.value),
        c = accounts.value.find((a) => a.id === credit.value)
      if (!d || !c) throw new Error('계정을 선택하세요.')
      journal = simpleLines(kind.value, d, c, value.value)
    }
    const matches = duplicateCandidates(transactions.value, date.value, journal, props.existing?.id)
    if (!confirmed && matches.length) {
      duplicates.value = matches
      return
    }
    await save(
      {
        id: requestId,
        date: date.value,
        description: description.value,
        memo: memo.value,
        lines: journal,
      },
      props.existing,
    )
    if (kind.value !== 'journal')
      update((p) => {
        p.recent[kind.value] = { debit: debit.value, credit: credit.value }
      })
    await navigateTo('/transactions')
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <form class="panel transaction-form" @submit.prevent="submit(false)">
    <p v-if="copyFrom" class="alert" role="status">
      기존 거래를 복사했어요. 날짜는 오늘이며, 저장하면 별도의 새 거래가 됩니다.
    </p>
    <p
      v-if="source?.lines.some((l) => accounts.find((a) => a.id === l.account_id)?.is_archived)"
      class="alert"
    >
      보관된 계정이 있어요. 사용 가능한 계정으로 바꾸거나 먼저 계정을 복구해 주세요.
    </p>
    <div v-if="!existing" class="tabs" aria-label="거래 유형">
      <button
        v-for="(title, k) in kindLabels"
        :key="k"
        type="button"
        :class="{ selected: kind === k }"
        @click="kind = k"
      >
        {{ title }}
      </button>
    </div>
    <p v-else class="alert">
      기존 분개를 확인하며 수정하세요. 보관된 계정이 있다면 사용 가능한 계정으로 바꾸거나 먼저
      복구해 주세요.
    </p>
    <div class="form-grid">
      <label>날짜<input v-model="date" type="date" required /></label
      ><label
        >사용처 / 설명<input
          v-model="description"
          required
          maxlength="200"
          placeholder="어떤 거래였나요?"
      /></label>
    </div>
    <p v-if="!source && (debit || credit)" class="fineprint">
      최근 사용한 계정을 선택했어요. 저장 전에 확인하세요. 이 브라우저에 유형별로 기억합니다.
    </p>
    <template v-if="kind !== 'journal'">
      <div class="amount-input">
        <span class="field-label">금액 (원)</span><AmountInput v-model="value" label="금액" quick />
      </div>
      <div class="form-grid">
        <label
          >{{ labels[0]
          }}<select v-model="debit" required>
            <option value="" disabled>계정을 선택하세요</option>
            <option v-for="a in debitOptions" :key="a.id" :value="a.id">{{ label(a.id) }}</option>
          </select></label
        ><label
          >{{ labels[1]
          }}<select v-model="credit" required>
            <option value="" disabled>계정을 선택하세요</option>
            <option v-for="a in creditOptions" :key="a.id" :value="a.id">{{ label(a.id) }}</option>
          </select></label
        >
      </div>
      <p v-if="kind === 'card' || kind === 'transfer' || kind === 'loan'" class="hint">
        {{
          kind === 'loan'
            ? '원금 상환 금액을 입력하세요. 이자가 있다면 직접분개에서 이자 비용을 별도 추가하세요.'
            : '계좌이체와 카드대금 결제는 지출에 포함되지 않아요.'
        }}
      </p></template
    ><template v-else
      ><div class="journal-labels">
        <span>계정</span><span>차변 / 대변</span><span>금액 (원)</span>
      </div>
      <div v-for="(l, i) in lines" :key="i" class="journal-row">
        <select v-model="l.account_id" required :aria-label="`분개 ${i + 1} 계정`">
          <option value="" disabled>계정 선택</option>
          <option
            v-for="a in accounts.filter((a) => !a.is_archived || a.id === l.account_id)"
            :key="a.id"
            :value="a.id"
          >
            {{ label(a.id) }}{{ a.is_archived ? ' (보관됨)' : '' }}
          </option></select
        ><select v-model="l.entry_type" :aria-label="`분개 ${i + 1} 유형`">
          <option value="DEBIT">차변</option>
          <option value="CREDIT">대변</option></select
        ><AmountInput v-model="l.amount" :label="`분개 ${i + 1} 금액`" /><button
          type="button"
          class="icon-button"
          :disabled="lines.length <= 2"
          :aria-label="`분개 ${i + 1} 삭제`"
          @click="lines.splice(i, 1)"
        >
          ×
        </button>
        <label class="line-memo"
          >분개 메모 <span class="muted">선택</span
          ><input
            v-model="l.memo"
            maxlength="2000"
            :aria-label="`분개 ${i + 1} 메모`"
            placeholder="이 분개에 대한 메모"
        /></label>
      </div>
      <button
        type="button"
        class="secondary"
        :disabled="lines.length >= 100"
        @click="lines.push({ account_id: '', entry_type: 'DEBIT', amount: '' })"
      >
        ＋ 분개 추가
      </button>
      <div class="journal-totals" :class="{ unbalanced: sums.DEBIT !== sums.CREDIT }">
        <span>차변 {{ won(sums.DEBIT) }}원</span><span>대변 {{ won(sums.CREDIT) }}원</span
        ><strong>{{
          sums.DEBIT === sums.CREDIT ? '균형 일치' : '차이 ' + won(sums.DEBIT - sums.CREDIT) + '원'
        }}</strong>
      </div></template
    ><label
      >메모 <span class="muted">선택</span
      ><textarea
        v-model="memo"
        maxlength="2000"
        placeholder="기억해 두고 싶은 내용을 적어 주세요."
        rows="3"
      ></textarea>
    </label>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <div v-if="duplicates.length" class="alert" role="alert">
      <p>
        같은 날짜·계정·금액의 거래가 {{ duplicates.length }}건 있어요. 중복 기록인지 확인하세요.
      </p>
      <NuxtLink v-for="t in duplicates" :key="t.id" :to="'/transactions/' + t.id" class="block"
        >{{ t.description }} · 기존 거래 보기 ↗</NuxtLink
      >
      <button type="button" class="secondary" :disabled="busy" @click="submit(true)">
        확인하고 별도 거래 저장
      </button>
    </div>
    <div class="form-actions mobile-save-actions">
      <NuxtLink to="/transactions" class="secondary">취소</NuxtLink
      ><button class="button" :disabled="busy">
        {{ busy ? '저장 중…' : existing ? '수정 저장' : '거래 저장' }} →
      </button>
    </div>
  </form>
</template>
