begin;
create table public.repayment_plans (
 id uuid primary key,
 household_id uuid not null references public.households(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 80),
 note text not null default '' check(length(note)<=2000),
 rows jsonb not null check(jsonb_typeof(rows)='array'),
 revision integer not null default 1,
 archived boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.repayment_plans enable row level security;
create policy read_repayment on public.repayment_plans for select to authenticated using(private.is_member(household_id));
revoke all on public.repayment_plans from public,anon,authenticated;
grant select on public.repayment_plans to authenticated;
create function public.get_repayment_plans(p_household uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(p) order by p.archived,p.name,p.id),'[]'::jsonb) from public.repayment_plans p where household_id=p_household;
$$;
create function public.save_repayment_plan(p_household uuid,p_id uuid,p_revision integer,p_name text,p_note text,p_rows jsonb,p_archived boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare r jsonb; payment jsonb; amount bigint; paid numeric; d date; existing public.repayment_plans; ids uuid[]:='{}'; dates date[]:='{}'; pids uuid[]:='{}'; rid uuid; pid uuid;
begin
 perform private.authorize(p_household);
 if p_id is null or p_revision is null or p_revision<0 or p_archived is null or p_name is null or length(trim(p_name)) not between 1 and 80 or p_note is null or length(p_note)>2000 then raise exception '계획 이름과 메모를 확인하세요'; end if;
 if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then raise exception '회차 목록이 필요합니다'; end if;
 if jsonb_array_length(p_rows) not between 1 and 600 then raise exception '1~600개 회차를 등록하세요'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  rid:=(r->>'id')::uuid; d:=(r->>'due_date')::date;
  if rid is null or rid=any(ids) or d is null or d=any(dates) or d not between date '1900-01-01' and date '2199-12-31' or to_char(d,'YYYY-MM-DD') is distinct from r->>'due_date' then raise exception '회차 ID와 납부일을 확인하세요'; end if;
  ids:=array_append(ids,rid); dates:=array_append(dates,d);
  if jsonb_typeof(r->'amount') is distinct from 'string' or (r->>'amount') !~ '^[1-9][0-9]*$' then raise exception '예정금액은 양의 정수 문자열이어야 합니다'; end if;
  amount:=(r->>'amount')::bigint; paid:=0;
  if jsonb_typeof(r->'payments') is distinct from 'array' then raise exception '실제 납부 목록이 필요합니다'; end if;
  if jsonb_array_length(r->'payments')>120 then raise exception '납부 기록은 회차당 최대 120개입니다'; end if;
  for payment in select value from jsonb_array_elements(r->'payments') loop
   pid:=(payment->>'id')::uuid; d:=(payment->>'date')::date;
   if pid is null or pid=any(pids) or d is null or d not between date '1900-01-01' and (now() at time zone 'Asia/Seoul')::date or to_char(d,'YYYY-MM-DD') is distinct from payment->>'date' then raise exception '실제 납부일과 기록 ID를 확인하세요'; end if;
   pids:=array_append(pids,pid);
   if jsonb_typeof(payment->'amount') is distinct from 'string' or (payment->>'amount') !~ '^[1-9][0-9]*$' then raise exception '납부금액은 양의 정수 문자열이어야 합니다'; end if;
   paid:=paid+(payment->>'amount')::bigint;
  end loop;
  if paid>amount then raise exception '납부액이 회차 예정액보다 큽니다'; end if;
 end loop;
 select * into existing from public.repayment_plans where id=p_id for update;
 if found then
  if existing.household_id<>p_household then raise exception '가계부 접근 권한이 없습니다'; end if;
  if existing.revision<>p_revision then raise exception '다른 곳에서 변경된 계획입니다. 새로고침 후 다시 입력하세요'; end if;
  update public.repayment_plans set name=trim(p_name),note=p_note,rows=p_rows,archived=p_archived,revision=revision+1,updated_at=clock_timestamp() where id=p_id;
 else
  if p_revision<>0 then raise exception '계획이 존재하지 않습니다'; end if;
  insert into public.repayment_plans(id,household_id,name,note,rows,archived) values(p_id,p_household,trim(p_name),p_note,p_rows,p_archived);
 end if;
end $$;
revoke all on function public.get_repayment_plans(uuid),public.save_repayment_plan(uuid,uuid,integer,text,text,jsonb,boolean) from public,anon;
grant execute on function public.get_repayment_plans(uuid),public.save_repayment_plan(uuid,uuid,integer,text,text,jsonb,boolean) to authenticated;
commit;
