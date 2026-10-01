import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Account, Transaction, Line } from '../../app/types/ledger'
test('analytics comparisons, split-category drilldown, CSV, asset dates, trends and household isolation', async ({
  page,
}) => {
  const uid = randomUUID(),
    hid = randomUUID(),
    other = randomUUID()
  const user = {
    id: uid,
    email: 'stats@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  }
  const account = (
    id: string,
    name: string,
    type: Account['type'],
    parent: string | null = null,
  ): Account => ({
    id,
    name,
    type,
    parent_account_id: parent,
    household_id: hid,
    code: null,
    is_system: false,
    is_archived: false,
  })
  const accounts = [
    account('bank', '은행', 'ASSET'),
    account('saving', '저축', 'ASSET'),
    account('card', '카드', 'LIABILITY'),
    account('equity', '기초순자산', 'EQUITY'),
    account('salary', '급여', 'INCOME'),
    account('food', '식비', 'EXPENSE'),
    account('dining', '외식', 'EXPENSE', 'food'),
    account('transport', '교통', 'EXPENSE'),
  ]
  const pair = (debit: string, credit: string, amount: string): Line[] => [
    { account_id: debit, entry_type: 'DEBIT', amount },
    { account_id: credit, entry_type: 'CREDIT', amount },
  ]
  const tx = (date: string, description: string, lines: Line[]): Transaction => ({
    id: randomUUID(),
    household_id: hid,
    transaction_date: date,
    description,
    memo: '검증 메모',
    is_opening: false,
    created_by: uid,
    updated_at: '',
    lines,
  })
  const transactions = [
    tx('2026-08-01', '시작 잔액', pair('bank', 'equity', '1000000')),
    tx('2026-08-25', '지난달 장보기', pair('food', 'bank', '100000')),
    tx('2026-09-01', '9월 급여', pair('bank', 'salary', '3000000')),
    tx('2026-09-02', '외식 카드 결제', pair('dining', 'card', '300000')),
    tx('2026-09-03', '외식 환불', pair('bank', 'dining', '50000')),
    tx('2026-09-04', '저축 이체', pair('saving', 'bank', '100000')),
    tx('2026-09-05', '카드 상환', pair('card', 'bank', '100000')),
    tx('2026-09-06', '=분할 지출', [
      { account_id: 'food', entry_type: 'DEBIT', amount: '100000' },
      { account_id: 'transport', entry_type: 'DEBIT', amount: '200000' },
      { account_id: 'bank', entry_type: 'CREDIT', amount: '300000' },
    ]),
    tx('2026-10-01', '다음달 지출', pair('food', 'bank', '999000')),
  ]
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
        { id: other, name: '별도 가계부', created_by: uid },
      ]
    else if (path.endsWith('/fixed_expense_snapshot'))
      result = { templates: [], records: [], linked_transactions: [] }
    else if (path.endsWith('/ledger_snapshot'))
      result = {
        accounts: args.p_household === hid ? accounts : [],
        transactions: args.p_household === hid ? transactions : [],
        budgets: [],
        members: [{ id: randomUUID(), user_id: uid, role: 'OWNER' }],
      }
    await route.fulfill({ status: 200, json: result })
  })
  await page.goto('/login')
  await page.getByLabel('이메일', { exact: true }).fill(user.email)
  await page.getByLabel('비밀번호', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '로그인 →', exact: true }).click()
  await page.getByRole('link', { name: '통계 한눈에', exact: true }).click()
  await page.getByLabel('통계 기준 월').fill('2026-09')
  await expect(page.getByLabel('통계 요약')).toContainText('550,000')
  await expect(page.getByLabel('통계 요약')).toContainText('3,350,000')
  await page.screenshot({ path: 'docs/analytics-desktop.png', animations: 'disabled' })
  await page.getByRole('button', { name: '식비', exact: true }).click()
  const detail = page.getByRole('region', { name: '통계 거래 상세' })
  await expect(detail).toContainText('3건')
  await expect(detail).toContainText('100,000')
  await expect(detail).not.toContainText('200,000')
  await expect(detail.getByRole('link', { name: '저축 이체' })).toHaveCount(0)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSV 내보내기', exact: true }).click()
  const download = await downloadPromise
  const csv = await readFile((await download.path())!, 'utf8')
  expect(csv).toContain('550000')
  expect(csv).toContain("'=분할 지출")
  expect(csv).not.toContain('저축 이체')
  await page.getByLabel('항목 구분').selectOption('account')
  await page.getByRole('button', { name: '식비 › 외식', exact: true }).click()
  await expect(detail).toContainText('2건')
  await page.getByRole('combobox', { name: '조회 기간', exact: true }).selectOption('3')
  await expect(page.getByText('2026-07-01 ~ 2026-09-30', { exact: false })).toBeVisible()
  await page.getByRole('combobox', { name: '조회 기간', exact: true }).selectOption('custom')
  await page.getByLabel('시작일', { exact: true }).fill('2026-09-03')
  await page.getByLabel('종료일', { exact: true }).fill('2026-09-06')
  await expect(page.getByLabel('통계 요약')).toContainText('250,000')
  await page.getByLabel('종료일', { exact: true }).fill('2026-08-01')
  await expect(page.getByRole('alert')).toContainText('종료일')
  await expect(page.getByRole('button', { name: 'CSV 내보내기', exact: true })).toBeDisabled()
  await page.getByRole('combobox', { name: '조회 기간', exact: true }).selectOption('1')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: 'docs/analytics-mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('link', { name: '자산·부채 상세 →', exact: true }).click()
  await page.getByLabel('자산 기준일').fill('2026-09-02')
  await expect(page.locator('.analytics-kpis')).toContainText('3,600,000')
  await expect(page.locator('.analytics-kpis')).toContainText('300,000')
  await page.getByLabel('자산 기준일').fill('2026-08-31')
  await expect(page.locator('.analytics-kpis')).toContainText('900,000')
  await page.goto('/reports/net-worth')
  await page.getByLabel('순자산 기준 월').fill('2026-09')
  await page.getByLabel('추이 기간').selectOption('24')
  await expect(page.locator('.chart-row')).toHaveCount(24)
  await page.getByLabel('차트 지표').selectOption('liabilities')
  await expect(page.getByRole('group', { name: '24개월 월말 부채' })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (let i = 0; i < 25; i++)
    transactions.push(tx('2026-09-08', `추가 거래 ${i}`, pair('transport', 'bank', '1')))
  await page.goto('/reports')
  await page.getByLabel('통계 기준 월').fill('2026-09')
  await expect(page.getByRole('region', { name: '통계 거래 상세' })).toContainText('29건')
  await page
    .getByRole('region', { name: '통계 거래 상세' })
    .getByRole('button', { name: '다음', exact: true })
    .click()
  await expect(page.getByRole('region', { name: '통계 거래 상세' })).toContainText('2 / 2')
  await page.getByRole('button', { name: '식비', exact: true }).click()
  await expect(page.getByRole('region', { name: '통계 거래 상세' })).toContainText('1 / 1')
  await page.getByLabel('함께 쓰는 가계부').selectOption(other)
  await expect(page.getByRole('button', { name: '식비', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '통계 거래 상세' })).toContainText('0건')
  await expect(page.getByLabel('통계 요약')).not.toContainText('550,000')
  expect(errors).toEqual([])
})
