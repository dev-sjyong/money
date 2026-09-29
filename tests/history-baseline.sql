-- Fixture installed between migrations 001 and 002 to verify an in-place upgrade.
insert into auth.users(id) values('44444444-4444-4444-8444-444444444444');
set role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
do $$ declare h uuid; a uuid; e uuid;
begin
  h:=public.create_household('이력 도입 전 가계부');
  select id into a from public.accounts where household_id=h and name='은행';
  select id into e from public.accounts where household_id=h and name='급여';
  perform public.create_transaction(h,'2026-09-01','도입 전 급여',jsonb_build_array(
    jsonb_build_object('account_id',a,'entry_type','DEBIT','amount','9007199254740993'),
    jsonb_build_object('account_id',e,'entry_type','CREDIT','amount','9007199254740993')),
    '보존 대상','aaaaaaaa-1111-4111-8111-111111111111');
end $$;
reset role;
