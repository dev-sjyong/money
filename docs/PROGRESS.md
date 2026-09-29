# 단계별 진행 기록

## Phase 1 — 분석 / Plan
- 구현: 빈 작업 폴더를 확인하고 Nuxt 4 신규 구조, 권한 모델, 정수 금액 처리, 검증 전략 수립.
- 파일: docs/PLAN.md, package.json, nuxt.config.ts, tsconfig.json, .env.example.
- DB: 없음.
- 검증: 현재/상위 지침 파일, package/lockfile 부재, Node/PostgreSQL 런타임 확인.
- 문제: 기존 프로젝트·원격 Supabase 설정 미제공.
- 다음: DB 및 보안 구현.

## Phase 2 — DB / Do
- 구현: 3개 enum, 요구한 6개 테이블 + 초대 테이블, FK/check/index.
- 파일: supabase/migrations/202609290001_ledger.sql.
- DB: 전체 신규 스키마. 금액 bigint, 잔액 컬럼 없음.
- 검증: PostgreSQL 15 독립 인스턴스에서 migration 전체 성공.
- 문제: 샌드박스 공유메모리 제한은 검증 실행 권한으로 해결. 기존 DB 미접근.
- 다음: 권한 테스트.

## Phase 3 — Security
- 구현: 모든 테이블 RLS, private helper, SECURITY DEFINER search_path 고정, 함수 execute 제한, 직접 DML 차단.
- 파일: migration, tests/bootstrap.sql, tests/database.sql, tests/concurrency.py.
- DB: 역할별 RPC 권한 및 초대/멤버 제한.
- 검증: 타 가계부 테이블·view·RPC 접근 차단, 익명 차단, 구성원 계정관리 차단, 탈퇴 후 접근 차단.
- 문제: 실제 Supabase JWT 발급은 연결 환경 미제공으로 미검증. DB 테스트는 auth.uid() 스텁과 실제 PG role/RLS 사용.
- 다음: 회계 핵심.

## Phase 4 — Accounting Core
- 구현: 원자적 거래 생성/수정/삭제, 기초분개, view, deferred balance constraint, stale update 감지.
- 파일: migration, app/utils/accounting.ts, app/types/ledger.ts, tests/accounting.test.ts.
- DB: 분개만으로 잔액 계산. RPC와 deferred constraint 양쪽 검증.
- 검증: 요구된 초기 상태 및 5단계 거래, 환불, 정밀도, 월말 경계, 비정상 입력.
- 문제/조치: 초기 RPC에서 JSON 별칭과 변수명이 충돌한 것을 실제 DB 테스트로 발견하고 수정.
- 다음: 인증/가계부 UI.

## Phase 5 — Auth / Household
- 구현: 이메일 가입/로그인/로그아웃, 가계부 생성/선택/이름 변경, 기본 계정 생성, 24시간 단일 사용 초대.
- 파일: app/plugins, app/middleware, useAuth/useHousehold/useLedger, login.vue, settings/index.vue, settings/members.vue, app.vue.
- DB: create_household, rename_household, invite/member RPC 연결.
- 검증: 브라우저 HTTP fixture와 실제 DB 테스트를 구분해 수행. 결과는 VALIDATION.md.
- 문제: 원격 이메일 전달/확인, 실제 Auth 세션은 사용자가 Supabase 연결 후 확인 필요.
- 다음: 계정 관리.

## Phase 6 — Accounts
- 구현: 계정 추가/수정/계층/보관/복구, 유형 불변, 순환 금지, 초기 자산/부채.
- 파일: accounts/index.vue, settings/accounts.vue, useAccounts.ts.
- DB: save_account/create_opening RPC 사용, 기초분개는 가계부당 하나.
- 검증: 계정 순환/유형 변경 거부, 보관 계정 신규거래 거부, 원장 잔액 보존.
- 문제: 제시된 시나리오 현금 시작값은 0이므로 현금 지출 후 -20,000원. 임의 초기 현금을 만들지 않음.
- 다음: 거래 관리.

## Phase 7 — Transactions
- 구현: 지출/수입/이체/카드대금/대출 원금/직접분개, 목록·검색·기간·페이지·상세·수정·삭제.
- 파일: TransactionForm/TransactionTable, transactions/*, useTransactions.ts.
- DB: 요청 UUID 중복 방지, updated_at 낙관 잠금. 삭제 OWNER만, 기초거래 수정 OWNER만.
- 검증: 차대 실시간 표시, 잘못된 분개 저장 차단, 정상 거래 변경/삭제 및 잔액 재계산.
- 문제/조치: 템플릿 option 닫힘 오류를 타입/빌드 검사에서 발견해 수정.
- 다음: 예산.

## Phase 8 — Budgets
- 구현: 월·계정별 예산 저장/수정/삭제, 상위 항목 하위 지출 포함, 사용/잔여/비율.
- 파일: budgets/index.vue, useBudgets.ts.
- DB: save_budget/delete_budget RPC, 유일성/기간/비용유형 검사.
- 검증: 상위 예산 하위 지출 집계 및 상위·하위 예산 중복 합계 방지 단위테스트.
- 문제: 손익은 차대 순액, 예산 사용은 요청대로 차변 합계라는 차이를 안내.
- 다음: 보고서.

## Phase 9 — Dashboard / Reports
- 구현: 순자산·자산·부채, 월 수입/지출/수지, 예산, 최근 기록, 카테고리, 6/12개월 순자산·손익.
- 파일: dashboard/index.vue, reports/*, useDashboard.ts, ReportChart/MoneyValue, main.css.
- DB: ledger_snapshot security invoker RPC에서 문자열 금액으로 일관된 전체 원장 읽기.
- 검증: 월 경계·과거 잔액·보관 계정 포함. 금액 집계는 bigint로 처리하고 그래프 비율만 Number로 변환.
- 문제: MVP는 전체 가계부 원장을 읽고 화면에서 집계. 큰 원장에서는 서버 집계/페이지 분리 권장.
- 다음: 전체 검증 및 Act.

## Phase 10 — Check / Act
- 검증 결과와 실행 명령, 성공/미실행 구분: docs/VALIDATION.md 참조.
- 발견한 SQL/템플릿 오류는 수정 후 해당 검증 재실행.
- 커밋·원격 DB 수정·배포는 하지 않음. 로컬 실행 및 Vercel/Supabase 연결 절차는 README.md.

### 최종 결과
타입검사/프로덕션 빌드 통과, 회계 단위 테스트 6개, PostgreSQL 검증 57개, 동시성 검증 2개, Chromium 브라우저 시나리오 2개 통과. 데스크톱/모바일 캡처 확인 완료. 원격 인증·배포 미검증은 VALIDATION.md에 별도 명시.
