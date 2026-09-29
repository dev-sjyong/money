-- PostgreSQL 15+. All monetary JSON values are strings; no cached balances.
begin;
create type public.account_type as enum ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE');
create type public.entry_type as enum ('DEBIT','CREDIT');
create type public.member_role as enum ('OWNER','MEMBER');
create table public.households (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 100),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.household_members (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id), role public.member_role not null,
 created_at timestamptz not null default now(), unique(household_id,user_id)
);
create unique index one_owner on public.household_members(household_id) where role='OWNER';
create index members_user on public.household_members(user_id,household_id);
create table public.accounts (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id), name text not null check(length(trim(name)) between 1 and 100),
 code text, type public.account_type not null, parent_account_id uuid references public.accounts(id),
 is_system boolean not null default false, is_archived boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,household_id), check(parent_account_id is distinct from id)
);
create index accounts_household on public.accounts(household_id);
create index accounts_parent on public.accounts(parent_account_id);
create table public.transactions (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id), transaction_date date not null,
 description text not null check(length(trim(description)) between 1 and 200), memo text check(length(memo)<=2000),
 created_by uuid not null references auth.users(id), is_opening boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default clock_timestamp()
);
create unique index one_opening on public.transactions(household_id) where is_opening;
create index transactions_date on public.transactions(household_id,transaction_date desc,id);
create table public.transaction_lines (
 id uuid primary key default gen_random_uuid(), transaction_id uuid not null references public.transactions(id) on delete cascade,
 account_id uuid not null references public.accounts(id), entry_type public.entry_type not null, amount bigint not null check(amount>0), memo text check(length(memo)<=2000), created_at timestamptz not null default now()
);
create index lines_transaction on public.transaction_lines(transaction_id);
create index lines_account on public.transaction_lines(account_id);
create table public.budgets (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id), account_id uuid not null,
 year int not null check(year between 1900 and 9999), month int not null check(month between 1 and 12), amount bigint not null check(amount>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(account_id,household_id) references public.accounts(id,household_id), unique(household_id,account_id,year,month)
);
create table public.household_invites (
 id uuid primary key default gen_random_uuid(), household_id uuid not null unique references public.households(id) on delete cascade,
 token uuid not null unique default gen_random_uuid(), expires_at timestamptz not null default now()+interval '24 hours'
);
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create function private.is_member(h uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.household_members where household_id=h and user_id=auth.uid())
$$;
create function private.is_owner(h uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.household_members where household_id=h and user_id=auth.uid() and role='OWNER')
$$;
-- Every mutation locks the same household row BEFORE authorization. Removal and writes cannot race.
create function private.authorize(h uuid, owner_only boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
 perform 1 from public.households where id=h for update;
 if not private.is_member(h) or (owner_only and not private.is_owner(h)) then raise exception '가계부 접근 권한이 없습니다'; end if;
end $$;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_lines enable row level security;
alter table public.budgets enable row level security;
alter table public.household_invites enable row level security;
create policy read_households on public.households for select to authenticated using(private.is_member(id));
create policy read_members on public.household_members for select to authenticated using(private.is_member(household_id));
create policy read_accounts on public.accounts for select to authenticated using(private.is_member(household_id));
create policy read_transactions on public.transactions for select to authenticated using(private.is_member(household_id));
create policy read_lines on public.transaction_lines for select to authenticated using(exists(select 1 from public.transactions t where t.id=transaction_id and private.is_member(t.household_id)));
create policy read_budgets on public.budgets for select to authenticated using(private.is_member(household_id));
create policy read_invites on public.household_invites for select to authenticated using(private.is_owner(household_id));

create function private.check_account() returns trigger language plpgsql set search_path='' as $$
declare p public.accounts;
begin
 if tg_op='UPDATE' and (new.household_id<>old.household_id or new.type<>old.type or new.is_system<>old.is_system) then raise exception '계정 유형과 소속은 변경할 수 없습니다'; end if;
 if new.parent_account_id is not null then
 select * into p from public.accounts where id=new.parent_account_id;
 if p.id is null or p.household_id<>new.household_id or p.type<>new.type then raise exception '부모 계정의 소속/유형이 다릅니다'; end if;
 if exists(with recursive ancestors as (select id,parent_account_id from public.accounts where id=new.parent_account_id union select a.id,a.parent_account_id from public.accounts a join ancestors b on a.id=b.parent_account_id) select 1 from ancestors where id=new.id) then raise exception '계정 순환은 허용되지 않습니다'; end if;
 end if;
 return new;
end $$;
create trigger account_hierarchy before insert or update on public.accounts for each row execute function private.check_account();
create function private.check_members() returns trigger language plpgsql set search_path='' as $$
begin
 perform 1 from public.households where id=new.household_id for update;
 if (select count(*) from public.household_members where household_id=new.household_id and id<>new.id)>=2 then raise exception '가계부는 최대 2명까지 사용할 수 있습니다'; end if;
 return new;
end $$;
create trigger member_limit before insert or update on public.household_members for each row execute function private.check_members();
create function private.check_journal() returns trigger language plpgsql set search_path='' as $$
declare tid uuid; hid uuid; n bigint; d numeric; c numeric;
begin
 if tg_table_name='transactions' then tid:=coalesce(new.id,old.id); else tid:=coalesce(new.transaction_id,old.transaction_id); end if;
 select household_id into hid from public.transactions where id=tid;
 if hid is null then return null; end if;
 select count(*),coalesce(sum(amount) filter(where entry_type='DEBIT'),0),coalesce(sum(amount) filter(where entry_type='CREDIT'),0) into n,d,c from public.transaction_lines where transaction_id=tid;
 if n<2 or d<>c or d=0 then raise exception '차변과 대변의 합계가 일치해야 합니다'; end if;
 if exists(select 1 from public.transaction_lines l join public.accounts a on a.id=l.account_id where l.transaction_id=tid and a.household_id<>hid) then raise exception '다른 가계부 계정은 사용할 수 없습니다'; end if;
 return null;
end $$;
create constraint trigger balanced_transaction after insert or update on public.transactions deferrable initially deferred for each row execute function private.check_journal();
create constraint trigger balanced_lines after insert or update or delete on public.transaction_lines deferrable initially deferred for each row execute function private.check_journal();

create function public.create_household(p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid; food uuid;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
 insert into public.households(name,created_by) values(trim(p_name),auth.uid()) returning id into h;
 insert into public.household_members(household_id,user_id,role) values(h,auth.uid(),'OWNER');
 insert into public.accounts(household_id,name,type,is_system) values(h,'기초순자산','EQUITY',true);
 insert into public.accounts(household_id,name,type) select h,n,t::public.account_type from (values ('현금','ASSET'),('은행','ASSET'),('신용카드','LIABILITY'),('대출','LIABILITY'),('급여','INCOME'),('상여','INCOME'),('이자수익','INCOME'),('기타수입','INCOME'),('주거비','EXPENSE'),('교통비','EXPENSE'),('통신비','EXPENSE'),('보험','EXPENSE'),('쇼핑','EXPENSE'),('의료','EXPENSE'),('취미','EXPENSE'),('여행','EXPENSE'),('술/모임','EXPENSE'),('기타지출','EXPENSE')) x(n,t);
 insert into public.accounts(household_id,name,type) values(h,'식비','EXPENSE') returning id into food;
 insert into public.accounts(household_id,name,type,parent_account_id) select h,n,'EXPENSE',food from unnest(array['장보기','외식','카페','배달']) n;
 return h;
end $$;
create function public.rename_household(p_household uuid,p_name text) returns void language plpgsql security definer set search_path='' as $$
begin perform private.authorize(p_household,true); update public.households set name=trim(p_name),updated_at=now() where id=p_household; end $$;
create function public.create_invite(p_household uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 perform private.authorize(p_household,true);
 if (select count(*) from public.household_members where household_id=p_household)>=2 then raise exception '이미 두 명이 사용 중입니다'; end if;
 insert into public.household_invites(household_id) values(p_household) on conflict(household_id) do update set token=gen_random_uuid(),expires_at=now()+interval '24 hours' returning token into v;
 return v;
end $$;
create function public.accept_invite(p_token uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
 select household_id into h from public.household_invites where token=p_token;
 if h is null then raise exception '유효하지 않은 초대입니다'; end if;
 perform 1 from public.households where id=h for update;
 if not exists(select 1 from public.household_invites where household_id=h and token=p_token and expires_at>now()) then raise exception '초대가 만료되었거나 사용되었습니다'; end if;
 insert into public.household_members(household_id,user_id,role) values(h,auth.uid(),'MEMBER');
 delete from public.household_invites where household_id=h;
 return h;
end $$;
create function public.remove_member(p_household uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform private.authorize(p_household,true); delete from public.household_members where household_id=p_household and user_id=p_user and role='MEMBER'; delete from public.household_invites where household_id=p_household; end $$;
create function public.save_account(p_household uuid,p_name text,p_type public.account_type,p_parent uuid default null,p_code text default null,p_id uuid default null,p_archived boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.accounts; result uuid;
begin
 perform private.authorize(p_household,true);
 if p_parent is not null and not exists(select 1 from public.accounts where id=p_parent and household_id=p_household and not is_archived) then raise exception '사용 가능한 부모 계정이 아닙니다'; end if;
 if p_id is null then
 insert into public.accounts(household_id,name,type,parent_account_id,code) values(p_household,trim(p_name),p_type,p_parent,p_code) returning id into result;
 else
 select * into a from public.accounts where id=p_id and household_id=p_household;
 if a.id is null then raise exception '계정을 찾을 수 없습니다'; end if;
 if a.is_system then raise exception '기초순자산 계정은 수정할 수 없습니다'; end if;
 if p_archived and exists(select 1 from public.accounts where parent_account_id=p_id and not is_archived) then raise exception '하위 계정을 먼저 보관하세요'; end if;
 update public.accounts set name=trim(p_name),type=p_type,parent_account_id=p_parent,code=p_code,is_archived=p_archived,updated_at=now() where id=p_id returning id into result;
 end if;
 return result;
end $$;

create function private.validate_lines(h uuid, lines jsonb) returns void language plpgsql set search_path='' as $$
declare x jsonb; d numeric:=0; c numeric:=0; v bigint;
begin
 if lines is null or jsonb_typeof(lines)<>'array' then raise exception '분개 배열이 필요합니다'; end if;
 if jsonb_array_length(lines)<2 or jsonb_array_length(lines)>100 then raise exception '분개는 2~100줄이어야 합니다'; end if;
 for x in select * from jsonb_array_elements(lines) loop
 if coalesce(x->>'amount','') !~ '^[1-9][0-9]*$' then raise exception '금액은 0보다 큰 정수여야 합니다'; end if;
 v:=(x->>'amount')::bigint;
 if not exists(select 1 from public.accounts where id=(x->>'account_id')::uuid and household_id=h and not is_archived) then raise exception '사용할 수 없는 계정입니다'; end if;
 if x->>'entry_type'='DEBIT' then d:=d+v; elsif x->>'entry_type'='CREDIT' then c:=c+v; else raise exception '분개 유형이 올바르지 않습니다'; end if;
 end loop;
 if d<>c then raise exception '차변과 대변의 합계가 일치해야 합니다'; end if;
end $$;
create function private.insert_lines(tid uuid, lines jsonb) returns void language sql set search_path='' as $$
 insert into public.transaction_lines(transaction_id,account_id,entry_type,amount,memo) select tid,(x->>'account_id')::uuid,(x->>'entry_type')::public.entry_type,(x->>'amount')::bigint,x->>'memo' from jsonb_array_elements(lines) x
$$;
create function public.create_transaction(p_household uuid,p_date date,p_description text,p_lines jsonb,p_memo text default null,p_id uuid default gen_random_uuid()) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform private.authorize(p_household);
 perform private.validate_lines(p_household,p_lines);
 insert into public.transactions(id,household_id,transaction_date,description,memo,created_by) values(p_id,p_household,p_date,trim(p_description),p_memo,auth.uid());
 perform private.insert_lines(p_id,p_lines);
 return p_id;
end $$;
create function public.update_transaction(p_id uuid,p_date date,p_description text,p_lines jsonb,p_expected_updated_at timestamptz,p_memo text default null) returns void language plpgsql security definer set search_path='' as $$
declare h uuid; t public.transactions;
begin
 select household_id into h from public.transactions where id=p_id;
 perform private.authorize(h);
 select * into t from public.transactions where id=p_id for update;
 if t.id is null or t.updated_at is distinct from p_expected_updated_at then raise exception '다른 사용자가 수정했습니다. 새로고침 후 다시 시도하세요'; end if;
 if t.is_opening and not private.is_owner(h) then raise exception '초기 자산은 소유자만 수정할 수 있습니다'; end if;
 perform private.validate_lines(h,p_lines);
 update public.transactions set transaction_date=p_date,description=trim(p_description),memo=p_memo,updated_at=clock_timestamp() where id=p_id;
 delete from public.transaction_lines where transaction_id=p_id;
 perform private.insert_lines(p_id,p_lines);
end $$;
create function public.delete_transaction(p_id uuid,p_expected_updated_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare h uuid; t public.transactions;
begin
 select household_id into h from public.transactions where id=p_id;
 perform private.authorize(h);
 select * into t from public.transactions where id=p_id for update;
 if t.id is null or t.updated_at is distinct from p_expected_updated_at then raise exception '거래가 변경되었습니다. 새로고침하세요'; end if;
 if not private.is_owner(h) then raise exception '거래 삭제는 소유자만 가능합니다'; end if;
 delete from public.transactions where id=p_id;
end $$;
create function public.create_opening(p_household uuid,p_date date,p_balances jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
 tid:=public.create_transaction(p_household,p_date,'초기 자산 및 부채',lines);
 update public.transactions set is_opening=true where id=tid;
 return tid;
end $$;
create function public.save_budget(p_household uuid,p_account uuid,p_year int,p_month int,p_amount text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.authorize(p_household);
 if not exists(select 1 from public.accounts where id=p_account and household_id=p_household and type='EXPENSE' and not is_archived) then raise exception '사용 가능한 비용 계정을 선택하세요'; end if;
 if p_amount !~ '^[1-9][0-9]*$' or p_amount is null then raise exception '양의 정수 금액을 입력하세요'; end if;
 insert into public.budgets(household_id,account_id,year,month,amount) values(p_household,p_account,p_year,p_month,p_amount::bigint)
 on conflict(household_id,account_id,year,month) do update set amount=excluded.amount,updated_at=now();
end $$;
create function public.delete_budget(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare h uuid;
begin select household_id into h from public.budgets where id=p_id; perform private.authorize(h); delete from public.budgets where id=p_id; end $$;

create view public.account_balances with(security_invoker=true) as
 select a.id account_id,a.household_id,a.name account_name,a.type account_type,
 coalesce(sum(case when (a.type in ('ASSET','EXPENSE') and l.entry_type='DEBIT') or (a.type in ('LIABILITY','EQUITY','INCOME') and l.entry_type='CREDIT') then l.amount::numeric else -l.amount::numeric end),0)::text balance
 from public.accounts a left join public.transaction_lines l on l.account_id=a.id group by a.id;
-- SECURITY INVOKER keeps RLS active, and JSON text amounts preserve BIGINT precision.
create function public.ledger_snapshot(p_household uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.name) from public.accounts a where a.household_id=p_household),'[]'::jsonb),
 'transactions',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(l)||jsonb_build_object('amount',l.amount::text) order by l.created_at,l.id) from public.transaction_lines l where l.transaction_id=t.id)) order by t.transaction_date desc,t.created_at desc) from public.transactions t where t.household_id=p_household),'[]'::jsonb),
 'budgets',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('amount',b.amount::text)) from public.budgets b where b.household_id=p_household),'[]'::jsonb),
 'members',coalesce((select jsonb_agg(to_jsonb(m)) from public.household_members m where m.household_id=p_household),'[]'::jsonb)
 )
$$;
-- Never expose direct table writes or private SECURITY DEFINER entry points.
revoke all on public.households,public.household_members,public.accounts,public.transactions,public.transaction_lines,public.budgets,public.household_invites,public.account_balances from anon,authenticated;
grant select on public.households,public.household_members,public.accounts,public.transactions,public.transaction_lines,public.budgets,public.household_invites,public.account_balances to authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_member(uuid),private.is_owner(uuid) to authenticated;
revoke execute on function public.create_household(text),public.rename_household(uuid,text),public.create_invite(uuid),public.accept_invite(uuid),public.remove_member(uuid,uuid),public.save_account(uuid,text,public.account_type,uuid,text,uuid,boolean),public.create_transaction(uuid,date,text,jsonb,text,uuid),public.update_transaction(uuid,date,text,jsonb,timestamptz,text),public.delete_transaction(uuid,timestamptz),public.create_opening(uuid,date,jsonb),public.save_budget(uuid,uuid,int,int,text),public.delete_budget(uuid),public.ledger_snapshot(uuid) from public,anon;
grant execute on function public.create_household(text),public.rename_household(uuid,text),public.create_invite(uuid),public.accept_invite(uuid),public.remove_member(uuid,uuid),public.save_account(uuid,text,public.account_type,uuid,text,uuid,boolean),public.create_transaction(uuid,date,text,jsonb,text,uuid),public.update_transaction(uuid,date,text,jsonb,timestamptz,text),public.delete_transaction(uuid,timestamptz),public.create_opening(uuid,date,jsonb),public.save_budget(uuid,uuid,int,int,text),public.delete_budget(uuid),public.ledger_snapshot(uuid) to authenticated;
commit;
