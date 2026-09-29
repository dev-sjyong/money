<script setup lang="ts">
import { accountLabels } from '~/types/ledger'
const { accounts, balances, label } = useAccounts()
const groups = ['ASSET', 'LIABILITY'] as const
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">지금 우리의 자리</span>
      <h1>자산·부채 보고서</h1>
      <p class="muted">보관된 계정을 포함한 전체 원장 잔액입니다.</p>
    </div>
  </div>
  <div class="settings-grid">
    <section v-for="type in groups" :key="type" class="panel">
      <div class="section-title">
        <h2>{{ accountLabels[type] }}</h2>
        <MoneyValue
          :value="
            accounts
              .filter((a) => a.type === type)
              .reduce((s, a) => s + (balances.get(a.id) || 0n), 0n)
          "
        />
      </div>
      <table>
        <thead>
          <tr>
            <th>계정</th>
            <th class="right">잔액</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in accounts.filter((a) => a.type === type)" :key="a.id">
            <td>{{ label(a.id) }} <small v-if="a.is_archived" class="muted">보관됨</small></td>
            <td class="right"><MoneyValue :value="balances.get(a.id) || 0n" /></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
