"""Competing schedule updates preserve optimistic locking. Disposable DB only."""
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
h = value(auth("select public.create_household('변제 동시 수정 테스트');"))
try:
    plan = str(uuid.uuid4())
    row = str(uuid.uuid4())
    schedule = '[{"id":"'+row+'","due_date":"2027-01-25","amount":"500000","payments":[]}]'
    r = run(auth(f"select public.save_repayment_plan('{h}','{plan}',0,'본인','','{schedule}',false);"))
    assert r.returncode == 0, r.stderr
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda i: run(auth(f"select public.save_repayment_plan('{h}','{plan}',1,'수정 {i}','','{schedule}',false);")), range(2)))
    assert sum(r.returncode == 0 for r in results) == 1, [(r.returncode,r.stderr) for r in results]
    assert value(auth(f"select revision from public.repayment_plans where id='{plan}';")) == '2'
    assert value(auth(f"select count(*) from public.transactions where household_id='{h}';")) == '0'
    print('PASS: simultaneous edits yield one success, revision 2, no ledger mutations')
finally:
    r = run(f"delete from public.repayment_plans where household_id='{h}'; delete from public.accounts where household_id='{h}'; delete from public.household_members where household_id='{h}'; delete from public.households where id='{h}'; delete from auth.users where id='{user}';")
    assert r.returncode == 0, r.stderr
