import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { RepaymentPlan } from '../../app/types/repayment'
import { today } from '../../app/utils/accounting'
test('two variable plans, partial payment, conflict recovery, archive and mobile editing', async ({
  page,
}) => {
  const uid = randomUUID(),
    hid = randomUUID()
  const user = {
    id: uid,
    email: 'repayment@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  }
  let plans: RepaymentPlan[] = []
  let conflict = false
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
    else if (path === '/rest/v1/households') result = [{ id: hid, name: '우리집', created_by: uid }]
    else if (path.endsWith('/ledger_snapshot'))
      result = {
        accounts: [],
        transactions: [],
        budgets: [],
        members: [{ id: randomUUID(), user_id: uid, role: 'OWNER' }],
      }
    else if (path.endsWith('/get_repayment_plans')) result = plans
    else if (path.endsWith('/save_repayment_plan')) {
      if (conflict) {
        conflict = false
        await route.fulfill({
          status: 400,
          json: { message: '다른 곳에서 변경된 계획입니다. 새로고침 후 다시 입력하세요' },
        })
        return
      }
      const p: RepaymentPlan = {
        id: args.p_id,
        household_id: hid,
        name: args.p_name,
        note: args.p_note,
        rows: args.p_rows,
        archived: args.p_archived,
        revision: args.p_revision + 1,
      }
      plans = [...plans.filter((old) => old.id !== p.id), p]
      result = null
    }
    await route.fulfill({ status: 200, json: result })
  })
  await page.goto('/login')
  await page.getByLabel('이메일', { exact: true }).fill(user.email)
  await page.getByLabel('비밀번호', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '로그인 →', exact: true }).click()
  await page.getByRole('link', { name: '개인회생 일정' }).click()
  await expect(page.getByText('등록된 일정이 없어요.', { exact: false })).toBeVisible()
  const month = today().slice(0, 7)
  async function add(name: string, end: string, amount: string) {
    await page.getByRole('button', { name: '＋ 변제 일정 추가' }).click()
    await page.getByLabel('이름 또는 별칭').fill(name)
    await page.getByLabel('시작 월', { exact: true }).fill(month)
    await page.getByLabel('마지막 월', { exact: true }).fill(end)
    await page.getByLabel('기간 내 월 변제금', { exact: true }).fill(amount)
    await page.getByRole('button', { name: '기간 추가', exact: true }).click()
  }
  const y = Number(month.slice(0, 4)),
    m = Number(month.slice(5)),
    next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
  await add('본인', next, '500000')
  await page.getByLabel('2회차 예정금액', { exact: true }).fill('800000')
  await page.getByRole('button', { name: '기간 추가', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('이미 등록된 납부일')
  await page.getByLabel('1회차 예정금액', { exact: true }).fill('1.5')
  await page.getByRole('button', { name: '일정 저장', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('정수')
  await page.getByLabel('1회차 예정금액', { exact: true }).fill('500000')
  await page.getByRole('button', { name: '납부 기록 추가', exact: true }).first().click()
  await page.getByLabel('실제 납부금액', { exact: true }).fill('200000')
  await page.getByRole('button', { name: '납부 기록 반영' }).click()
  await page.getByRole('button', { name: '일정 저장', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('저장했어요')
  await expect(page.getByRole('region', { name: '본인 변제 계획' })).toContainText('1,100,000원')
  await add('배우자', month, '600000')
  await page.getByRole('button', { name: '일정 저장', exact: true }).click()
  await expect(page.getByRole('region', { name: '배우자 변제 계획' })).toBeVisible()
  await expect(page.getByLabel('변제 일정 합계')).toContainText('1,700,000')
  expect(plans[0]!.rows.at(-1)!.due_date).not.toBe(plans[1]!.rows.at(-1)!.due_date)
  await page.reload()
  await expect(page.getByRole('region', { name: '본인 변제 계획' })).toContainText('200,000원')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: 'docs/repayment-mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('region', { name: '본인 변제 계획' }).getByRole('button').click()
  await page.getByRole('button', { name: '납부 기록 삭제', exact: true }).click()
  await page.getByRole('button', { name: '삭제 확인', exact: true }).click()
  conflict = true
  await page.getByRole('button', { name: '일정 저장', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('다른 곳에서 변경')
  await expect(page.getByLabel('이름 또는 별칭')).toHaveValue('본인')
  await page.getByRole('button', { name: '편집 취소', exact: true }).click()
  await page.getByRole('button', { name: '변경 버리기', exact: true }).click()
  await page.getByRole('button', { name: '일정 새로고침' }).click()
  await expect(page.getByRole('region', { name: '본인 변제 계획' })).toContainText('200,000원')
  await page.getByRole('region', { name: '배우자 변제 계획' }).getByRole('button').click()
  await page.getByLabel('계획 보관 (합계에서 제외)', { exact: true }).check()
  await page.setViewportSize({ width: 320, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '일정 저장', exact: true }).click()
  await expect(page.getByRole('region', { name: '배우자 변제 계획' })).toHaveCount(0)
  await expect(page.getByLabel('변제 일정 합계')).toContainText('1,100,000')
  await page.getByLabel('보관한 계획 포함').check()
  await expect(page.getByRole('region', { name: '배우자 변제 계획' })).toContainText('보관됨')
  expect(errors).toEqual([])
})
