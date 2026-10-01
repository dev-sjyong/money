begin;
create table public.repayment_links (
 payment_id uuid primary key, plan_id uuid not null references public.repayment_plans(id) on delete cascade,
 household_id uuid not null references public.households(id) on delete cascade,
 row_id uuid not null, transaction_id uuid not null unique, snapshot jsonb not null
);
alter table public.repayment_links enable row level security;
create policy read_repayment_links on public.repayment_links for select to authenticated using(private.is_member(household_id));
revoke all on public.repayment_links from public,anon,authenticated;
grant select on public.repayment_links to authenticated;
create function public.get_repayment_links(p_household uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.repayment_links l where household_id=p_household;
$$;
alter function public.save_repayment_plan(uuid,uuid,integer,text,text,jsonb,boolean) rename to save_repayment_plan_base;
alter function public.save_repayment_plan_base(uuid,uuid,integer,text,text,jsonb,boolean) set schema private;
revoke all on function private.save_repayment_plan_base(uuid,uuid,integer,text,text,jsonb,boolean) from public,anon,authenticated;
create function public.save_repayment_plan(p_household uuid,p_id uuid,p_revision integer,p_name text,p_note text,p_rows jsonb,p_archived boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare l public.repayment_links; old_payment jsonb; new_payment jsonb;
begin
 perform private.authorize(p_household);
 perform 1 from public.repayment_plans where id=p_id for update;
 for l in select * from public.repayment_links where plan_id=p_id loop
  select payment into old_payment from public.repayment_plans p, jsonb_array_elements(p.rows) r, jsonb_array_elements(r->'payments') payment where p.id=p_id and r->>'id'=l.row_id::text and payment->>'id'=l.payment_id::text;
  select payment into new_payment from jsonb_array_elements(p_rows) r, jsonb_array_elements(r->'payments') payment where r->>'id'=l.row_id::text and payment->>'id'=l.payment_id::text;
  if new_payment is distinct from old_payment then raise exception '연결된 납부 기록은 연결 해제 후 변경하세요'; end if;
 end loop;
 perform private.save_repayment_plan_base(p_household,p_id,p_revision,p_name,p_note,p_rows,p_archived);
end $$;
create function private.check_payment_link() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.households where id=new.household_id for update;
 if tg_table_name='repayment_links' then
  if exists(select 1 from public.fixed_expense_records where transaction_id=new.transaction_id) then raise exception '이미 고정지출에 연결된 거래입니다'; end if;
 else
  if exists(select 1 from public.repayment_links where transaction_id=new.transaction_id) then raise exception '이미 개인회생 납부에 연결된 거래입니다'; end if;
 end if;
 return new;
end $$;
create trigger check_repayment_link before insert or update on public.repayment_links for each row execute function private.check_payment_link();
create trigger check_fixed_payment_link before insert or update on public.fixed_expense_records for each row execute function private.check_payment_link();
create function public.process_repayment_payment(p_household uuid,p_plan uuid,p_revision integer,p_row uuid,p_action text,p_payment uuid,p_date date default null,p_amount text default null,p_expense uuid default null,p_source uuid default null,p_transaction uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare plan public.repayment_plans; rows jsonb; r jsonb; payments jsonb; idx integer; tid uuid; d date; amount text; s jsonb;
begin
 perform private.authorize(p_household);
 select * into plan from public.repayment_plans where id=p_plan for update;
 if plan.id is null or plan.household_id<>p_household then raise exception '가계부 접근 권한이 없습니다'; end if;
 if p_revision is distinct from plan.revision then raise exception '다른 곳에서 변경되었습니다. 새로고침하세요'; end if;
 if p_action is null or p_action not in ('pay','link','unlink') or p_payment is null then raise exception '납부 요청을 확인하세요'; end if;
 select value, ordinality::integer-1 into r,idx from jsonb_array_elements(plan.rows) with ordinality where value->>'id'=p_row::text;
 if r is null then raise exception '회차가 존재하지 않습니다'; end if;
 payments:=r->'payments';
 if p_action='unlink' then
  if not exists(select 1 from public.repayment_links where plan_id=p_plan and row_id=p_row and payment_id=p_payment) then raise exception '연결된 납부 기록이 없습니다'; end if;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into payments from jsonb_array_elements(payments) where value->>'id'<>p_payment::text;
  delete from public.repayment_links where payment_id=p_payment and plan_id=p_plan;
 else
  if plan.archived then raise exception '보관된 계획입니다'; end if;
  if exists(select 1 from public.repayment_links l where l.plan_id=p_plan and l.row_id=p_row and not exists(
   select 1 from public.transactions t where t.id=l.transaction_id and not t.is_opening and t.transaction_date=(l.snapshot->>'date')::date
   and (select count(*) from public.transaction_lines where transaction_id=t.id)=2
   and exists(select 1 from public.transaction_lines where transaction_id=t.id and account_id=(l.snapshot->>'expense_account')::uuid and entry_type='DEBIT' and transaction_lines.amount::text=l.snapshot->>'amount')
   and exists(select 1 from public.transaction_lines where transaction_id=t.id and account_id=(l.snapshot->>'payment_account')::uuid and entry_type='CREDIT' and transaction_lines.amount::text=l.snapshot->>'amount')
  )) then raise exception '연결 거래가 변경되었거나 삭제되었습니다. 연결 해제 후 확인하세요'; end if;

  if exists(select 1 from public.repayment_links where payment_id=p_payment) or exists(select 1 from jsonb_array_elements(plan.rows) rr,jsonb_array_elements(rr->'payments') pp where pp->>'id'=p_payment::text) then raise exception '이미 처리한 납부입니다'; end if;
  if not exists(select 1 from public.accounts where id=p_expense and household_id=p_household and type='EXPENSE' and not is_archived) or not exists(select 1 from public.accounts where id=p_source and household_id=p_household and type='ASSET' and not is_archived) then raise exception '사용 가능한 지출 항목과 출금 자산을 선택하세요'; end if;
  if p_action='pay' then
   d:=p_date; amount:=p_amount;
   tid:=public.create_transaction(p_household,d,plan.name||' 변제금',jsonb_build_array(jsonb_build_object('account_id',p_expense,'entry_type','DEBIT','amount',amount),jsonb_build_object('account_id',p_source,'entry_type','CREDIT','amount',amount)),'개인회생 납부');
  else
   perform 1 from public.transactions where id=p_transaction and household_id=p_household for update;
   select t.transaction_date,l.amount::text into d,amount from public.transactions t join public.transaction_lines l on l.transaction_id=t.id where t.id=p_transaction and t.household_id=p_household and not t.is_opening and l.account_id=p_expense and l.entry_type='DEBIT' and (select count(*) from public.transaction_lines where transaction_id=t.id)=2 and exists(select 1 from public.transaction_lines where transaction_id=t.id and account_id=p_source and entry_type='CREDIT');
   if amount is null then raise exception '같은 지출 항목과 출금 자산의 거래를 선택하세요'; end if;
   tid:=p_transaction;
  end if;
  if d is null or d>(now() at time zone 'Asia/Seoul')::date or amount is null or amount !~ '^[1-9][0-9]*$' then raise exception '실제 납부일과 금액을 확인하세요'; end if;
  payments:=payments||jsonb_build_array(jsonb_build_object('id',p_payment,'date',d,'amount',amount));
  s:=jsonb_build_object('date',d,'amount',amount,'expense_account',p_expense,'payment_account',p_source);
  insert into public.repayment_links values(p_payment,p_plan,p_household,p_row,tid,s);
 end if;
 rows:=jsonb_set(plan.rows,array[idx::text,'payments'],payments);
 perform private.save_repayment_plan_base(p_household,p_plan,p_revision,plan.name,plan.note,rows,plan.archived);
 return tid;
end $$;
revoke all on function public.get_repayment_links(uuid), public.save_repayment_plan(uuid,uuid,integer,text,text,jsonb,boolean), public.process_repayment_payment(uuid,uuid,integer,uuid,text,uuid,date,text,uuid,uuid,uuid) from public,anon;
grant execute on function public.get_repayment_links(uuid), public.save_repayment_plan(uuid,uuid,integer,text,text,jsonb,boolean), public.process_repayment_payment(uuid,uuid,integer,uuid,text,uuid,date,text,uuid,uuid,uuid) to authenticated;
commit;
