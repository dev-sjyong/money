<script setup lang="ts">
import type { Transaction } from '~/types/ledger'
import { won } from '~/utils/accounting'
defineProps<{ items: Transaction[]; emptyText?: string }>()
const { label } = useAccounts()
const { preferences, toggleFavorite } = useWorkflowPreferences()
</script>
<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>날짜</th>
          <th>거래 내역</th>
          <th>계정</th>
          <th class="right">거래 금액</th>
          <th><span class="sr-only">거래 작업</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in items" :key="t.id">
          <td class="muted nowrap">{{ t.transaction_date }}</td>
          <td>
            <NuxtLink :to="`/transactions/${t.id}`" class="table-title">{{
              t.description
            }}</NuxtLink
            ><small v-if="t.memo" class="block muted">{{ t.memo }}</small>
          </td>
          <td class="muted">
            <span>{{
              t.lines
                .filter((l) => l.entry_type === 'DEBIT')
                .map((l) => label(l.account_id))
                .join(', ')
            }}</span>
          </td>
          <td class="right money nowrap">
            {{
              won(
                t.lines
                  .filter((l) => l.entry_type === 'DEBIT')
                  .reduce((s, l) => s + BigInt(l.amount), 0n),
              )
            }}<small> 원</small>
          </td>
          <td class="transaction-row-actions">
            <button
              v-if="!t.is_opening"
              class="text-button"
              :aria-label="t.description + ' 즐겨찾기'"
              :aria-pressed="preferences.favorites.some((f) => f.id === t.id)"
              @click="toggleFavorite(t)"
            >
              {{ preferences.favorites.some((f) => f.id === t.id) ? '★' : '☆' }}
            </button>
            <NuxtLink
              v-if="!t.is_opening"
              :to="`/transactions/new?copy=${t.id}`"
              class="text-button"
              :aria-label="t.description + ' 복사'"
              >복사</NuxtLink
            >
            <NuxtLink :to="`/transactions/${t.id}`" :aria-label="t.description + ' 상세'"
              >↗</NuxtLink
            >
          </td>
        </tr>
        <tr v-if="!items.length">
          <td colspan="5" class="empty-text">
            {{ emptyText || '아직 거래가 없어요. 첫 기록을 남겨 보세요.' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
