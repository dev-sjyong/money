begin;
create table public.fixed_expenses (
 id uuid primary key, household_id uuid not null references public.households(id) on delete cascade,
 revision integer not null default 1 check(revision>0)
);
create table public.fixed_expense_rules (
 fixed_id uuid not null references public.fixed_expenses(id) on delete cascade,
 household_id uuid not null references public.households(id) on delete cascade,
 effective_month date not null check(extract(day from effective_month)=1),
 title text not null check(length(trim(title)) between 1 and 100), amount bigint not null check(amount>0),
 due_day integer not null check(due_day between 1 and 31),
 expense_account uuid not null references public.accounts(id), payment_account uuid not null references public.accounts(id),
 end_month date check(extract(day from end_month)=1 and end_month>=effective_month), active boolean not null default true,
 primary key(fixed_id,effective_month)
);
create table public.fixed_expense_records (
 fixed_id uuid not null references public.fixed_expenses(id) on delete cascade,
 household_id uuid not null references public.households(id) on delete cascade,
 month date not null check(extract(day from month)=1), snapshot jsonb not null,
 transaction_id uuid unique, -- Retain identity across deletion/restoration.
 skipped boolean not null default false, revision integer not null default 1,
 check(not(skipped and transaction_id is not null)), primary key(fixed_id,month)
);
alter table public.fixed_expenses enable row level security;
alter table public.fixed_expense_rules enable row level security;
alter table public.fixed_expense_records enable row level security;
create policy read_fixed on public.fixed_expenses for select to authenticated using(private.is_member(household_id));
create policy read_fixed_rules on public.fixed_expense_rules for select to authenticated using(private.is_member(household_id));
create policy read_fixed_records on public.fixed_expense_records for select to authenticated using(private.is_member(household_id));
revoke all on public.fixed_expenses,public.fixed_expense_rules,public.fixed_expense_records from public,anon,authenticated;
grant select on public.fixed_expenses,public.fixed_expense_rules,public.fixed_expense_records to authenticated;
create function public.fixed_expense_snapshot(p_household uuid,p_month date) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'templates',coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object('rules',(select jsonb_agg(to_jsonb(r)||jsonb_build_object('amount',r.amount::text) order by r.effective_month) from public.fixed_expense_rules r where r.fixed_id=f.id))) from public.fixed_expenses f where f.household_id=p_household),'[]'::jsonb),
 'records',coalesce((select jsonb_agg(to_jsonb(r)) from public.fixed_expense_records r where r.household_id=p_household and r.month=p_month),'[]'::jsonb),
 'linked_transactions',coalesce((select jsonb_agg(transaction_id) from public.fixed_expense_records where household_id=p_household and transaction_id is not null),'[]'::jsonb));
$$;
create function public.save_fixed_expense(p_household uuid,p_id uuid,p_revision integer,p_effective_month date,p_title text,p_amount text,p_due_day integer,p_expense_account uuid,p_payment_account uuid,p_end_month date default null,p_active boolean default true)
returns void language plpgsql security definer set search_path='' as $$
declare existing public.fixed_expenses; first_month date;
begin
 perform private.authorize(p_household);
 if p_id is null or p_revision is null or p_revision<0 or p_active is null or p_title is null or length(trim(p_title)) not between 1 and 100 or p_due_day is null or p_due_day not between 1 and 31 then raise exception '이름과 납부일을 확인하세요'; end if;
 if p_effective_month is null or p_effective_month not between date '1900-01-01' and date '2199-12-01' or extract(day from p_effective_month)<>1 or (p_end_month is not null and (p_end_month<p_effective_month or p_end_month>date '2199-12-01' or extract(day from p_end_month)<>1)) then raise exception '적용 월과 종료 월을 확인하세요'; end if;
 if p_amount is null or p_amount !~ '^[1-9][0-9]*$' or p_amount::numeric>9223372036854775807 then raise exception '예상 금액은 양의 정수로 입력하세요'; end if;
 if not exists(select 1 from public.accounts where id=p_expense_account and household_id=p_household and type='EXPENSE' and (not p_active or not is_archived)) or not exists(select 1 from public.accounts where id=p_payment_account and household_id=p_household and type in ('ASSET','LIABILITY') and (not p_active or not is_archived)) then raise exception '사용 가능한 지출/결제 계정을 선택하세요'; end if;
 select * into existing from public.fixed_expenses where id=p_id for update;
 if found then
  if existing.household_id<>p_household then raise exception '가계부 접근 권한이 없습니다'; end if;
  if existing.revision<>p_revision then raise exception '다른 곳에서 항목이 변경되었습니다. 새로고침하세요'; end if;
  select min(effective_month) into first_month from public.fixed_expense_rules where fixed_id=p_id;
  if p_effective_month<date_trunc('month',now() at time zone 'Asia/Seoul')::date or p_effective_month<first_month then raise exception '기존 항목 변경은 이번 달 이후, 최초 시작 월 이후로 적용하세요'; end if;
  update public.fixed_expenses set revision=revision+1 where id=p_id;
 else
  if p_revision<>0 then raise exception '항목이 존재하지 않습니다'; end if;
  insert into public.fixed_expenses(id,household_id) values(p_id,p_household);
 end if;
 insert into public.fixed_expense_rules(fixed_id,household_id,effective_month,title,amount,due_day,expense_account,payment_account,end_month,active)
 values(p_id,p_household,p_effective_month,trim(p_title),p_amount::bigint,p_due_day,p_expense_account,p_payment_account,p_end_month,p_active)
 on conflict(fixed_id,effective_month) do update set title=excluded.title,amount=excluded.amount,due_day=excluded.due_day,expense_account=excluded.expense_account,payment_account=excluded.payment_account,end_month=excluded.end_month,active=excluded.active;
end $$;
create function public.process_fixed_expense(p_household uuid,p_id uuid,p_month date,p_template_revision integer,p_record_revision integer,p_action text,p_date date default null,p_amount text default null,p_transaction uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare f public.fixed_expenses; r public.fixed_expense_rules; rec public.fixed_expense_records; s jsonb; tid uuid; due date;
begin
 perform private.authorize(p_household);
 if p_month is null or extract(day from p_month)<>1 or p_month not between date '1900-01-01' and date '2199-12-01' or p_action is null or p_action not in ('pay','link','skip','reset') or p_record_revision is null or p_template_revision is null then raise exception '처리 요청을 확인하세요'; end if;
 select * into f from public.fixed_expenses where id=p_id for update;
 if f.id is null or f.household_id<>p_household then raise exception '가계부 접근 권한이 없습니다'; end if;
 if f.revision<>p_template_revision then raise exception '고정지출 규칙이 변경되었습니다. 새로고침하세요'; end if;
 select * into rec from public.fixed_expense_records where fixed_id=p_id and month=p_month for update;
 if coalesce(rec.revision,0)<>p_record_revision then raise exception '이미 처리되었거나 다른 곳에서 변경되었습니다. 새로고침하세요'; end if;
 if rec.fixed_id is not null then s:=rec.snapshot;
 else
  select * into r from public.fixed_expense_rules where fixed_id=p_id and effective_month<=p_month order by effective_month desc limit 1;
  if r.fixed_id is null or not r.active or (r.end_month is not null and r.end_month<p_month) then raise exception '이 달에 적용되는 항목이 없습니다'; end if;
  due:=p_month+(least(r.due_day,extract(day from (p_month+interval '1 month - 1 day'))::integer)-1);
  s:=jsonb_build_object('title',r.title,'amount',r.amount::text,'due_date',due,'expense_account',r.expense_account,'payment_account',r.payment_account);
 end if;
 if p_action<>'reset' and (rec.transaction_id is not null or coalesce(rec.skipped,false)) then raise exception '이미 처리한 항목입니다. 처리 취소 후 다시 진행하세요'; end if;
 if p_action='reset' and rec.fixed_id is null then raise exception '취소할 처리 내역이 없습니다'; end if;
 if p_action='pay' then
  if p_date is null or p_date not between date '1900-01-01' and (now() at time zone 'Asia/Seoul')::date or p_amount is null or p_amount !~ '^[1-9][0-9]*$' or p_amount::numeric>9223372036854775807 then raise exception '실제 납부일과 금액을 확인하세요'; end if;
  tid:=public.create_transaction(p_household,p_date,s->>'title',jsonb_build_array(jsonb_build_object('account_id',s->>'expense_account','entry_type','DEBIT','amount',p_amount),jsonb_build_object('account_id',s->>'payment_account','entry_type','CREDIT','amount',p_amount)),'고정지출 '||to_char(p_month,'YYYY-MM'));
 elsif p_action='link' then
  if not exists(select 1 from public.transactions t where t.id=p_transaction and t.household_id=p_household and not t.is_opening and t.transaction_date<=(now() at time zone 'Asia/Seoul')::date
    and (select count(*) from public.transaction_lines l where l.transaction_id=t.id)=2
    and exists(select 1 from public.transaction_lines l where l.transaction_id=t.id and l.account_id=(s->>'expense_account')::uuid and l.entry_type='DEBIT')
    and exists(select 1 from public.transaction_lines l where l.transaction_id=t.id and l.account_id=(s->>'payment_account')::uuid and l.entry_type='CREDIT')) then raise exception '같은 지출/결제 계정의 단순 지출 거래를 선택하세요'; end if;
  if exists(select 1 from public.fixed_expense_records where transaction_id=p_transaction) then raise exception '이미 다른 고정지출에 연결된 거래입니다'; end if;
  tid:=p_transaction;
 end if;
 insert into public.fixed_expense_records(fixed_id,household_id,month,snapshot,transaction_id,skipped,revision)
 values(p_id,p_household,p_month,s,tid,p_action='skip',1)
 on conflict(fixed_id,month) do update set transaction_id=excluded.transaction_id,skipped=excluded.skipped,revision=fixed_expense_records.revision+1;
 return tid;
end $$;
revoke all on function public.fixed_expense_snapshot(uuid,date),public.save_fixed_expense(uuid,uuid,integer,date,text,text,integer,uuid,uuid,date,boolean),public.process_fixed_expense(uuid,uuid,date,integer,integer,text,date,text,uuid) from public,anon;
grant execute on function public.fixed_expense_snapshot(uuid,date),public.save_fixed_expense(uuid,uuid,integer,date,text,text,integer,uuid,uuid,date,boolean),public.process_fixed_expense(uuid,uuid,date,integer,integer,text,date,text,uuid) to authenticated;
commit;
