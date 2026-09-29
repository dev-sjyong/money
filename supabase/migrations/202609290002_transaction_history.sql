-- Apply AFTER 001. Existing RPC signatures and ledger queries stay compatible.
begin;
-- Take the same locks used by writers while introducing baseline history.
lock table public.households in access exclusive mode;
create table public.transaction_history (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id),
  transaction_id uuid not null,
  action text not null check (action in ('BASELINE','CREATE','UPDATE','DELETE','RESTORE')),
  actor_id uuid references auth.users(id),
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check (before_snapshot is not null or after_snapshot is not null)
);
create index transaction_history_lookup on public.transaction_history(household_id,transaction_id,id desc);
-- No FK to transactions: these records must survive removal from the active ledger.
create table public.transaction_trash (
  transaction_id uuid primary key,
  household_id uuid not null references public.households(id),
  snapshot jsonb not null,
  deleted_by uuid not null references auth.users(id),
  deleted_at timestamptz not null default clock_timestamp()
);
create index transaction_trash_household on public.transaction_trash(household_id,deleted_at desc);
alter table public.transaction_history enable row level security;
alter table public.transaction_trash enable row level security;
create policy read_history on public.transaction_history for select to authenticated
  using (private.is_member(household_id));
create policy read_trash on public.transaction_trash for select to authenticated
  using (private.is_owner(household_id));
revoke all on public.transaction_history,public.transaction_trash from anon,authenticated;
revoke all on sequence public.transaction_history_id_seq from anon,authenticated;
grant select on public.transaction_history,public.transaction_trash to authenticated;

create function private.transaction_snapshot(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select to_jsonb(t) || jsonb_build_object('lines',
    (select jsonb_agg(to_jsonb(l) || jsonb_build_object('amount',l.amount::text,'account_name',a.name)
      order by l.created_at,l.id)
     from public.transaction_lines l join public.accounts a on a.id=l.account_id
     where l.transaction_id=t.id))
  from public.transactions t where t.id=p_id
$$;
-- Baseline is the state at migration, not fabricated historical edits or actors.
insert into public.transaction_history(household_id,transaction_id,action,after_snapshot)
select t.household_id,t.id,'BASELINE',private.transaction_snapshot(t.id) from public.transactions t;

create or replace function public.create_transaction(
  p_household uuid,p_date date,p_description text,p_lines jsonb,
  p_memo text default null,p_id uuid default gen_random_uuid()
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform private.authorize(p_household);
  -- Retired IDs belong to the original history. New entries must use a new ID.
  if exists(select 1 from public.transaction_history where transaction_id=p_id) then
    raise exception '이미 사용한 거래 ID입니다. 거래 목록을 확인하세요';
  end if;
  perform private.validate_lines(p_household,p_lines);
  insert into public.transactions(id,household_id,transaction_date,description,memo,created_by)
  values(p_id,p_household,p_date,trim(p_description),p_memo,auth.uid());
  perform private.insert_lines(p_id,p_lines);
  insert into public.transaction_history(household_id,transaction_id,action,actor_id,after_snapshot)
  values(p_household,p_id,'CREATE',auth.uid(),private.transaction_snapshot(p_id));
  return p_id;
end $$;

create or replace function public.update_transaction(
  p_id uuid,p_date date,p_description text,p_lines jsonb,
  p_expected_updated_at timestamptz,p_memo text default null
) returns void language plpgsql security definer set search_path='' as $$
declare h uuid; t public.transactions; before_state jsonb;
begin
  select household_id into h from public.transactions where id=p_id;
  perform private.authorize(h);
  select * into t from public.transactions where id=p_id for update;
  if t.id is null or t.updated_at is distinct from p_expected_updated_at then
    raise exception '다른 사용자가 수정했습니다. 새로고침 후 다시 시도하세요';
  end if;
  if t.is_opening and not private.is_owner(h) then
    raise exception '초기 자산은 소유자만 수정할 수 있습니다';
  end if;
  perform private.validate_lines(h,p_lines);
  before_state:=private.transaction_snapshot(p_id);
  update public.transactions set transaction_date=p_date,description=trim(p_description),
    memo=p_memo,updated_at=clock_timestamp() where id=p_id;
  delete from public.transaction_lines where transaction_id=p_id;
  perform private.insert_lines(p_id,p_lines);
  insert into public.transaction_history(household_id,transaction_id,action,actor_id,before_snapshot,after_snapshot)
  values(h,p_id,'UPDATE',auth.uid(),before_state,private.transaction_snapshot(p_id));
end $$;

create or replace function public.delete_transaction(p_id uuid,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare h uuid; t public.transactions; before_state jsonb;
begin
  select household_id into h from public.transactions where id=p_id;
  perform private.authorize(h,true);
  select * into t from public.transactions where id=p_id for update;
  if t.id is null or t.updated_at is distinct from p_expected_updated_at then
    raise exception '거래가 변경되었습니다. 새로고침하세요';
  end if;
  before_state:=private.transaction_snapshot(p_id);
  insert into public.transaction_trash(transaction_id,household_id,snapshot,deleted_by)
  values(p_id,h,before_state,auth.uid());
  insert into public.transaction_history(household_id,transaction_id,action,actor_id,before_snapshot)
  values(h,p_id,'DELETE',auth.uid(),before_state);
  -- Removing active lines keeps ALL existing balances/budgets/reports consistent.
  delete from public.transactions where id=p_id;
end $$;

create function public.restore_transaction(p_id uuid,p_expected_deleted_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid; trash public.transaction_trash; s jsonb;
begin
  select household_id into h from public.transaction_trash where transaction_id=p_id;
  perform private.authorize(h,true);
  select * into trash from public.transaction_trash where transaction_id=p_id for update;
  if trash.transaction_id is null or trash.deleted_at is distinct from p_expected_deleted_at then
    raise exception '휴지통이 변경되었습니다. 새로고침하세요';
  end if;
  s:=trash.snapshot;
  if exists(select 1 from public.transactions where id=p_id) then
    raise exception '이미 복구된 거래입니다';
  end if;
  if (s->>'is_opening')::boolean and exists(
    select 1 from public.transactions where household_id=h and is_opening
  ) then raise exception '다른 초기 자산 거래가 있습니다. 기존 초기 거래를 먼저 확인하세요'; end if;
  -- Archived accounts must be unarchived explicitly before restoring the journal.
  perform private.validate_lines(h,s->'lines');
  insert into public.transactions(id,household_id,transaction_date,description,memo,
    created_by,is_opening,created_at,updated_at)
  values(p_id,h,(s->>'transaction_date')::date,s->>'description',s->>'memo',
    (s->>'created_by')::uuid,(s->>'is_opening')::boolean,
    (s->>'created_at')::timestamptz,clock_timestamp());
  -- Preserve line IDs and their original timestamps as well as amounts and memos.
  insert into public.transaction_lines(id,transaction_id,account_id,entry_type,amount,memo,created_at)
  select (x->>'id')::uuid,p_id,(x->>'account_id')::uuid,
    (x->>'entry_type')::public.entry_type,(x->>'amount')::bigint,x->>'memo',
    (x->>'created_at')::timestamptz from jsonb_array_elements(s->'lines') x;
  insert into public.transaction_history(household_id,transaction_id,action,actor_id,before_snapshot,after_snapshot)
  values(h,p_id,'RESTORE',auth.uid(),s,private.transaction_snapshot(p_id));
  delete from public.transaction_trash where transaction_id=p_id;
  return p_id;
end $$;

create function public.get_transaction_history(p_household uuid,p_transaction uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(h)||jsonb_build_object('id',h.id::text) order by h.id desc),'[]'::jsonb)
  from public.transaction_history h where h.household_id=p_household and h.transaction_id=p_transaction
$$;
create function public.get_transaction_trash(p_household uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.deleted_at desc),'[]'::jsonb)
  from public.transaction_trash t where t.household_id=p_household
$$;

-- Replace the opening RPC so its CREATE audit captures the final is_opening=true state.
create or replace function public.create_opening(p_household uuid,p_date date,p_balances jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare x jsonb; a public.accounts; eq uuid; lines jsonb:='[]'; delta numeric:=0; v bigint; tid uuid;
begin
 perform private.authorize(p_household,true);
 if jsonb_typeof(p_balances) is distinct from 'array' or jsonb_array_length(p_balances)=0 then raise exception '초기 자산 또는 부채를 입력하세요'; end if;
 if exists(select 1 from public.transactions where household_id=p_household and is_opening) then raise exception '초기 자산은 이미 등록되었습니다'; end if;
 if exists(select 1 from jsonb_array_elements(p_balances) as items(item) group by item->>'account_id' having count(*)>1) then raise exception '중복 계정입니다'; end if;
 for x in select * from jsonb_array_elements(p_balances) loop
 select * into a from public.accounts where id=(x->>'account_id')::uuid and household_id=p_household and type in ('ASSET','LIABILITY') and not is_archived;
 if a.id is null or coalesce(x->>'amount','') !~ '^[1-9][0-9]*$' then raise exception '초기 계정/금액을 확인하세요'; end if;
 v:=(x->>'amount')::bigint;
 delta:=delta+case when a.type='ASSET' then v else -v end;
 lines:=lines||jsonb_build_array(jsonb_build_object('account_id',a.id,'entry_type',case when a.type='ASSET' then 'DEBIT' else 'CREDIT' end,'amount',v::text));
 end loop;
 select id into eq from public.accounts where household_id=p_household and is_system and type='EQUITY';
 if delta<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account_id',eq,'entry_type',case when delta>0 then 'CREDIT' else 'DEBIT' end,'amount',abs(delta)::text)); end if;
 perform private.validate_lines(p_household,lines);
 insert into public.transactions(household_id,transaction_date,description,created_by,is_opening)
 values(p_household,p_date,'초기 자산 및 부채',auth.uid(),true) returning id into tid;
 perform private.insert_lines(tid,lines);
 insert into public.transaction_history(household_id,transaction_id,action,actor_id,after_snapshot)
 values(p_household,tid,'CREATE',auth.uid(),private.transaction_snapshot(tid));
 return tid;
end $$;

revoke execute on function private.transaction_snapshot(uuid) from public,anon,authenticated;
revoke execute on function public.restore_transaction(uuid,timestamptz),
  public.get_transaction_history(uuid,uuid),public.get_transaction_trash(uuid) from public,anon;
grant execute on function public.restore_transaction(uuid,timestamptz),
  public.get_transaction_history(uuid,uuid),public.get_transaction_trash(uuid) to authenticated;
commit;
