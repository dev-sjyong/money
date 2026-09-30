import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { FixedSnapshot, FixedRule } from '../../app/types/fixed'
import type { Account, Transaction } from '../../app/types/ledger'
import { fixedRows, koreaToday } from '../../app/utils/fixed'
test('fixed expense forecast, actual posting, linking, reset, skip, version changes and deletion review', async ({
  page,
}) => {
  const uid = randomUUID(),
    hid = randomUUID(),
    other = randomUUID(),
    now = koreaToday(),
    month = now.slice(0, 7)
  const user = {
    id: uid,
    email: 'fixed@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  }
  const accounts: Account[] = [
    {
      id: 'expense',
      name: '통신비',
      type: 'EXPENSE',
      household_id: hid,
      code: null,
      parent_account_id: null,
      is_system: false,
      is_archived: false,
    },
    {
      id: 'bank',
      name: '은행',
      type: 'ASSET',
      household_id: hid,
      code: null,
      parent_account_id: null,
      is_system: false,
      is_archived: false,
    },
  ]
  const state: FixedSnapshot = { templates: [], records: [], linked_transactions: [] }
  let transactions: Transaction[] = [],
    payCount = 0,
    fail = false
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('https://ledger-test.supabase.co/**', async (route) => {
    const path = new URL(route.request().url()).pathname,
      args = route.request().postDataJSON() ?? {}
    let result: unknown = []
    if (path === '/auth/v1/token')
      result = {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        user,
      }
    else if (path === '/auth/v1/user') result = user
    else if (path === '/rest/v1/households')
      result = [
        { id: hid, name: '우리집', created_by: uid },
        { id: other, name: '다른 가계부', created_by: uid },
      ]
    else if (path.endsWith('/ledger_snapshot'))
      result = {
        accounts: args.p_household === hid ? accounts : [],
        transactions: args.p_household === hid ? transactions : [],
        budgets: [],
        members: [{ id: randomUUID(), user_id: uid, role: 'OWNER' }],
      }
    else if (path.endsWith('/fixed_expense_snapshot'))
      result =
        args.p_household === hid ? state : { templates: [], records: [], linked_transactions: [] }
    else if (path.endsWith('/save_fixed_expense')) {
      const rule: FixedRule = {
        effective_month: args.p_effective_month,
        title: args.p_title,
        amount: args.p_amount,
        due_day: args.p_due_day,
        expense_account: args.p_expense_account,
        payment_account: args.p_payment_account,
        end_month: args.p_end_month,
        active: args.p_active,
      }
      let t = state.templates.find((t) => t.id === args.p_id)
      if (!t) {
        t = { id: args.p_id, household_id: hid, revision: 0, rules: [] }
        state.templates.push(t)
      }
      t.rules = [...t.rules.filter((r) => r.effective_month !== rule.effective_month), rule].sort(
        (a, b) => a.effective_month.localeCompare(b.effective_month),
      )
      t.revision++
      result = null
    } else if (path.endsWith('/process_fixed_expense')) {
      if (fail) {
        fail = false
        await route.fulfill({
          status: 400,
          json: { message: '이미 처리되었거나 다른 곳에서 변경되었습니다. 새로고침하세요' },
        })
        return
      }
      const row = fixedRows(state, args.p_month.slice(0, 7), transactions, now).find(
        (r) => r.template.id === args.p_id,
      )!
      let record = state.records.find((r) => r.fixed_id === args.p_id && r.month === args.p_month)
      if (!record) {
        record = {
          fixed_id: args.p_id,
          household_id: hid,
          month: args.p_month,
          snapshot: row.expected,
          transaction_id: null,
          skipped: false,
          revision: 0,
        }
        state.records.push(record)
      }
      if (args.p_action === 'pay') {
        payCount++
        const id = randomUUID()
        transactions.push({
          id,
          household_id: hid,
          transaction_date: args.p_date,
          description: row.expected.title,
          memo: null,
          created_by: uid,
          updated_at: '',
          is_opening: false,
          lines: [
            {
              account_id: row.expected.expense_account,
              entry_type: 'DEBIT',
              amount: args.p_amount,
            },
            {
              account_id: row.expected.payment_account,
              entry_type: 'CREDIT',
              amount: args.p_amount,
            },
          ],
        })
        record.transaction_id = id
      } else {
        record.transaction_id = args.p_action === 'link' ? args.p_transaction : null
      }
      record.skipped = args.p_action === 'skip'
      record.revision++
      state.linked_transactions = state.records.flatMap((r) =>
        r.transaction_id ? [r.transaction_id] : [],
      )
      result = record.transaction_id
    }
    await route.fulfill({ status: 200, json: result })
  })
  await page.goto('/login')
  await page.getByLabel('이메일', { exact: true }).fill(user.email)
  await page.getByLabel('비밀번호', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '로그인 →', exact: true }).click()
  await page.getByRole('link', { name: '고정지출', exact: true }).click()
  await page.getByRole('button', { name: '＋ 고정지출 추가' }).click()
  await page.getByLabel('항목 이름', { exact: true }).fill('휴대폰 요금')
  await page.getByLabel('고정지출 예상 금액', { exact: true }).fill('50000')
  await page.getByLabel('매월 납부일').fill('31')
  await page.getByRole('combobox', { name: '지출 항목', exact: true }).selectOption('expense')
  await page.getByRole('combobox', { name: '결제 계정', exact: true }).selectOption('bank')
  await page.getByRole('button', { name: '항목 저장', exact: true }).click()
  const card = page.getByRole('region', { name: '휴대폰 요금 고정지출' })
  await expect(card).toContainText('50,000')
  expect(transactions).toHaveLength(0)
  await card.getByRole('button', { name: '납부 확인', exact: true }).click()
  await page.getByLabel('고정지출 실제 납부금액').fill('49000')
  await page.getByRole('button', { name: '확인하고 저장', exact: true }).click()
  await expect(card).toContainText('납부 완료')
  await expect(card).toContainText('49,000')
  expect(payCount).toBe(1)
  expect(transactions).toHaveLength(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'docs/fixed-mobile.png', fullPage: true, animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await card.getByRole('button', { name: '처리 취소', exact: true }).click()
  await page.getByRole('button', { name: '확인하고 저장', exact: true }).click()
  expect(transactions).toHaveLength(1)
  await card.getByRole('button', { name: '기존 거래 연결', exact: true }).click()
  await page
    .getByRole('combobox', { name: '연결할 거래', exact: true })
    .selectOption(transactions[0]!.id)
  await page.getByRole('button', { name: '확인하고 저장', exact: true }).click()
  await expect(card).toContainText('납부 완료')
  expect(payCount).toBe(1)
  const original = transactions[0]!
  transactions = []
  await page.getByRole('button', { name: '고정지출 새로고침' }).click()
  await expect(card).toContainText('거래 확인 필요')
  await expect(card.getByRole('button', { name: '납부 확인', exact: true })).toHaveCount(0)
  transactions = [original]
  await page.getByRole('button', { name: '고정지출 새로고침' }).click()
  await expect(card).toContainText('납부 완료')
  await page.getByRole('button', { name: '규칙 수정', exact: true }).click()
  const [y, m] = month.split('-').map(Number),
    next = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 7)
  await page.getByLabel('적용 시작 월').fill(next)
  await page.getByLabel('고정지출 예상 금액').fill('60000')
  await page.getByRole('button', { name: '항목 저장', exact: true }).click()
  await expect(card).toContainText('50,000')
  await page.getByLabel('고정지출 조회 월').fill(next)
  await expect(card).toContainText('60,000')
  await card.getByRole('button', { name: '이번 달 건너뛰기', exact: true }).click()
  fail = true
  await page.getByRole('button', { name: '확인하고 저장', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('이미 처리')
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await page.getByRole('button', { name: '고정지출 새로고침' }).click()
  await card.getByRole('button', { name: '이번 달 건너뛰기', exact: true }).click()
  await page.getByRole('button', { name: '확인하고 저장', exact: true }).click()
  await expect(card).toContainText('이번 달 건너뜀')
  expect(transactions).toHaveLength(1)
  await page.reload()
  await page.getByLabel('고정지출 조회 월').fill(next)
  await expect(card).toContainText('이번 달 건너뜀')
  await page.getByRole('button', { name: '규칙 수정', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '편집 취소' }).click()
  await page.getByRole('button', { name: '＋ 고정지출 추가' }).click()
  await page.getByLabel('항목 이름', { exact: true }).fill('다음달 보험')
  await page.getByLabel('고정지출 예상 금액', { exact: true }).fill('1000')
  await page.getByRole('combobox', { name: '지출 항목', exact: true }).selectOption('expense')
  await page.getByRole('combobox', { name: '결제 계정', exact: true }).selectOption('bank')
  await page.getByRole('button', { name: '항목 저장', exact: true }).click()
  await page.getByLabel('고정지출 조회 월').fill(month)
  await page
    .locator('.fixed-management')
    .filter({ hasText: '다음달 보험' })
    .getByRole('button', { name: '규칙 수정' })
    .click()
  await expect(page.getByLabel('적용 시작 월')).toHaveValue(next)
  await page.getByRole('button', { name: '편집 취소' }).click()
  await page.getByLabel('함께 쓰는 가계부').selectOption(other)
  await expect(card).toHaveCount(0)
  expect(errors).toEqual([])
})
