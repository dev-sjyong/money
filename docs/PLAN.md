# 구현 계획 · Plan → Do → Check → Act

## Phase 1 분석 (2026-09-29)
- 작업 폴더는 outputs/, work/만 있는 빈 폴더. package.json, lockfile, Nuxt, UI, Supabase 설정, 기존 코드 없음.
- 상위 및 현재 폴더에 AGENTS.md/CLAUDE.md 없음. 대화에 제공된 공용 하네스 지침 적용.
- 신규 Nuxt 4 / Vue 3 / TypeScript, Supabase JS + Auth + PostgreSQL RPC. npm lockfile 사용.
- 배포 대상은 요청대로 Vercel / Supabase. 실제 배포와 원격 DB 변경은 이번 로컬 구현에서 수행하지 않음.
- Node 24와 PostgreSQL 15 실행 파일 존재. Docker 접근 제한. 독립적인 임시 PostgreSQL로 DB 검증 예정.

## 설계
- app/ 아래 pages, components, composables, utils, types. Nuxt useState 사용, Pinia 불필요.
- 인증 중심 개인 앱이므로 ssr:false. Supabase는 public URL/anon key만 사용. 서비스 역할 키 사용하지 않음.
- 읽기는 RLS 및 읽기 RPC, 쓰기는 인증/권한 검사하는 원자적 RPC로 제한.
- 거래/분개 직접 DML 권한 제거 + 지연 constraint trigger로 최종 원장 균형 검증.
- BIGINT 원화: 전송/입력은 십진 문자열, 클라이언트 계산은 bigint. JSON 숫자 정밀도 손실 방지.
- 계정 유형은 생성 후 불변, 부모와 유형 일치 및 순환 금지. 계정 보관은 과거 원장 유지.
- 소유자 1 + 구성원 1. 소유자가 유효기간 있는 일회용 UUID 초대 코드를 발급하고 로그인한 상대가 수락. household 행 잠금으로 경쟁 요청 직렬화.
- 기초잔액은 별도 RPC로 자본 반대분개 생성. household당 1회(거래 수정은 가능), 잔액 컬럼 없음.
- 동시 거래 수정은 updated_at 기반 낙관적 잠금. 저장 요청 UUID 중복 방지.
- 보고서의 손익은 차대 차액; 예산 사용은 요구사항대로 비용 차변 합계. 전체 예산은 중첩 상위/하위 예산 중 최상위만 합산해 중복 제거.

## 신규 파일 목록
- package.json/package-lock.json, nuxt.config.ts, tsconfig.json, .env.example, .gitignore
- supabase/migrations/202609290001_ledger.sql: 전체 스키마, RLS, 함수, view
- app/types/ledger.ts, app/utils/accounting.ts
- app/plugins/supabase.client.ts, app/middleware/auth.global.ts
- app/composables/useAuth.ts, useHousehold.ts, useAccounts.ts, useTransactions.ts, useBudgets.ts, useDashboard.ts, useLedger.ts
- app/pages/login.vue, index.vue, dashboard/index.vue, transactions/{index,new,[id]}.vue
- app/pages/accounts/index.vue, budgets/index.vue, reports/{income-expense,assets,net-worth}.vue, settings/{index,accounts,members}.vue
- app/components/{TransactionForm,MoneyValue,ReportChart}.vue, app/assets/main.css, app/app.vue, app/layouts/default.vue
- tests/accounting.test.ts, tests/database.sql, tests/run-db.sh, scripts DB 검증 지원
- README.md, docs/PROGRESS.md, docs/VALIDATION.md

## 단계 및 통과 기준
1. 분석/계획: 빈 프로젝트 확인 및 이 문서 작성.
2. DB: 스키마/제약/index, PostgreSQL migration 실제 실행.
3. 보안: RLS/함수권한/타 가계부 접근/인원수/역할 검증.
4. 회계: 거래 생성·수정·삭제·초기분개·잔액, 요구한 5단계 실제 SQL 검증.
5. 인증/가계부: 가입·로그인·로그아웃·생성/선택·초대.
6. 계정: 생성·수정·보관·복구·초기 자산/부채 입력.
7. 거래: 모든 간편입력, 직접분개, 검색/기간, 상세/수정/삭제.
8. 예산: 월별 설정, 하위계정 집계, 수정/삭제.
9. 대시보드/보고서: 원장 기반 수치 및 추이 차트.
10. 검증/개선: 타입검사, 빌드, 회계 단위테스트, DB 권한/회계 테스트, 가능한 브라우저 확인. 원격 Auth/이메일/배포 등 환경 없이는 검증하지 않은 것으로 명시.

## 참고
- https://nuxt.com/docs/4.x/directory-structure
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/functions
