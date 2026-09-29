<script setup lang="ts">
import type { Account, AccountType } from '~/types/ledger'
import { accountLabels } from '~/types/ledger'
import { descendantIds } from '~/utils/accounting'
const { accounts, balances, label } = useAccounts()
const { isOwner, rpc, refresh } = useLedger()
const { householdId } = useHousehold()
const type = ref<AccountType>('ASSET'),
  showArchived = ref(false),
  editing = ref(false),
  id = ref<string | null>(null),
  name = ref(''),
  code = ref(''),
  formType = ref<AccountType>('ASSET'),
  parent = ref(''),
  archived = ref(false),
  busy = ref(false),
  error = ref('')
const visible = computed(() =>
  accounts.value.filter((a) => a.type === type.value && (showArchived.value || !a.is_archived)),
)
const parents = computed(() =>
  accounts.value.filter(
    (a) =>
      a.type === formType.value &&
      !a.is_archived &&
      (!id.value || !descendantIds(accounts.value, id.value).has(a.id)),
  ),
)
function edit(a?: Account) {
  id.value = a?.id ?? null
  name.value = a?.name ?? ''
  code.value = a?.code ?? ''
  formType.value = a?.type ?? type.value
  parent.value = a?.parent_account_id ?? ''
  archived.value = a?.is_archived ?? false
  error.value = ''
  editing.value = true
}
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await rpc('save_account', {
      p_household: householdId.value,
      p_id: id.value,
      p_name: name.value,
      p_type: formType.value,
      p_parent: parent.value || null,
      p_code: code.value || null,
      p_archived: archived.value,
    })
    await refresh()
    editing.value = false
  } catch (e) {
    error.value = message(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">돈이 머무는 자리</span>
      <h1>자산과 계정</h1>
      <p class="muted">자산부터 지출 항목까지, 우리 집에 맞게 정리해요.</p>
    </div>
    <button v-if="isOwner" class="button" @click="edit()">＋ 계정 추가</button>
  </div>
  <form v-if="editing" class="panel account-form" @submit.prevent="save">
    <div class="section-title">
      <h2>{{ id ? '계정 수정' : '새 계정' }}</h2>
      <button type="button" class="icon-button" aria-label="편집 닫기" @click="editing = false">
        ×
      </button>
    </div>
    <div class="form-grid">
      <label>계정 이름<input v-model="name" required maxlength="100" /></label
      ><label
        >유형<select v-model="formType" :disabled="!!id" @change="parent = ''">
          <option v-for="(text, k) in accountLabels" :key="k" :value="k">{{ text }}</option>
        </select></label
      ><label
        >상위 계정<select v-model="parent">
          <option value="">없음 · 최상위 계정</option>
          <option v-for="a in parents" :key="a.id" :value="a.id">{{ label(a.id) }}</option>
        </select></label
      ><label
        >계정 코드 <span class="muted">선택</span><input v-model="code" maxlength="100"
      /></label>
    </div>
    <label v-if="id" class="checkbox"
      ><input v-model="archived" type="checkbox" />보관하기 (기존 거래는 유지됩니다)</label
    >
    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <div class="form-actions">
      <button type="button" class="secondary" @click="editing = false">취소</button
      ><button class="button" :disabled="busy">{{ busy ? '저장 중…' : '계정 저장' }}</button>
    </div>
  </form>
  <section class="panel">
    <div class="toolbar">
      <div class="tabs">
        <button
          v-for="(text, k) in accountLabels"
          :key="k"
          :class="{ selected: type === k }"
          @click="type = k"
        >
          {{ text }}
        </button>
      </div>
      <label class="checkbox"><input v-model="showArchived" type="checkbox" />보관 계정 포함</label>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>계정 이름</th>
            <th>코드</th>
            <th class="right">원장 잔액</th>
            <th>상태</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in visible" :key="a.id">
            <td class="table-title">{{ label(a.id) }}</td>
            <td class="muted">{{ a.code || '—' }}</td>
            <td class="right"><MoneyValue :value="balances.get(a.id) || 0n" /></td>
            <td>
              <span class="badge">{{
                a.is_archived ? '보관됨' : a.is_system ? '기본 자본' : '사용 중'
              }}</span>
            </td>
            <td>
              <button v-if="isOwner && !a.is_system" class="text-button" @click="edit(a)">
                수정
              </button>
            </td>
          </tr>
          <tr v-if="!visible.length">
            <td colspan="5" class="empty-text">등록된 계정이 없어요.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="fineprint">
      잔액은 해당 계정의 모든 분개로 계산합니다. 상위 계정 행은 하위 계정 잔액을 중복 합산하지
      않습니다.
    </p>
  </section>
  <NuxtLink v-if="isOwner" class="text-button" to="/settings/accounts"
    >시작할 때의 자산·부채 등록하기 →</NuxtLink
  >
</template>
