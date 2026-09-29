"""Competing restores: exactly one active journal and one RESTORE audit. Disposable DB only."""
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
h = value(auth("select public.create_household('동시 복구 테스트');"))
try:
    a = value(auth(f"select id from public.accounts where household_id='{h}' and name='은행';"))
    e = value(auth(f"select id from public.accounts where household_id='{h}' and name='급여';"))
    lines = '[{"account_id":"'+a+'","entry_type":"DEBIT","amount":"1000"},{"account_id":"'+e+'","entry_type":"CREDIT","amount":"1000"}]'
    t = value(auth(f"select public.create_transaction('{h}','2026-09-29','동시복구','{lines}');"))
    version = value(auth(f"select updated_at from public.transactions where id='{t}';"))
    r = run(auth(f"select public.delete_transaction('{t}','{version}');")); assert r.returncode == 0, r.stderr
    deleted = value(auth(f"select deleted_at from public.transaction_trash where transaction_id='{t}';"))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: run(auth(f"select public.restore_transaction('{t}','{deleted}');")), range(2)))
    assert sum(r.returncode == 0 for r in results) == 1, [(r.returncode,r.stderr) for r in results]
    assert value(auth(f"select count(*) from public.transactions where id='{t}';")) == '1'
    assert value(auth(f"select balance from public.account_balances where account_id='{a}';")) == '1000'
    assert value(auth(f"select count(*) from public.transaction_history where transaction_id='{t}' and action='RESTORE';")) == '1'
    assert value(auth(f"select count(*) from public.transaction_trash where transaction_id='{t}';")) == '0'
    print('PASS: concurrent restores yield exactly one success, one journal, one RESTORE audit, and unchanged net amount')
finally:
    r = run(f"delete from public.transaction_history where household_id='{h}'; delete from public.transaction_trash where household_id='{h}'; delete from public.transactions where household_id='{h}'; delete from public.accounts where household_id='{h}'; delete from public.household_members where household_id='{h}'; delete from public.households where id='{h}'; delete from auth.users where id='{user}';")
    assert r.returncode == 0, r.stderr
