import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { koreaToday } from '../../app/utils/fixed'
import type { Transaction, Account } from '../../app/types/ledger'
test('favorite, remembered accounts, duplicate confirmation, saved filters and month reconciliation', async ({
  page,
}) => {
  const h = randomUUID(),
    other = randomUUID(),
    u = randomUUID(),
    bank = randomUUID(),
    expense = randomUUID(),
    equity = randomUUID(),
    now = koreaToday(),
    last = new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 2, 1))
      .toISOString()
      .slice(0, 7),
    day = last + '-10'
  const user = {
    id: u,
    email: 'workflow@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  }
  const accounts: Account[] = [
    { id: bank, name: '은행', type: 'ASSET' },
    { id: expense, name: '식비', type: 'EXPENSE' },
    { id: equity, name: '초기 자본', type: 'EQUITY' },
  ].map((a) => ({
    ...a,
    type: a.type as Account['type'],
    household_id: h,
    code: null,
    parent_account_id: null,
    is_system: false,
    is_archived: false,
  }))
  const transactions: Transaction[] = [
    {
      id: randomUUID(),
      household_id: h,
      transaction_date: last + '-01',
      description: '초기 잔액',
      memo: null,
      created_by: u,
      updated_at: '1',
      is_opening: true,
      lines: [
        { account_id: bank, entry_type: 'DEBIT', amount: '1000' },
        { account_id: equity, entry_type: 'CREDIT', amount: '1000' },
      ],
    },
    {
      id: randomUUID(),
      household_id: h,
      transaction_date: day,
      description: '점심 식사',
      memo: null,
      created_by: u,
      updated_at: '1',
      is_opening: false,
      lines: [
        { account_id: expense, entry_type: 'DEBIT', amount: '200' },
        { account_id: bank, entry_type: 'CREDIT', amount: '200' },
      ],
    },
  ]
  let saves = 0
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
    else if (path === '/rest/v1/households')
      result = [
        { id: h, name: '우리집', created_by: u },
        { id: other, name: '별도', created_by: u },
      ]
    else if (path.endsWith('/ledger_snapshot'))
      result = {
        accounts: args.p_household === h ? accounts : [],
        transactions: args.p_household === h ? transactions : [],
        budgets: [],
        members: [{ user_id: u, role: 'OWNER' }],
      }
    else if (path.endsWith('/fixed_expense_snapshot'))
      result = { templates: [], records: [], linked_transactions: [] }
    else if (path.endsWith('/create_transaction')) {
      saves++
      transactions.unshift({
        id: args.p_id,
        household_id: h,
        transaction_date: args.p_date,
        description: args.p_description,
        memo: args.p_memo,
        created_by: u,
        updated_at: 'saved',
        is_opening: false,
        lines: args.p_lines,
      })
      result = args.p_id
    }
    await route.fulfill({ status: 200, json: result })
  })
  await page.goto('/login')
  await page.getByLabel('이메일', { exact: true }).fill(user.email)
  await page.getByLabel('비밀번호', { exact: true }).fill('password')
  await page.getByRole('button', { name: '로그인 →', exact: true }).click()
  await page.goto('/transactions')
  await page.getByRole('button', { name: '전체 기간', exact: true }).click()
  await page.getByRole('button', { name: '점심 식사 즐겨찾기', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '점심 식사 즐겨찾기', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/transactions/new')
  await page.getByRole('link', { name: '점심 식사 · 입력', exact: true }).click()
  await expect(page.getByLabel('날짜', { exact: true })).toHaveValue(now)
  await expect(page.getByLabel('금액', { exact: true })).toHaveValue('200')
  await page.getByLabel('날짜', { exact: true }).fill(day)
  await page.getByLabel('사용처 / 설명').fill('점심 별도 기록')
  await page.getByRole('button', { name: '거래 저장 →', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('중복 기록')
  expect(saves).toBe(0)
  await page.getByRole('button', { name: '확인하고 별도 거래 저장' }).click()
  await expect(page).toHaveURL(/transactions$/)
  expect(saves).toBe(1)
  await page.goto('/transactions/new')
  await expect(page.getByRole('combobox', { name: '지출 항목', exact: true })).toHaveValue(expense)
  await expect(page.getByRole('combobox', { name: '결제 계정', exact: true })).toHaveValue(bank)
  await page.goto('/transactions')
  await page.locator('.filter-details summary').click()
  await page.getByRole('button', { name: '전체 기간', exact: true }).click()
  await page.getByLabel('최소 거래 금액').fill('200')
  await page.getByLabel('최대 거래 금액').fill('200')
  await page.getByLabel('기록한 사람').selectOption(u)
  await page.getByLabel('계정 · 하위 항목 포함').selectOption(expense)
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.getByLabel('조건 이름').fill('식비 200원')
  await page.getByRole('button', { name: '현재 조건 저장' }).click()
  await page.getByRole('button', { name: '검색 조건 초기화' }).click()
  await page.getByLabel('저장한 검색 조건').selectOption({ label: '식비 200원' })
  await expect(page.getByLabel('최소 거래 금액')).toHaveValue('200')
  await page.getByLabel('최소 거래 금액').fill('300')
  await expect(page.getByRole('alert')).toContainText('최소 금액')
  await page.getByLabel('최소 거래 금액').fill('200')
  await page.reload()
  await page.locator('.filter-details summary').click()
  await expect(page.getByLabel('저장한 검색 조건').locator('option')).toContainText([
    '조건 선택',
    '식비 200원',
  ])
  await page.setViewportSize({ width: 320, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'docs/workflow-search-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/reports/month-close')
  await page.getByLabel('월 마감 조회 월').fill(last)
  await expect(page.getByText('월 마감 자료를 불러오고 있어요…')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '2. 중복 후보 확인' })).toBeVisible()
  await page.getByLabel('은행 실제 잔액').fill('599')
  await page.getByLabel('중복 후보와 누락 여부를 확인했어요').check()
  await expect(page.getByRole('button', { name: '월 점검 완료 표시', exact: true })).toBeDisabled()
  await page.getByLabel('은행 실제 잔액').fill('600')
  await page.getByRole('button', { name: '월 점검 완료 표시', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '점검을 완료' })).toContainText(
    '점검을 완료',
  )
  await page.reload()
  await page.getByLabel('월 마감 조회 월').fill(last)
  await expect(page.getByRole('status').filter({ hasText: '점검을 완료' })).toContainText(
    '점검을 완료',
  )
  transactions[0]!.updated_at = 'corrected'
  await page.reload()
  await page.getByLabel('월 마감 조회 월').fill(last)
  await expect(page.getByRole('status').filter({ hasText: '다시 확인' })).toContainText('다시 확인')
  await page.setViewportSize({ width: 320, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'docs/month-close-mobile.png', fullPage: true })
  await page.getByLabel('함께 쓰는 가계부').selectOption(other)
  await page.goto('/transactions/new')
  await expect(page.getByRole('region', { name: '즐겨찾는 거래' })).toHaveCount(0)
  expect(errors).toEqual([])
})
