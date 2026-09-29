\set ON_ERROR_STOP on
begin;
create schema history_test;
create function history_test.ok(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function history_test.reject(q text,label text,expected text default null) returns void language plpgsql as $$
begin
  begin execute q;
  exception when others then
    if expected is not null and position(expected in sqlerrm)=0 then raise exception 'FAIL: % unexpected error: %',label,sqlerrm; end if;
    raise notice 'PASS (rejected): % [%]',label,sqlerrm; return;
  end;
  raise exception 'FAIL (accepted): %',label;
end $$;
grant usage on schema history_test to authenticated,anon;
grant execute on all functions in schema history_test to authenticated,anon;
set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
select history_test.ok((select action='BASELINE' and actor_id is null and before_snapshot is null
  and after_snapshot->>'description'='도입 전 급여'
  and after_snapshot->'lines'->0->>'amount'='9007199254740993'
  from public.transaction_history where transaction_id='aaaaaaaa-1111-4111-8111-111111111111'),
  'migration baseline preserves existing journal, exact money, no fabricated actor');
select history_test.ok((select count(*)=1 from public.transactions where id='aaaaaaaa-1111-4111-8111-111111111111'),'migration preserves existing live transaction');
reset role;
insert into auth.users(id) values('55555555-5555-4555-8555-555555555555'),('66666666-6666-4666-8666-666666666666'),('77777777-7777-4777-8777-777777777777');
set local role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
do $$
declare h uuid; a uuid; expense uuid; equity uuid; t uuid; opening uuid; other_opening uuid;
  old_version timestamptz; deleted_version timestamptz; initial_created timestamptz;
  initial_lines jsonb; lines jsonb; s jsonb; before_count bigint; inv uuid; foreign_h uuid;
begin
  h:=public.create_household('이력 테스트');
  select id into a from public.accounts where household_id=h and name='은행';
  select id into expense from public.accounts where household_id=h and name='식비';
  select id into equity from public.accounts where household_id=h and is_system;
  lines:=jsonb_build_array(jsonb_build_object('account_id',expense,'entry_type','DEBIT','amount','10000','memo','원래 줄 메모'),jsonb_build_object('account_id',a,'entry_type','CREDIT','amount','10000'));
  t:=public.create_transaction(h,'2026-09-01','점심',lines,'원래 메모');
  set constraints all immediate; set constraints all deferred;
  perform history_test.ok((select count(*)=1 from public.transaction_history where transaction_id=t and action='CREATE'),'one CREATE event');
  perform history_test.ok((select actor_id=auth.uid() and after_snapshot->'lines' @> jsonb_build_array(jsonb_build_object('account_name','식비','memo','원래 줄 메모','amount','10000')) from public.transaction_history where transaction_id=t),'CREATE actor, account name, line memo captured');
  perform history_test.ok((select balance='-10000' from public.account_balances where account_id=a),'created expense reduces balance');
  select updated_at into old_version from public.transactions where id=t;
  lines:=jsonb_build_array(jsonb_build_object('account_id',expense,'entry_type','DEBIT','amount','20000','memo','변경 줄 메모'),jsonb_build_object('account_id',a,'entry_type','CREDIT','amount','20000'));
  perform public.update_transaction(t,'2026-09-02','저녁',lines,old_version,'변경 메모');
  set constraints all immediate; set constraints all deferred;
  perform history_test.ok((select before_snapshot->>'description'='점심' and after_snapshot->>'description'='저녁' and before_snapshot->>'memo'='원래 메모' and after_snapshot->>'memo'='변경 메모' from public.transaction_history where transaction_id=t and action='UPDATE'),'UPDATE before and after descriptions and memos');
  perform history_test.ok((select before_snapshot->'lines' @> jsonb_build_array(jsonb_build_object('amount','10000')) and after_snapshot->'lines' @> jsonb_build_array(jsonb_build_object('amount','20000')) from public.transaction_history where transaction_id=t and action='UPDATE'),'UPDATE before and after amounts');
  select count(*) into before_count from public.transaction_history where transaction_id=t;
  perform history_test.reject(format('select public.update_transaction(%L,%L,%L,%L,%L)',t,'2026-09-02','stale',lines,old_version),'stale edit','다른 사용자가 수정');
  perform history_test.ok((select count(*)=before_count from public.transaction_history where transaction_id=t),'failed edit creates no audit');
  select updated_at,created_at into old_version,initial_created from public.transactions where id=t;
  s:=public.ledger_snapshot(h)->'transactions'->0;
  initial_lines:=s->'lines';
  perform public.delete_transaction(t,old_version);
  set constraints all immediate; set constraints all deferred;
  perform history_test.ok(not exists(select 1 from public.transactions where id=t) and not exists(select 1 from public.transaction_lines where transaction_id=t),'deleted transaction and lines absent from active ledger');
  perform history_test.ok((select balance='0' from public.account_balances where account_id=a),'deletion reverses derived balance');
  perform history_test.ok(jsonb_array_length(public.ledger_snapshot(h)->'transactions')=0,'deleted record excluded from snapshot and reports');
  perform history_test.ok((select snapshot->>'description'='저녁' and snapshot->>'created_at'=s->>'created_at' from public.transaction_trash where transaction_id=t),'trash preserves original record');
  perform history_test.ok((select before_snapshot->>'description'='저녁' and after_snapshot is null and actor_id=auth.uid() from public.transaction_history where transaction_id=t and action='DELETE'),'DELETE audit snapshot and actor');
  perform history_test.ok(jsonb_array_length(public.get_transaction_trash(h))=1,'owner trash RPC');
  perform history_test.ok(jsonb_array_length(public.get_transaction_history(h,t))=3,'history survives deletion');
  select deleted_at into deleted_version from public.transaction_trash where transaction_id=t;
  perform history_test.reject(format('select public.restore_transaction(%L,%L)',t,deleted_version-interval '1 second'),'stale restore','휴지통이 변경');
  perform history_test.reject(format('select public.create_transaction(%L,%L,%L,%L,null,%L)',h,'2026-09-03','reuse',lines,t),'retired ID cannot overwrite history','이미 사용한 거래 ID');
  perform public.restore_transaction(t,deleted_version);
  set constraints all immediate; set constraints all deferred;
  perform history_test.ok((select transaction_date='2026-09-02' and description='저녁' and memo='변경 메모' and created_at=initial_created and created_by=auth.uid() and updated_at<>old_version from public.transactions where id=t),'restore preserves date, content, author and created time; changes version');
  perform history_test.ok((select jsonb_agg(to_jsonb(l)||jsonb_build_object('amount',l.amount::text) order by l.created_at,l.id)=initial_lines from public.transaction_lines l where transaction_id=t),'restore preserves exact lines, IDs, amounts, memos and dates');
  perform history_test.ok((select balance='-20000' from public.account_balances where account_id=a),'restore reflects exactly once');
  perform history_test.ok(not exists(select 1 from public.transaction_trash where transaction_id=t),'restore removes trash entry');
  perform history_test.ok((select count(*)=1 from public.transaction_history where transaction_id=t and action='RESTORE'),'RESTORE audit recorded');
  perform history_test.reject(format('select public.restore_transaction(%L,%L)',t,deleted_version),'duplicate restore rejected','접근 권한');
  perform history_test.ok((select balance='-20000' from public.account_balances where account_id=a),'duplicate restore cannot double balance');
  -- Changing an account name must not rewrite historical snapshots.
  perform public.save_account(h,'식비 변경','EXPENSE',null,null,expense);
  perform history_test.ok((select after_snapshot->'lines' @> jsonb_build_array(jsonb_build_object('account_name','식비')) from public.transaction_history where transaction_id=t and action='CREATE'),'historical account name preserved');
  select updated_at into old_version from public.transactions where id=t;
  perform public.delete_transaction(t,old_version);
  select deleted_at into deleted_version from public.transaction_trash where transaction_id=t;
  perform public.save_account(h,'은행','ASSET',null,null,a,true);
  select count(*) into before_count from public.transaction_history where transaction_id=t;
  perform history_test.reject(format('select public.restore_transaction(%L,%L)',t,deleted_version),'archived account restore blocked','사용할 수 없는 계정');
  perform history_test.ok(exists(select 1 from public.transaction_trash where transaction_id=t) and not exists(select 1 from public.transactions where id=t),'failed restore keeps trash and no partial transaction');
  perform history_test.ok((select count(*)=before_count from public.transaction_history where transaction_id=t),'failed restore creates no audit');
  perform public.save_account(h,'은행','ASSET',null,null,a,false);
  inv:=public.create_invite(h);
  perform set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);
  perform public.accept_invite(inv);
  perform history_test.ok(jsonb_array_length(public.get_transaction_history(h,t))>0,'member can read audit');
  perform history_test.ok(jsonb_array_length(public.get_transaction_trash(h))=0,'member cannot read trash');
  perform history_test.reject(format('select public.restore_transaction(%L,%L)',t,deleted_version),'member cannot restore','접근 권한');
  perform history_test.reject(format('delete from public.transaction_history where transaction_id=%L',t),'member cannot erase audit','permission denied');
  perform set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
  foreign_h:=public.create_household('다른 가계부');
  perform history_test.ok(jsonb_array_length(public.get_transaction_history(h,t))=0,'cross household history invisible');
  perform history_test.ok(jsonb_array_length(public.get_transaction_trash(h))=0,'cross household trash invisible');
  perform history_test.reject(format('select public.restore_transaction(%L,%L)',t,deleted_version),'cross household restore blocked','접근 권한');
  perform set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
  perform history_test.reject(format('update public.transaction_history set actor_id=null where transaction_id=%L',t),'owner cannot alter audit','permission denied');
  perform history_test.reject(format('delete from public.transaction_trash where transaction_id=%L',t),'owner cannot directly delete trash','permission denied');
  perform history_test.reject(format('select private.transaction_snapshot(%L)',t),'private helper not executable','permission denied');
  perform public.restore_transaction(t,deleted_version);
  -- Initial-balance uniqueness remains valid across the trash lifecycle.
  opening:=public.create_opening(h,'2026-09-01',jsonb_build_array(jsonb_build_object('account_id',a,'amount','30000')));
  perform history_test.ok((select (after_snapshot->>'is_opening')::boolean from public.transaction_history where transaction_id=opening and action='CREATE'),'opening CREATE audit contains final opening flag');
  select updated_at into old_version from public.transactions where id=opening;
  perform public.delete_transaction(opening,old_version);
  select deleted_at into deleted_version from public.transaction_trash where transaction_id=opening;
  other_opening:=public.create_opening(h,'2026-09-01',jsonb_build_array(jsonb_build_object('account_id',a,'amount','40000')));
  perform history_test.reject(format('select public.restore_transaction(%L,%L)',opening,deleted_version),'opening conflict blocked','다른 초기 자산 거래');
  perform history_test.ok((select count(*)=1 from public.transactions where household_id=h and is_opening),'only one active opening');
  select updated_at into old_version from public.transactions where id=other_opening;
  perform public.delete_transaction(other_opening,old_version);
  perform public.restore_transaction(opening,deleted_version);
  perform history_test.ok((select is_opening from public.transactions where id=opening),'opening restored after conflict removed');
  set constraints all immediate;
  perform history_test.ok(not exists(select transaction_id from public.transaction_lines group by transaction_id having sum(case when entry_type='DEBIT' then amount::numeric else -amount::numeric end)<>0),'all restored journals balanced');
  perform public.remove_member(h,'66666666-6666-4666-8666-666666666666');
  perform set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);
  perform history_test.ok(jsonb_array_length(public.get_transaction_history(h,t))=0,'removed member loses audit access');
end $$;
set local role anon;
select history_test.reject('select * from public.transaction_history','anonymous history denied','permission denied');
select history_test.reject('select public.get_transaction_trash(gen_random_uuid())','anonymous trash RPC denied','permission denied');
select history_test.reject('select public.restore_transaction(gen_random_uuid(),now())','anonymous restore denied','permission denied');
rollback;
