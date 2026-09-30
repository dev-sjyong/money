"""Concurrent fixed-expense confirmation creates exactly one transaction. Disposable DB only."""
import os
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor

url = os.environ['TEST_DATABASE_URL']
user = str(uuid.uuid4())
def run(sql):
    return subprocess.run(['psql', url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
def auth(sql):
    return f"set role authenticated; select set_config('request.jwt.claim.sub','{user}',false); {sql}"
def value(sql):
    r = run(sql)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip().splitlines()[-1]

value(f"insert into auth.users values('{user}'); select 1;")
h = value(auth("select public.create_household('고정지출 동시 처리 테스트');"))
try:
    fixed = str(uuid.uuid4())
    bank = value(auth(f"select id from public.accounts where household_id='{h}' and name='은행';"))
    expense = value(auth(f"select id from public.accounts where household_id='{h}' and name='외식';"))
    month = value("select date_trunc('month',now() at time zone 'Asia/Seoul')::date;")
    r = run(auth(f"select public.save_fixed_expense('{h}','{fixed}',0,'{month}','통신비','50000',25,'{expense}','{bank}');"))
    assert r.returncode == 0, r.stderr
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: run(auth(f"select public.process_fixed_expense('{h}','{fixed}','{month}',1,0,'pay','2020-01-01','49000');")), range(2)))
    assert sum(r.returncode == 0 for r in results) == 1, [(r.returncode,r.stderr) for r in results]
    assert value(auth(f"select count(*) from public.transactions where household_id='{h}';")) == '1'
    assert value(auth(f"select count(*) from public.transaction_history where household_id='{h}' and action='CREATE';")) == '1'
    assert value(auth(f"select count(*) from public.fixed_expense_records where fixed_id='{fixed}' and transaction_id is not null;")) == '1'
    assert value(auth(f"select balance from public.account_balances where account_id='{bank}';")) == '-49000'
    print('PASS: concurrent confirmations create one transaction, one history record, one monthly link and one bank debit')
finally:
    r = run(f"delete from public.fixed_expenses where household_id='{h}'; delete from public.transaction_history where household_id='{h}'; delete from public.transactions where household_id='{h}'; delete from public.accounts where household_id='{h}'; delete from public.household_members where household_id='{h}'; delete from public.households where id='{h}'; delete from auth.users where id='{user}';")
    assert r.returncode == 0, r.stderr
