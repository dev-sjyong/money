# 두런 · 개인/2인 복식부기 가계부

Nuxt 4 + Vue 3 + TypeScript + Supabase Auth/PostgreSQL/RLS/RPC로 구현한 수동 입력 가계부입니다. 은행·카드 API, OCR, Spring 서버는 사용하지 않습니다.

## 구현 범위

- 이메일 회원가입/로그인/로그아웃, 가계부 생성/선택/이름 변경
- 기본 계정 24개, 계층형 계정 생성·수정·보관·복구, 초기 자산/부채 분개
- 지출·수입·계좌이체·카드대금·대출 원금 상환·직접분개
- 거래 검색·월 필터·목록·상세·수정·삭제, 동시 수정 감지
- 거래 변경 전후 이력, 소유자 휴지통·삭제 복구
- 거래 복사·최근 거래 바로 복사, 모바일 숫자 입력·빠른 금액 추가·분개 메모
- 월별 예산, 하위 계정 지출 포함, 중첩 예산 중복 제거
- 대시보드, 월별 손익, 자산/부채, 월말 순자산 추이
- 통계 한눈에: 기간 비교·항목별 상세 거래·환불 분석·CSV, 기준일별 자산·부채 비교와 최대 24개월 추이
- 소유자와 구성원 총 2명, 일회용 24시간 초대 코드
- 고정지출: 월별 예정 목록·실제 납부 확인·기존 거래 연결·건너뛰기·적용 월별 규칙 변경
- 개인회생 일정: 사람별 가변 변제금·종료일, 부분 납부/선납 기록, 남은 회차·금액·미납액

## 실행

Node 22.12+ 또는 24 LTS, npm 사용. 실제 검증 버전은 package-lock.json과 docs/VALIDATION.md 참조.

```sh
npm ci
cp .env.example .env
# .env에 실제 Supabase URL 및 공개 anon/publishable key 설정
npm run dev
```

로그인 화면에 연결 설정 안내가 보이면 `.env` 값을 확인하고 서버를 재시작하세요. 브라우저에 들어가는 키는 공개 키만 사용합니다. 서비스 역할 키를 입력하지 마세요.

## Supabase 연결

1. 새 Supabase 프로젝트를 준비합니다(PostgreSQL 15 이상).
2. SQL Editor 또는 Supabase migration 도구에서 `supabase/migrations/202609290001_ledger.sql`, `supabase/migrations/202609290002_transaction_history.sql`, `supabase/migrations/202609300003_repayment.sql`, `supabase/migrations/202609300004_fixed_expenses.sql`을 순서대로 실행합니다. 이미 적용된 migration은 중복 실행하지 않습니다.
3. Auth에서 Email provider를 활성화합니다. 이메일 확인이 켜져 있으면 수신한 확인 링크를 누른 후 로그인합니다.
4. Auth URL Configuration의 Site URL을 서비스 도메인(개발 시 localhost 주소)으로 설정합니다. 필요한 Redirect URL도 등록합니다.
5. 프로젝트 URL과 공개 키를 `.env`의 `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY`에 입력합니다.
6. 가입 → 로그인 → 설정에서 가계부 생성 → 계정 이름 정리 → 초기 자산 등록 → 거래 기록 순서로 시작합니다.

초대할 때는 설정 → 구성원 → 초대 코드 만들기에서 나온 코드를 상대에게 전달합니다. 상대는 본인 계정으로 로그인하고 설정의 '초대받은 가계부 참여'에서 코드를 입력합니다. 코드 재발급 시 이전 코드는 무효화되며, 수락 또는 구성원 삭제 시 코드가 제거됩니다.

## 기존 서비스 업그레이드: DB 먼저, 앱 나중

이미 001을 적용한 서비스는 Supabase SQL Editor에서 **[002 SQL](supabase/migrations/202609290002_transaction_history.sql)만 전체 실행**하세요. 테스트용 bootstrap이나 001을 재실행하지 않습니다. 002 성공 후 이 변경을 main에 병합하여 Vercel을 배포합니다. 기존 앱은 새 DB와 호환되므로 DB부터 적용할 수 있습니다.

도입 당시 존재하던 거래는 '이력 기록 시작' 스냅샷이 남습니다. 도입 전 수정 과정이나 이미 영구 삭제된 거래는 복원되지 않습니다. 이후 삭제 거래는 소유자가 휴지통에서 복구할 수 있으며, 자동 만료나 영구 삭제 기능은 추가하지 않았습니다. 복구 대상에 보관 계정이 있으면 계정을 먼저 복구해야 합니다.

배포 후 거래 생성 → 수정 → 이력 확인 → 삭제 → 휴지통 복구 → 잔액 확인, 거래 복사 → 오늘 날짜·원본 유지 확인을 수행하세요. 로컬 검증 결과는 [고도화 기록](docs/ENHANCEMENTS.md)에 있습니다.

## 개인회생 일정 사용 방법

001·002가 적용된 기존 서비스에는 **[003 SQL](supabase/migrations/202609300003_repayment.sql)만** 먼저 실행한 뒤 새 코드를 배포합니다. 002가 아직 없다면 002 → 003 순서로 적용하세요. 테스트용 bootstrap을 운영 DB에 실행하지 않습니다.

1. **개인회생 일정 → 변제 일정 추가**에서 이름/별칭을 입력합니다.
2. 같은 변제금이 적용되는 시작 월·마지막 월·매월 납부일·금액을 입력하고 **기간 추가**를 누릅니다. 금액이 바뀌는 기간은 나누어 추가하세요.
3. 개별 회차의 예정일/금액을 수정할 수 있습니다. 해당 월에 없는 날짜(예: 2월 31일)는 말일로 생성됩니다.
4. 이미 낸 금액이나 매월 납부액은 해당 회차의 **납부 기록 추가**에서 실제 날짜와 금액을 입력합니다. 여러 번 나누어 내거나 선납한 기록도 가능합니다.
5. **일정 저장**을 눌러 전체 변경을 저장하고, 배우자 계획도 별도로 등록합니다.

모든 회차를 입력하면 전체 변제계획을 볼 수 있고, 남은 회차만 입력하면 입력 시점 이후의 일정만 관리합니다. 화면의 회차 번호는 등록된 일정의 날짜 순서입니다. 종료 예정일은 마지막 등록 회차입니다. 실제 납부 기록과 비교해 잔여액을 계산하며 면책 여부를 판정하지 않습니다.

이 화면의 납부 기록은 **회계 원장과 별도**입니다. 거래·잔액·손익을 자동 변경하지 않습니다. 두 구성원 모두 일정/납부 기록을 편집할 수 있고, 보관한 계획은 합계에서 제외됩니다. 잘못 적은 납부는 삭제 확인 후 다시 입력합니다. 다른 곳에서 수정한 계획을 덮어쓰려 하면 차단되며 입력은 유지됩니다.

## Vercel 배포 준비

이 프로젝트를 Vercel 프로젝트의 Root Directory로 지정하고 Nuxt preset, `npm run build`를 사용합니다. 두 `NUXT_PUBLIC_*` 환경변수를 Vercel에 등록하세요. Nuxt/Nitro가 Vercel 환경의 preset을 선택합니다. 실제 원격 배포는 수행하지 않았습니다. 배포 도메인은 Supabase Auth URL 설정에도 반영해야 합니다.

```sh
npm run build
npm run preview
```

인증 중심 앱이므로 SSR은 비활성화했습니다. Nuxt 서버는 앱을 제공하며, 금융 데이터는 Supabase에서 RLS/RPC를 통해 읽고 씁니다.

## 검증

```sh
npm test
npm run typecheck
npm run build
```

독립된 PostgreSQL 15+ 테스트 DB에서만 다음을 실행하세요. `bootstrap.sql`은 Supabase의 `auth.uid()`와 역할을 흉내 내는 테스트 전용 파일이며, 실제 Supabase 프로젝트에는 실행하지 않습니다.

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/bootstrap.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609290001_ledger.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/history-baseline.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609290002_transaction_history.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/history.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609300003_repayment.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/repayment.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609300004_fixed_expenses.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixed.sql
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:db
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 tests/concurrency.py
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 tests/history-concurrency.py
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 tests/repayment-concurrency.py
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 tests/fixed-concurrency.py
```

브라우저 테스트는 실제 앱과 Supabase HTTP 응답 fixture를 사용합니다. 실제 이메일/JWT/PostgREST 연동을 통과했다는 의미는 아닙니다.

```sh
npx playwright install chromium
# 별도 터미널: 테스트용 로컬 서버 (실제 데이터 연결 없음)
NUXT_PUBLIC_SUPABASE_URL=https://ledger-test.supabase.co \
NUXT_PUBLIC_SUPABASE_ANON_KEY=test-public-key \
NITRO_HOST=127.0.0.1 NITRO_PORT=3108 node .output/server/index.mjs
# 테스트 실행
npm run test:ui
```

이미 설치된 Chromium을 사용할 때는 `PLAYWRIGHT_EXECUTABLE_PATH`를 지정할 수 있습니다. HTTP fixture는 Playwright에서만 주입되므로 위 테스트 서버를 실제 서비스로 사용하지 않습니다.

## 통계 사용 방법

- **통계 한눈에**: 한 달/최근 3·6·12개월 또는 직접 날짜를 선택합니다. 월 단위는 직전 동일 개월 수, 직접 기간은 직전 동일 일수와 비교합니다.
- **어디에 썼을까요?**의 항목을 누르면 해당 지출 거래만 표시합니다. 상위 항목에는 하위 항목이 포함되고 개별 계정 모드는 직접 분개만 집계합니다. 거래 설명을 누르면 기존 거래 상세로 이동합니다.
- **CSV 내보내기**: 요약/항목별 집계와 현재 필터의 전체 상세 거래를 내려받습니다. 화면의 20건 페이지 제한은 CSV에 적용되지 않습니다.
- **자산·부채 보고서**: 기준일을 선택해 해당 날짜까지의 잔액과 전월 말 대비 증감을 비교합니다.
- **순자산 추이**: 6/12/24개월과 자산/부채/순자산 지표를 선택할 수 있습니다.

통계는 저장된 원장 기준입니다. 이체/원금 상환은 수입·지출에서 제외되고 환불은 지출에서 차감합니다. 개인회생 일정에만 기록한 납부는 자동 포함하지 않습니다. 상세 검증은 [ANALYTICS](docs/ANALYTICS.md)에 있습니다. 이번 통계 개선에는 추가 SQL이 필요 없습니다.

## 고정지출 사용 방법

기존 001~003 적용 서비스는 **[004 SQL](supabase/migrations/202609300004_fixed_expenses.sql)만** Supabase SQL Editor에서 먼저 실행한 뒤 새 코드를 배포합니다. 기존 migration이나 테스트 bootstrap은 재실행하지 않습니다.

1. **고정지출 → 고정지출 추가**에서 이름/예상 금액/매월 납부일/적용 시작 월/지출 계정/결제 계정을 입력합니다. 종료 월은 선택이며 31일처럼 해당 월에 없는 날짜는 말일로 맞춥니다.
2. 매달 **납부 확인**에서 실제 납부일과 금액을 확인하면 지출 거래 1건을 생성합니다. 예상 금액과 달라도 실제 청구 금액으로 완료 처리합니다.
3. 이미 거래를 기록했다면 **기존 거래 연결**을 사용합니다. 같은 지출/결제 계정의 두 줄 단순 지출 거래만 연결되며 한 거래는 한 항목/월에만 연결됩니다. 앞뒤 달에 실제 납부한 거래도 날짜를 확인해서 연결할 수 있습니다.
4. **이번 달 건너뛰기**는 해당 월에만 적용됩니다. **처리 취소**는 상태/연결만 해제하고 기존 거래를 삭제하지 않습니다. 다시 처리할 때 기존 거래를 연결하면 중복 기록을 피할 수 있습니다.
5. **규칙 수정**에서 적용 월을 지정하여 금액·날짜·계정 변경 또는 중단/재개를 설정합니다. 기존 규칙 변경은 이번 달 이후만 가능하고, 이전 달 규칙과 이미 처리된 달의 예정정보는 유지됩니다. 같은 적용 월은 덮어쓰고 이후에 별도로 예약한 규칙은 유지됩니다.

예정 항목만으로 원장/통계/예산이 증가하지 않습니다. 실제 거래 생성 또는 연결 후에는 거래 날짜 기준으로 집계됩니다. 연결된 거래가 삭제되거나 계정·미래 날짜로 수정되면 '거래 확인 필요'로 표시됩니다. 원래 거래를 휴지통에서 복구하면 연결이 회복됩니다. 개인회생 일정·대출 원금 상환·계좌이체는 기존 전용 메뉴를 사용하세요.

거래 자동 생성/은행 자동 결제/알림 발송은 하지 않습니다. 가계부의 두 구성원 모두 관리할 수 있고 동시에 확인해도 중복 거래를 막습니다. [설계 및 검증](docs/FIXED_EXPENSES.md).

## 회계·권한 설계

- `accounts`에 잔액 컬럼이 없습니다. `account_balances` view와 UI는 모두 분개를 합산합니다.
- 자산/비용은 차변−대변, 부채/자본/수입은 대변−차변입니다.
- DB 금액은 양수 `BIGINT`, JSON은 십진 문자열, 클라이언트는 `bigint`입니다. 비율/차트 너비만 Number로 변환합니다.
- 거래는 RPC에서 생성/변경하며 분개와 동시에 저장합니다. 프론트 검증 외에 RPC 검증과 deferred constraint trigger가 균형을 강제합니다.
- 앱 역할은 테이블 직접 쓰기를 할 수 없습니다. RPC는 auth.uid()와 household 소속 및 OWNER 여부를 재검증합니다.
- 모든 데이터 테이블은 RLS, balance view는 security_invoker. SECURITY DEFINER 함수는 고정된 빈 search_path와 완전 수식 테이블명을 사용합니다.
- 중요한 변경은 household 행 잠금으로 직렬화합니다. 초대 수락 경쟁과 구성원 삭제/쓰기 경쟁을 방지합니다.
- MEMBER: 거래 생성/수정, 예산 관리, 모든 보고서 읽기. OWNER: 이에 더해 계정/구성원/설정, 초기 자산, 거래 삭제·휴지통·복구.
- 계정 유형 변경은 과거 원장의 의미를 바꾸므로 허용하지 않습니다. 새로운 계정으로 대체하세요.
- 시작 잔액은 기초순자산을 반대 계정으로 한 분개입니다. 적자가 시작값이면 자본 차변으로 기록합니다.
- 카드대금·계좌이체·대출 원금은 비용이 아닙니다. 이자와 함께 상환할 때는 직접분개에 별도 비용 행을 추가합니다.
- 예산 사용은 요구사항대로 비용의 **차변 합계**입니다. 환불 대변을 차감한 손익 보고서와 다를 수 있습니다.
- 부모 예산과 자식 예산이 함께 있으면 각 행은 따로 표시하고 전체 합계는 최상위 예산만 포함합니다.
- 계정 목록의 잔액은 해당 계정 직접 분개 기준이고, 지출 분석/예산만 하위 항목을 포함합니다.

## 구조

```text
app/
  pages/          인증·대시보드·거래·계정·예산·보고서·설정
  layouts/        공통 탐색 및 가계부 선택
  components/     거래 폼·표·금액·보고서 차트
  composables/    Supabase 연결·인증·가계부·원장·집계
  utils/          bigint 회계 계산 및 입력 검증
  types/          UI와 RPC JSON 계약
supabase/migrations/  스키마·권한·RPC
 tests/               단위·DB·동시성·브라우저 검증
 docs/                계획·단계별 진행·검증·화면
```

## 명시적 한계

- 원격 Supabase 연결, 실제 가입 확인 이메일, 실제 Auth 세션/JWT/PostgREST, Vercel 배포는 미검증입니다.
- TypeScript의 `ledger.ts`는 문자열 금액을 포함하는 RPC JSON 계약이며 Supabase CLI 자동 생성 파일이 아닙니다. DB 구조를 변경할 때 SQL과 계약을 함께 검증해야 합니다.
- MVP는 한 가계부의 원장을 한 번에 읽어 클라이언트에서 집계합니다. 대규모 데이터에서는 서버 집계 RPC와 서버 페이지 처리가 필요합니다.
- 공유 변경은 화면의 새로고침 또는 저장 후 재조회로 반영합니다. Realtime/푸시 동기화는 이번 범위에 없습니다.
- 모든 원화 입력은 정수입니다. 음수 잔액은 허용하지만 개별 분개 금액은 양수여야 합니다.
- 전체 현재 잔액은 기록된 모든 거래를 포함합니다. 월말 보고서는 해당 날짜까지의 거래만 집계합니다.
- 통신 실패 후 저장 성공 여부가 불명확하면 거래 목록을 새로고침해 확인하세요. 동일 폼의 요청 UUID는 중복 저장을 방지하지만 오류를 자동 재시도하지 않습니다.

분석과 각 Phase의 구현/검증/문제/다음 단계는 [PLAN](docs/PLAN.md), [PROGRESS](docs/PROGRESS.md), [VALIDATION](docs/VALIDATION.md)에 기록했습니다.
