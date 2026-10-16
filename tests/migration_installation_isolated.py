"""Validate migration installation against reconstructed live PUBLIC DDL, PG17.

Only a fresh, network-disabled disposable solash-readiness-* Docker container
is accepted. This does not restore production data or managed Supabase schemas.
"""
from pathlib import Path
import json
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
container = sys.argv[1] if len(sys.argv) == 2 else ""
if not container.startswith("solash-readiness-"):
    raise SystemExit("Refusing a container outside the solash-readiness-* namespace")


def docker(*args, input_text=None):
    return subprocess.run(["docker", *args], input=input_text, text=True,
                          capture_output=True, timeout=20)


network = docker("inspect", "-f", "{{.HostConfig.NetworkMode}}", container)
if network.returncode or network.stdout.strip() != "none":
    raise SystemExit("Refusing a container with networking enabled")

psql = ["docker", "exec", "-i", container, "psql", "-XqAt", "-U", "postgres",
        "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]


def sql(query):
    return subprocess.run(psql, input=query, text=True, capture_output=True, timeout=20)


def require(result, label):
    if result.returncode:
        raise AssertionError(label + ": " + result.stderr)
    print("PASS " + label)


empty = sql("select count(*) from pg_class where relnamespace='public'::regnamespace;")
if empty.returncode or empty.stdout.strip() != "0":
    raise SystemExit("Refusing to replace an existing public schema")
require(sql((root / "docs/audit/evidence/live-public-schema-fixture-20261016.sql").read_text()),
        "reconstructed live public schema installed")
require(sql("""
insert into public.clients (id,name,phone) values (1,'SYNTHETIC','000');
insert into public.appointments (client_id,service,appointment_date,start_time,duration,price,status)
values (1,'Synthetic','2024-01-01','10:00','1h',1,'Programata'),
       (1,'Synthetic','2024-01-01','10:30','1h',1,'Confirmata');
"""), "synthetic historical overlap seeded")

migrations = root / "supabase/migrations"
atomic = (migrations / "20261015_atomic_booking_guard.sql").read_text()
writer = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True)
writer.stdin.write("""
begin;
insert into public.appointments (client_id,service,appointment_date,start_time,duration,price,status)
values (1,'Synthetic overnight','2099-09-09','23:30','1h',1,'Programata');
select 'WRITER_READY';
select pg_sleep(1.5);
commit;
""")
writer.stdin.close()
if writer.stdout.readline().strip() != "WRITER_READY":
    raise AssertionError("Writer did not reach the concurrency barrier")
started = time.monotonic()
attempt = sql(atomic)
elapsed = time.monotonic() - started
writer.wait(timeout=10)
if writer.returncode or attempt.returncode == 0 or "Existing appointment extends past midnight" not in attempt.stderr or elapsed < 0.8:
    raise AssertionError("Migration failed to wait for and inspect the concurrent committed row")
print("PASS early migration lock sees concurrent overnight write and aborts")
rolled_back = sql("select to_regprocedure('public.solash_guard_duration_minutes(text)') is null;")
if rolled_back.stdout.strip() != "t":
    raise AssertionError("Failed migration left a function installed")
print("PASS failed installation rolled back completely")
require(sql("delete from public.appointments where appointment_date=date '2099-09-09';"),
        "overnight synthetic fixture removed")

lock_query = """
select json_build_object('relation_locks',(
  select json_agg(json_build_object('relation',relation::regclass::text,'mode',mode))
  from pg_locks where pid=pg_backend_pid() and relation in
    ('public.appointments'::regclass,'public.clients'::regclass)
));
"""
for file in ["20261015_atomic_booking_guard.sql", "20261015_protect_client_history.sql",
             "20261015_protect_appointment_history.sql"]:
    source = (migrations / file).read_text()
    result = sql(source.replace("\ncommit;", "\n" + lock_query + "\ncommit;"))
    require(result, file)
    print(json.dumps({"migration": file, "observed": json.loads(result.stdout.strip())}))

result = sql("""
insert into public.appointments (client_id,service,appointment_date,start_time,duration,price,status)
values (1,'Synthetic','2099-09-10','10:00','1h',1,'Programata');
""")
require(result, "active booking accepted after installation")
result = sql("""
insert into public.appointments (client_id,service,appointment_date,start_time,duration,price,status)
values (1,'Synthetic','2099-09-10','10:30','1h',1,'Programata');
""")
if result.returncode == 0 or "23P01" not in result.stderr:
    raise AssertionError("Final guard failed to reject overlap")
print("PASS final installed guard rejects overlap")
result = sql("delete from public.clients where id=1;")
if result.returncode == 0 or "23503" not in result.stderr:
    raise AssertionError("Final FK failed to preserve client history")
print("PASS final FK preserves history")
print("Installed schema remains in the disposable container for optional runtime guard tests.")
