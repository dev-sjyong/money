import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type {
  Account,
  Household,
  Snapshot,
  Transaction,
  TransactionHistory,
  TrashTransaction,
  HistorySnapshot,
} from '../../app/types/ledger'
import { today, validateLines } from '../../app/utils/accounting'
// Browser tests isolate UI behavior with an HTTP Supabase contract fixture.
// Database guarantees are independently exercised against real PostgreSQL.
test('complete household journey, accounting inputs, reports, persistence reload and responsive UI', async ({
  page,
}) => {
  const uid = randomUUID(),
    hid = randomUUID()
  const user = {
    id: uid,
    email: 'owner@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  }
  let households: Household[] = []
  let state: Snapshot = { accounts: [], transactions: [], budgets: [], members: [] }
  const history: TransactionHistory[] = []
  let trash: TrashTransaction[] = []
  function snapshot(t: Transaction): HistorySnapshot {
    return {
      ...structuredClone(t),
      created_at: t.updated_at,
      lines: t.lines.map((l) => ({
        ...l,
        account_name: state.accounts.find((a) => a.id === l.account_id)?.name,
      })),
    }
  }
  function audit(
    action: TransactionHistory['action'],
    before: HistorySnapshot | null,
    after: HistorySnapshot | null,
  ) {
    history.unshift({
      id: String(history.length + 1),
      household_id: hid,
      transaction_id: (after ?? before)!.id,
      action,
      actor_id: uid,
      before_snapshot: before,
      after_snapshot: after,
      created_at: new Date().toISOString(),
    })
  }
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  function make(name: string, type: Account['type'], parent: string | null = null): Account {
    return {
      id: randomUUID(),
      household_id: hid,
      name,
      type,
      parent_account_id: parent,
      code: null,
      is_system: type === 'EQUITY',
      is_archived: false,
    }
  }
  function seed() {
    state.accounts = [
      make('현금', 'ASSET'),
      make('국민은행', 'ASSET'),
      make('적금', 'ASSET'),
      make('신한카드', 'LIABILITY'),
      make('대출', 'LIABILITY'),
      make('급여', 'INCOME'),
      make('기초순자산', 'EQUITY'),
      make('식비', 'EXPENSE'),
    ]
    state.accounts.push(make('외식', 'EXPENSE', state.accounts.find((a) => a.name === '식비')!.id))
    state.members = [{ id: randomUUID(), user_id: uid, role: 'OWNER' }]
  }
  await page.route('https://ledger-test.supabase.co/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      args = request.postDataJSON() ?? {}
    let result: unknown = null
    if (url.pathname === '/auth/v1/token')
      result = {
        access_token: 'test-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'test-refresh',
        user,
      }
    else if (url.pathname === '/auth/v1/user') result = user
    else if (url.pathname === '/auth/v1/logout') result = {}
    else if (url.pathname === '/rest/v1/households') result = households
    else if (url.pathname.includes('/rpc/')) {
      const name = url.pathname.split('/').pop()!
      calls.push({ name, args })
      if (name === 'get_transaction_history')
        result = history.filter((h) => h.transaction_id === args.p_transaction)
      else if (name === 'get_transaction_trash') result = trash
      else if (name === 'restore_transaction') {
        const item = trash.find((t) => t.transaction_id === args.p_id)!
        const restored = { ...structuredClone(item.snapshot), updated_at: new Date().toISOString() }
        state.transactions.unshift(restored)
        audit('RESTORE', item.snapshot, snapshot(restored))
        trash = trash.filter((t) => t.transaction_id !== args.p_id)
        result = args.p_id
      } else if (name === 'ledger_snapshot') result = state
      else if (name === 'create_household') {
        households = [{ id: hid, name: args.p_name, created_by: uid }]
        seed()
        result = hid
      } else if (name === 'save_account') {
        if (args.p_id) {
          const a = state.accounts.find((a) => a.id === args.p_id)!
          Object.assign(a, {
            name: args.p_name,
            parent_account_id: args.p_parent,
            is_archived: args.p_archived,
            code: args.p_code,
          })
        } else state.accounts.push(make(args.p_name, args.p_type, args.p_parent))
        result = state.accounts.at(-1)?.id
      } else if (name === 'create_opening') {
        const lines = args.p_balances.map((b: { account_id: string; amount: string }) => ({
          ...b,
          entry_type:
            state.accounts.find((a) => a.id === b.account_id)?.type === 'ASSET'
              ? 'DEBIT'
              : 'CREDIT',
        }))
        const delta = lines.reduce(
          (s: bigint, l: { amount: string; entry_type: string }) =>
            s + BigInt(l.amount) * (l.entry_type === 'DEBIT' ? 1n : -1n),
          0n,
        )
        if (delta)
          lines.push({
            account_id: state.accounts.find((a) => a.type === 'EQUITY')!.id,
            entry_type: delta > 0n ? 'CREDIT' : 'DEBIT',
            amount: String(delta < 0n ? -delta : delta),
          })
        validateLines(lines)
        const t: Transaction = {
          id: randomUUID(),
          household_id: hid,
          transaction_date: args.p_date,
          description: '초기 자산 및 부채',
          memo: null,
          created_by: uid,
          updated_at: new Date().toISOString(),
          is_opening: true,
          lines,
        }
        state.transactions.unshift(t)
        audit('CREATE', null, snapshot(t))
        result = t.id
      } else if (name === 'create_transaction') {
        validateLines(args.p_lines)
        state.transactions.unshift({
          id: args.p_id,
          household_id: hid,
          transaction_date: args.p_date,
          description: args.p_description,
          memo: args.p_memo,
          created_by: uid,
          updated_at: new Date().toISOString(),
          is_opening: false,
          lines: args.p_lines,
        })
        audit('CREATE', null, snapshot(state.transactions[0]!))
        result = args.p_id
      } else if (name === 'update_transaction') {
        const before = snapshot(state.transactions.find((t) => t.id === args.p_id)!)
        validateLines(args.p_lines)
        Object.assign(
          state.transactions.find((t) => t.id === args.p_id)!,
          {
            transaction_date: args.p_date,
            description: args.p_description,
            memo: args.p_memo,
            lines: args.p_lines,
            updated_at: new Date().toISOString(),
          },
        )
        audit('UPDATE', before, snapshot(state.transactions.find((t) => t.id === args.p_id)!))
      } else if (name === 'delete_transaction') {
        const before = snapshot(state.transactions.find((t) => t.id === args.p_id)!)
        trash.unshift({
          transaction_id: args.p_id,
          household_id: hid,
          snapshot: before,
          deleted_by: uid,
          deleted_at: new Date().toISOString(),
        })
        audit('DELETE', before, null)
        state.transactions = state.transactions.filter((t) => t.id !== args.p_id)
      } else if (name === 'save_budget') {
        state.budgets = state.budgets.filter((b) => b.account_id !== args.p_account)
        state.budgets.push({
          id: randomUUID(),
          account_id: args.p_account,
          year: args.p_year,
          month: args.p_month,
          amount: args.p_amount,
        })
      } else if (name === 'delete_budget')
        state.budgets = state.budgets.filter((b) => b.id !== args.p_id)
      else if (name === 'create_invite') result = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      else {
        await route.fulfill({ status: 400, json: { message: 'Unhandled mock RPC: ' + name } })
        return
      }
    }
    await route.fulfill({ status: 200, json: result })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '다시 만나 반가워요.' })).toBeVisible()
  await page.getByLabel('이메일', { exact: true }).fill('owner@example.test')
  await page.getByLabel('비밀번호', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '로그인 →', exact: true }).click()
  await page.getByRole('link', { name: '가계부 만들기 →' }).click()
  await page.getByLabel('가계부 이름', { exact: true }).fill('우리집 가계부')
  await page.getByRole('button', { name: '가계부 만들기 →' }).click()
  await expect(page.getByText('저장했어요.', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: /초기 자산·부채 등록/ }).click()
  await page.getByLabel('국민은행 자산').fill('4000000')
  await page.getByLabel('적금 자산').fill('10000000')
  await page.getByLabel('신한카드 부채').fill('500000')
  await expect(page.getByText('13,500,000원', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '초기 자산 등록', exact: true }).click()
  await expect(page.getByText('시작 잔액이 등록되어 있어요.')).toBeVisible()
  const aid = (name: string) => state.accounts.find((a) => a.name === name)!.id
  async function record(
    kind: string,
    description: string,
    value: string,
    debitLabel: string,
    debitName: string,
    creditLabel: string,
    creditName: string,
  ) {
    await page.goto('/transactions/new')
    await page.getByRole('button', { name: kind, exact: true }).click()
    await page.getByLabel('사용처 / 설명').fill(description)
    await page.locator('.amount-input input').fill(value)
    await page.getByRole('combobox', { name: debitLabel, exact: true }).selectOption(aid(debitName))
    await page
      .getByRole('combobox', { name: creditLabel, exact: true })
      .selectOption(aid(creditName))
    await page.getByRole('button', { name: '거래 저장 →' }).click()
    await expect(page.getByRole('link', { name: description, exact: true })).toBeVisible()
  }
  await record('수입', '10월 급여', '4000000', '입금 계정', '국민은행', '수입 항목', '급여')
  await record('지출', '함께 먹은 저녁', '50000', '지출 항목', '외식', '결제 계정', '신한카드')
  await record('계좌이체', '차곡차곡 적금', '1000000', '입금 계정', '적금', '출금 계정', '국민은행')
  await record(
    '카드대금',
    '이번 달 카드대금',
    '500000',
    '카드 계정',
    '신한카드',
    '출금 계정',
    '국민은행',
  )
  await record('지출', '시장 장보기', '20000', '지출 항목', '식비', '결제 계정', '현금')
  await page.goto('/dashboard')
  await expect(page.locator('.net-worth>.money')).toContainText('17,430,000')
  await expect(page.locator('.month-flow')).toContainText('70,000')
  await page.reload()
  await expect(page.locator('.net-worth>.money')).toContainText('17,430,000')
  await page.goto('/budgets')
  await page.getByLabel('예산 월').fill('')
  await expect(page.getByLabel('예산 월')).toHaveValue(today().slice(0, 7))
  await page.getByRole('combobox', { name: '지출 항목', exact: true }).selectOption(aid('식비'))
  await page.getByLabel('월 예산 (원)').fill('600000')
  await page.getByRole('button', { name: '예산 저장' }).click()
  await expect(page.locator('.budget-row')).toContainText('70,000')
  await expect(page.locator('.budget-row')).toContainText('530,000')
  await page.goto('/dashboard')
  await expect(page.locator('.net-worth > .money')).toContainText('17,430,000')
  await expect(page.locator('.loading-bar')).toHaveCount(0)
  await expect(page.locator('.budget-card')).toContainText('530,000')
  await page.screenshot({
    path: 'test-results/dashboard-desktop.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const quickNav = page.getByRole('navigation', { name: '빠른 이동' })
  await expect(quickNav).toBeVisible()
  await expect(quickNav.getByRole('link', { name: '한눈에 보기' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await quickNav.getByRole('button', { name: '전체 메뉴' }).click()
  await expect(page.getByRole('navigation', { name: '전체 화면' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(quickNav.getByRole('button', { name: '전체 메뉴' })).toBeFocused()
  await quickNav.getByRole('button', { name: '전체 메뉴' }).click()
  await page
    .getByRole('navigation', { name: '전체 화면' })
    .getByRole('link', { name: '월 예산', exact: true })
    .click()
  await expect(page).toHaveURL(/budgets/)
  await expect(page.getByRole('navigation', { name: '전체 화면' })).toHaveCount(0)
  await quickNav.getByRole('link', { name: '한눈에 보기' }).click()
  await page.screenshot({
    path: 'test-results/dashboard-mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const path of ['/reports/income-expense', '/reports/assets', '/reports/net-worth']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await page.locator('main').innerText()).not.toContain('NaN')
  }
  await page.goto('/transactions')
  await page.getByRole('link', { name: '시장 장보기', exact: true }).click()
  await page.getByLabel('사용처 / 설명').fill('시장 장보기 수정')
  await page.getByRole('button', { name: '수정 저장 →' }).click()
  await expect(page.getByRole('link', { name: '시장 장보기 수정', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '시장 장보기 수정', exact: true }).click()
  await expect(page.getByRole('region', { name: '거래 변경 이력' })).toContainText('거래 수정')
  await page.locator('.history-list summary').filter({ hasText: '거래 수정' }).click()
  await expect(page.locator('.history-list details[open] .history-comparison')).toContainText(
    '시장 장보기 수정',
  )
  await page.getByRole('button', { name: '거래 삭제', exact: true }).click()
  await page.getByRole('button', { name: '삭제 확인' }).click()
  await expect(page.getByRole('link', { name: '시장 장보기 수정', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: '휴지통', exact: true }).click()
  await expect(page.locator('.trash-item')).toContainText('시장 장보기 수정')
  await page.getByRole('button', { name: '복구', exact: true }).click()
  await page.getByRole('button', { name: '복구 확인', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('거래를 복구했어요')
  await expect(page.locator('.trash-item')).toHaveCount(0)
  await page.goto('/transactions')
  await page.getByRole('link', { name: '시장 장보기 수정', exact: true }).click()
  await expect(page.getByRole('region', { name: '거래 변경 이력' })).toContainText('거래 복구')
  const original = state.transactions.find((t) => t.description === '함께 먹은 저녁')!
  original.transaction_date = '2020-01-01'
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/transactions/new?copy=${original.id}`)
  await expect(page.getByLabel('사용처 / 설명')).toHaveValue('함께 먹은 저녁')
  await expect(page.getByLabel('날짜', { exact: true })).toHaveValue(today())
  await expect(page.getByLabel('금액', { exact: true })).toHaveValue('50,000')
  await page.getByRole('button', { name: '＋1천', exact: true }).click()
  await expect(page.getByLabel('금액', { exact: true })).toHaveValue('51,000')
  await page.getByLabel('사용처 / 설명').fill('저녁 복사')
  await page.screenshot({ path: 'docs/mobile-copy.png', fullPage: true, animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  expect(await page.getByLabel('금액', { exact: true }).getAttribute('inputmode')).toBe('numeric')
  await page.getByRole('button', { name: '거래 저장 →' }).click()
  await expect(page.getByRole('link', { name: '저녁 복사', exact: true })).toBeVisible()
  const copied = state.transactions.find((t) => t.description === '저녁 복사')!
  expect(copied.id).not.toBe(original.id)
  expect(original.lines[0]!.amount).toBe('50000')
  expect(copied.lines[0]!.amount).toBe('51000')
  await page.goto('/transactions/new')
  await expect(page.getByRole('region', { name: '최근 거래 복사' })).toContainText('저녁 복사')
  await page.getByRole('button', { name: '직접분개', exact: true }).click()
  await page.getByLabel('사용처 / 설명').fill('직접분개 확인')
  await page.getByLabel('분개 1 계정', { exact: true }).selectOption(aid('식비'))
  await page.getByLabel('분개 2 계정', { exact: true }).selectOption(aid('현금'))
  await page.getByLabel('분개 1 금액', { exact: true }).fill('1000')
  await page.getByLabel('분개 1 메모', { exact: true }).fill('복사해도 남을 메모')
  await page.getByLabel('분개 2 금액', { exact: true }).fill('500')
  await page.getByRole('button', { name: '거래 저장 →' }).click()
  await expect(page.getByRole('alert')).toContainText('차변과 대변')
  await page.getByRole('button', { name: '＋ 분개 추가' }).click()
  await page.getByLabel('분개 3 계정', { exact: true }).selectOption(aid('현금'))
  await page.getByLabel('분개 3 유형', { exact: true }).selectOption('CREDIT')
  await page.getByLabel('분개 3 금액', { exact: true }).fill('500')
  await page.getByRole('button', { name: '거래 저장 →' }).click()
  await expect(page.getByRole('link', { name: '직접분개 확인', exact: true })).toBeVisible()
  const journal = state.transactions.find((t) => t.description === '직접분개 확인')!
  await page.goto(`/transactions/new?copy=${journal.id}`)
  await expect(page.getByLabel('분개 1 메모', { exact: true })).toHaveValue('복사해도 남을 메모')
  await expect(page.locator('.journal-totals')).toContainText('균형 일치')
  await expect(page.locator('.journal-row')).toHaveCount(3)
  await page.setViewportSize({ width: 320, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('사용처 / 설명').fill('분개 복사')
  await page.screenshot({ path: 'docs/mobile-journal.png', fullPage: true, animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: '거래 저장 →' }).click()
  await expect(page.getByRole('link', { name: '분개 복사', exact: true })).toBeVisible()
  expect(state.transactions.find((t) => t.description === '분개 복사')!.lines[0]!.memo).toBe(
    '복사해도 남을 메모',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/accounts')
  await page.getByRole('button', { name: '＋ 계정 추가' }).click()
  await page.getByLabel('계정 이름', { exact: true }).fill('비상금')
  await page.getByRole('button', { name: '계정 저장' }).click()
  await expect(page.getByRole('cell', { name: '비상금', exact: true })).toBeVisible()
  await page
    .getByRole('row')
    .filter({ hasText: '비상금' })
    .getByRole('button', { name: '수정' })
    .click()
  await page.getByLabel('보관하기').check()
  await page.getByRole('button', { name: '계정 저장' }).click()
  await expect(page.getByRole('cell', { name: '비상금', exact: true })).toHaveCount(0)
  await page.getByLabel('보관 계정 포함').check()
  await expect(page.getByRole('row').filter({ hasText: '비상금' })).toContainText('보관됨')
  await page.goto('/settings/members')
  await page.getByRole('button', { name: '초대 코드 만들기' }).click()
  await expect(page.getByLabel('발급된 초대 코드')).toHaveValue(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  )
  await page.getByRole('button', { name: '로그아웃', exact: true }).click()
  await expect(page).toHaveURL(/login/)
  expect(errors).toEqual([])
  expect(calls.filter((c) => c.name === 'create_transaction')).toHaveLength(8)
})

test('signup confirmation, login errors, protected-route redirect and mobile login', async ({
  page,
}) => {
  await page.route('https://ledger-test.supabase.co/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/v1/signup')
      await route.fulfill({
        status: 200,
        json: { id: randomUUID(), email: 'new@example.test', identities: [] },
      })
    else if (path === '/auth/v1/token')
      await route.fulfill({
        status: 400,
        json: {
          error: 'invalid_grant',
          error_description: '이메일 또는 비밀번호가 올바르지 않습니다.',
        },
      })
    else await route.fulfill({ status: 200, json: [] })
  })
  await page.goto('/transactions/new')
  await expect(page).toHaveURL(/login/)
  await page.getByRole('button', { name: '처음 오셨나요? 회원가입' }).click()
  await page.getByLabel('이메일', { exact: true }).fill('new@example.test')
  await page.getByLabel('비밀번호', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '회원가입 →', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('가입 확인 이메일')
  await page.getByRole('button', { name: '이미 계정이 있나요? 로그인' }).click()
  await page.getByRole('button', { name: '로그인 →', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('이메일 또는 비밀번호')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '로그인 →', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
