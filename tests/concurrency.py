"""Real PostgreSQL concurrent invite test. Requires TEST_DATABASE_URL, psql, Python 3."""
import os
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor

url = os.environ['TEST_DATABASE_URL']
users = [str(uuid.uuid4()) for _ in range(3)]

def run(sql):
    return subprocess.run(['psql', url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)

def auth(user, sql):
    return f"set role authenticated; select set_config('request.jwt.claim.sub','{user}',false); {sql}"

r = run('insert into auth.users(id) values '+','.join(f"('{u}')" for u in users))
assert r.returncode == 0, r.stderr
r = run(auth(users[0], "select public.create_household('동시 초대 검증');"))
assert r.returncode == 0, r.stderr
h = r.stdout.strip().splitlines()[-1]
try:
    r = run(auth(users[0], f"select public.create_invite('{h}');"))
    assert r.returncode == 0, r.stderr
    token = r.stdout.strip().splitlines()[-1]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda u: run(auth(u, f"select public.accept_invite('{token}');")), users[1:]))
    assert sum(r.returncode == 0 for r in results) == 1, [(r.returncode, r.stderr) for r in results]
    r = run(f"select count(*) from public.household_members where household_id='{h}';")
    assert r.stdout.strip() == '2', r.stdout
    print('PASS: two concurrent invite acceptances yield exactly one success and two total members')
    loser = next(u for u, result in zip(users[1:], results) if result.returncode != 0)
    r = run(f"insert into public.household_members(household_id,user_id,role) values('{h}','{loser}','MEMBER');")
    assert r.returncode != 0 and '최대 2명' in r.stderr, r.stderr
    print('PASS: member-limit trigger also rejects privileged third-member insertion')
finally:
    r = run(f"delete from public.household_invites where household_id='{h}'; delete from public.accounts where household_id='{h}'; delete from public.household_members where household_id='{h}'; delete from public.households where id='{h}'; delete from auth.users where id in ("+','.join(f"'{u}'" for u in users)+');')
    assert r.returncode == 0, r.stderr
