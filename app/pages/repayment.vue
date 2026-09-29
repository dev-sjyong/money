<script setup lang="ts">
import type { RepaymentPlan } from '~/types/repayment'
import { repaymentSummary } from '~/utils/repayment'
import { today, won, percent } from '~/utils/accounting'
const {householdId}=useHousehold(), {rpc}=useLedger(), {user}=useAuth()
const plans=ref<RepaymentPlan[]>([]), editing=ref<RepaymentPlan|null>(null), busy=ref(false), loading=ref(false), error=ref(''), notice=ref(''), showArchived=ref(false)
const cancelConfirm=ref(false)
let generation=0
const now=ref(today())
const active=computed(()=>plans.value.filter(p=>!p.archived))
const visible=computed(()=>plans.value.filter(p=>showArchived.value||!p.archived).map(plan=>({plan,summary:repaymentSummary(plan.rows,now.value)})))
const combined=computed(()=>repaymentSummary(active.value.flatMap(p=>p.rows),now.value))
async function load() {
  const run=++generation,h=householdId.value,u=user.value?.id
  loading.value=true;error.value='';now.value=today()
  try {
    const result=h&&u ? await rpc<RepaymentPlan[]>('get_repayment_plans',{p_household:h}):[]
    if(run===generation&&h===householdId.value&&u===user.value?.id) plans.value=result
  }catch(e){if(run===generation)error.value=message(e)}
  finally{if(run===generation)loading.value=false}
}
watch([householdId,()=>user.value?.id],()=>{plans.value=[];editing.value=null;cancelConfirm.value=false;notice.value='';void load()},{immediate:true})
function start(plan?:RepaymentPlan) {
  notice.value='';error.value='';cancelConfirm.value=false
  editing.value=plan ?? {id:crypto.randomUUID(),household_id:householdId.value,name:'',note:'',rows:[],revision:0,archived:false}
}
async function save(plan:RepaymentPlan) {
  if(busy.value||plan.household_id!==householdId.value)return
  const h=householdId.value,u=user.value?.id
  busy.value=true;error.value=''
  try {
    await rpc('save_repayment_plan',{p_household:h,p_id:plan.id,p_revision:plan.revision,p_name:plan.name,p_note:plan.note,p_rows:plan.rows,p_archived:plan.archived})
    if(h!==householdId.value||u!==user.value?.id)return
    editing.value=null;notice.value='변제 일정을 저장했어요.';await load()
  }catch(e){if(h===householdId.value&&u===user.value?.id)error.value=message(e)}
  finally{busy.value=false}
}
</script>
<template>
  <div class="page-heading"><div><span class="eyebrow">각자의 일정, 함께 보는 계획</span><h1>개인회생 일정</h1><p class="muted">회차마다 다른 변제금과 실제 납부 내역을 기록해요.</p></div>
    <button v-if="!editing" class="button" :disabled="!householdId||loading||busy" @click="start()">＋ 변제 일정 추가</button>
  </div>
  <p class="fineprint">이 화면의 납부 기록은 가계부 거래와 별도로 관리됩니다. 종료 예정일은 등록한 마지막 납부일이며, 면책 결정 여부를 뜻하지 않습니다.</p>
  <p v-if="notice" class="alert" role="status">{{notice}}</p>
  <p v-if="error" class="alert error" role="alert">{{error}}<span v-if="editing" class="block">입력 내용은 유지됩니다. 충돌이 발생했다면 편집을 취소하고 새로고침 후 다시 입력하세요.</span></p>
  <RepaymentEditor v-if="editing" :key="editing.id" :plan="editing" :busy="busy" @save="save" @cancel="cancelConfirm=true" />
  <div v-if="cancelConfirm" class="alert" role="alert"><p>저장하지 않은 변경을 버릴까요?</p><button class="secondary" @click="editing=null;cancelConfirm=false">변경 버리기</button><button class="text-button" @click="cancelConfirm=false">계속 편집</button></div>
  <template v-if="!editing">
    <div class="stat-grid repayment-summary" aria-label="변제 일정 합계">
      <div class="panel"><span class="muted">이번 달 예정액 · 두 사람 합계</span><MoneyValue :value="combined.month" /></div>
      <div class="panel"><span class="muted">이번 달 남은 납부액</span><MoneyValue :value="combined.monthRemaining" /></div>
      <div class="panel"><span class="muted">전체 남은 예정액</span><MoneyValue :value="combined.remaining" /></div>
    </div>
    <div class="toolbar"><label class="repayment-check"><input v-model="showArchived" type="checkbox" />보관한 계획 포함</label><button class="secondary" :disabled="loading||busy" @click="load">일정 새로고침</button></div>
    <p v-if="loading" role="status">변제 일정을 불러오고 있어요…</p>
    <p v-else-if="!visible.length && !error" class="panel empty-text">등록된 일정이 없어요. 본인과 배우자의 계획을 각각 추가하세요.</p>
    <section v-for="{plan,summary} in visible" :key="plan.id" class="panel repayment-card" :aria-label="plan.name+' 변제 계획'">
      <div class="repayment-row-heading"><h2>{{plan.name}} <small v-if="plan.archived">보관됨</small></h2><button class="secondary" :disabled="busy" @click="start(plan)">일정 수정 · 납부 기록</button></div>
      <p v-if="plan.note" class="muted repayment-note">{{plan.note}}</p>
      <p><strong>{{summary.remaining===0n ? '등록된 예정액 납부 완료' : `남은 ${summary.remainingCount}회차`}}</strong> · 종료 예정 {{summary.end}}<span v-if="summary.remaining>0n"> · {{summary.end<now ? '예정일 지남' : summary.days+'일 남음'}}</span></p>
      <div class="progress"><span :style="{width:percent(summary.paid,summary.total)+'%'}"></span></div>
      <dl class="repayment-metrics">
        <div><dt>예정 총액</dt><dd>{{won(summary.total)}}원</dd></div><div><dt>실제 납부액</dt><dd>{{won(summary.paid)}}원</dd></div><div><dt>남은 예정액</dt><dd>{{won(summary.remaining)}}원</dd></div><div><dt>기한 지난 미납액</dt><dd :class="{danger:summary.overdue>0n}">{{won(summary.overdue)}}원</dd></div><div><dt>이번 달 예정액</dt><dd>{{won(summary.month)}}원</dd></div><div><dt>가장 이른 미완료 회차</dt><dd>{{summary.next||'모두 완료'}}</dd></div>
      </dl>
    </section>
  </template>
</template>
