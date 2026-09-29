<script setup lang="ts">
import type { HistorySnapshot } from '~/types/ledger'
defineProps<{ snapshot: HistorySnapshot }>()
const { label } = useAccounts()
</script>
<template>
  <div class="history-snapshot">
    <p>
      <strong>{{ snapshot.description }}</strong
      ><span class="block muted">{{ snapshot.transaction_date }}</span>
    </p>
    <p v-if="snapshot.memo" class="history-memo">{{ snapshot.memo }}</p>
    <ul class="snapshot-lines">
      <li v-for="(line, i) in snapshot.lines" :key="i">
        <span
          >{{ line.account_name || label(line.account_id)
          }}<small class="block muted"
            >{{ line.entry_type === 'DEBIT' ? '차변' : '대변'
            }}<span v-if="line.memo"> · {{ line.memo }}</span></small
          ></span
        >
        <MoneyValue :value="line.amount" />
      </li>
    </ul>
  </div>
</template>
