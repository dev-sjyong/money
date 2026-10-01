begin;
alter table public.fixed_expenses add column deleted_at timestamptz;
create function public.delete_fixed_expense(p_household uuid,p_id uuid,p_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare f public.fixed_expenses;
begin
 perform private.authorize(p_household);
 select * into f from public.fixed_expenses where id=p_id for update;
 if f.id is null or f.household_id<>p_household then raise exception '가계부 접근 권한이 없습니다'; end if;
 if f.deleted_at is not null or p_revision is distinct from f.revision then raise exception '이미 삭제되었거나 변경된 항목입니다. 새로고침하세요'; end if;
 update public.fixed_expenses set deleted_at=clock_timestamp(),revision=revision+1 where id=p_id;
end $$;
create function private.reject_deleted_fixed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='fixed_expenses' then
  if old.deleted_at is not null then raise exception '삭제된 고정지출입니다'; end if;
 else
  if exists(select 1 from public.fixed_expenses where id=new.fixed_id and deleted_at is not null) then raise exception '삭제된 고정지출입니다'; end if;
 end if;
 return new;
end $$;
create trigger reject_deleted_template before update on public.fixed_expenses for each row execute function private.reject_deleted_fixed();
create trigger reject_deleted_rule before insert or update on public.fixed_expense_rules for each row execute function private.reject_deleted_fixed();
create trigger reject_deleted_record before insert or update on public.fixed_expense_records for each row execute function private.reject_deleted_fixed();
create or replace function public.fixed_expense_snapshot(p_household uuid,p_month date) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'templates',coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object('rules',(select jsonb_agg(to_jsonb(r)||jsonb_build_object('amount',r.amount::text) order by r.effective_month) from public.fixed_expense_rules r where r.fixed_id=f.id))) from public.fixed_expenses f where f.household_id=p_household and f.deleted_at is null),'[]'::jsonb),
 'records',coalesce((select jsonb_agg(to_jsonb(r)) from public.fixed_expense_records r where r.household_id=p_household and r.month=p_month),'[]'::jsonb),
 'linked_transactions',coalesce((select jsonb_agg(transaction_id) from public.fixed_expense_records where household_id=p_household and transaction_id is not null),'[]'::jsonb));
$$;
revoke all on function public.delete_fixed_expense(uuid,uuid,integer) from public,anon;
grant execute on function public.delete_fixed_expense(uuid,uuid,integer) to authenticated;
commit;
