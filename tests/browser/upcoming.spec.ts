import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { koreaToday } from '../../app/utils/fixed'
import type { RepaymentLink } from '../../app/utils/upcoming'
import type { Transaction } from '../../app/types/ledger'
import type { RepaymentPlan } from '../../app/types/repayment'
test('monthly obligations and atomic posting, existing linking, unlink and review UI', async ({
  page,
}) => {
  const h = randomUUID(),
    u = randomUUID(),
    r = randomUUID(),
    p = randomUUID(),
    bank = randomUUID(),
    expense = randomUUID(),
    now = koreaToday()
  const user = {
    id: u,
    email: 'posting@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  }
  const plans: RepaymentPlan[] = [
    {
      id: p,
      household_id: h,
      name: '본인',
      note: '',
      revision: 1,
      archived: false,
      rows: [{ id: r, due_date: now, amount: '1000', payments: [] }],
    },
    {
      id: randomUUID(),
      household_id: h,
      name: '배우자',
      note: '',
      revision: 1,
      archived: false,
      rows: [{ id: randomUUID(), due_date: now, amount: '2000', payments: [] }],
    },
  ]
  let links: RepaymentLink[] = [],
    transactions: Transaction[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('https://ledger-test.supabase.co/**', async (route) => {
    const path = new URL(route.request().url()).pathname,
      args = route.request().postDataJSON() ?? {}
    let result: unknown = []
    if (path === '/auth/v1/token')
      result = {
        access_token: 'test',
        refresh_token: 'test',
        token_type: 'bearer',
        expires_in: 3600,
        user,
      }
    else if (path === '/auth/v1/user') result = user
    else if (path === '/rest/v1/households') result = [{ id: h, name: '우리집', created_by: u }]
    else if (path.endsWith('/ledger_snapshot'))
      result = {
        accounts: [
          { id: bank, household_id: h, name: '은행', type: 'ASSET', is_archived: false },
          { id: expense, household_id: h, name: '변제금', type: 'EXPENSE', is_archived: false },
        ],
        transactions,
        budgets: [],
        members: [{ user_id: u, role: 'OWNER' }],
      }
    else if (path.endsWith('/get_repayment_plans')) result = plans
    else if (path.endsWith('/get_repayment_links')) result = links
    else if (path.endsWith('/fixed_expense_snapshot'))
      result = {
        templates: [
          {
            id: 'fixed',
            household_id: h,
            revision: 1,
            rules: [
              {
                effective_month: now.slice(0, 7) + '-01',
                title: '통신비',
                amount: '500',
                due_day: 25,
                expense_account: expense,
                payment_account: bank,
                end_month: null,
                active: true,
              },
            ],
          },
        ],
        records: [],
        linked_transactions: [],
      }
    else if (path.endsWith('/process_repayment_payment')) {
      const plan = plans.find((p) => p.id === args.p_plan)!,
        row = plan.rows.find((r) => r.id === args.p_row)!
      if (args.p_action === 'unlink') {
        row.payments = row.payments.filter((p) => p.id !== args.p_payment)
        links = links.filter((l) => l.payment_id !== args.p_payment)
      } else {
        let t = transactions.find((t) => t.id === args.p_transaction)
        if (args.p_action === 'pay') {
          t = {
            id: randomUUID(),
            household_id: h,
            transaction_date: args.p_date,
            description: '본인 변제금',
            memo: null,
            created_by: u,
            updated_at: new Date().toISOString(),
            is_opening: false,
            lines: [
              { account_id: expense, entry_type: 'DEBIT', amount: args.p_amount },
              { account_id: bank, entry_type: 'CREDIT', amount: args.p_amount },
            ],
          }
          transactions.push(t)
        }
        row.payments.push({
          id: args.p_payment,
          date: t!.transaction_date,
          amount: t!.lines[0]!.amount,
        })
        links.push({
          payment_id: args.p_payment,
          plan_id: plan.id,
          row_id: row.id,
          transaction_id: t!.id,
          snapshot: {
            date: t!.transaction_date,
            amount: t!.lines[0]!.amount,
            expense_account: expense,
            payment_account: bank,
          },
        })
      }
      plan.revision++
      result = null
    }
    await route.fulfill({ status: 200, json: result })
  })
  await page.goto('/login')
  await page.getByLabel('이메일', { exact: true }).fill(user.email)
  await page.getByLabel('비밀번호', { exact: true }).fill('password')
  await page.getByRole('button', { name: '로그인 →', exact: true }).click()
  const upcoming = page.getByRole('region', { name: '이번 달 남은 납부' })
  await expect(upcoming.locator(':scope > .money')).toContainText('3,500')
  await expect(upcoming).toContainText('배우자')
  await page.goto('/repayment')
  const plan = page.getByRole('region', { name: '본인 변제 계획' })
  await plan.locator('summary').click()
  await plan.getByLabel('납부할 회차').selectOption(r)
  await plan.getByLabel('변제금 지출 항목').selectOption(expense)
  await plan.getByLabel('출금 자산', { exact: true }).selectOption(bank)
  await plan.getByLabel('거래 납부금액', { exact: true }).fill('400')
  await plan.getByRole('button', { name: '납부와 거래 함께 저장' }).click()
  await expect(plan.locator('.payment-links')).toContainText('400')
  expect(transactions).toHaveLength(1)
  await plan.getByRole('button', { name: '연결 해제', exact: true }).click()
  await plan.getByRole('button', { name: '연결 해제 확인' }).click()
  await expect(plan.locator('.payment-links li')).toHaveCount(0)
  expect(transactions).toHaveLength(1)
  await plan.getByLabel('납부할 회차').selectOption(r)
  await plan.getByLabel('기록 방식').selectOption('link')
  await plan.getByLabel('연결할 거래').selectOption(transactions[0]!.id)
  await plan.getByRole('button', { name: '선택한 거래 연결' }).click()
  await expect(plan.locator('.payment-links li')).toHaveCount(1)
  expect(transactions).toHaveLength(1)
  transactions = []
  await page.reload()
  await expect(plan).toContainText('거래 확인 필요')
  await page.goto('/dashboard')
  await expect(upcoming).toContainText('1건 확인 필요')
  await expect(upcoming.locator(':scope > .money')).toContainText('3,100')
  await page.setViewportSize({ width: 320, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'docs/upcoming-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})
