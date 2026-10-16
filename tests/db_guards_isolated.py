"""Exercise proposed SQL guards in an isolated, network-disabled Docker Postgres.

Run only against a disposable solash-restore-* or solash-readiness-* container
after loading the snapshot/schema fixture and proposed migrations. Synthetic
rows are removed on completion.
"""

import subprocess
import sys
import time


container = sys.argv[1] if len(sys.argv) == 2 else ""
if not container.startswith(("solash-restore-", "solash-readiness-")):
    raise SystemExit("Refusing a container without an isolated test prefix")


def docker(*args, input_text=None):
    return subprocess.run(
        ["docker", *args], input=input_text, text=True, capture_output=True, check=False
    )


network = docker("inspect", "-f", "{{.HostConfig.NetworkMode}}", container)
if network.returncode or network.stdout.strip() != "none":
    raise SystemExit("Refusing a container with networking enabled")


def sql(statement):
    return docker(
        "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres",
        "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", input_text=statement
    )


def check(label, statement, expected_code=None):
    result = sql("begin;\n" + statement + "\nrollback;\n")
    passed = (
        result.returncode == 0 if expected_code is None
        else result.returncode != 0 and expected_code in result.stderr
    )
    print(f"{'PASS' if passed else 'FAIL'} {label}")
    if not passed:
        raise AssertionError(f"{label}: unexpected database result")


client_id = 900000001
date = "2099-09-08"


def booking(start, duration="1h", status="Programata", service="Synthetic booking"):
    return (
        "insert into public.appointments"
        " (client_id, service, appointment_date, start_time, duration, price, status)"
        f" values ({client_id}, '{service}', '{date}', '{start}', '{duration}', 1, '{status}');"
    )


setup = sql(
    f"insert into public.clients (id, name, phone) "
    f"values ({client_id}, 'ISOLATED TEST', '000');"
)
if setup.returncode:
    raise SystemExit("Could not create synthetic client in isolated database")

try:
    check("active overlap rejected", booking("09:00") + booking("09:30"), "23P01")
    check("adjacent appointments accepted", booking("09:00") + booking("10:00"))
    check("sub-minute overlap rejected", booking("09:00:30", "30min") + booking("09:30", "30min"), "23P01")
    check("sub-minute adjacency accepted", booking("09:00:30", "30min") + booking("09:30:30", "30min"))
    check("cancelled slot reusable", booking("11:00", status="Anulata") + booking("11:00"))
    check("cancelled to active conflict rejected", booking("11:00") + booking("11:00", status="Anulata") + "update public.appointments set status='Programata' where client_id=900000001 and appointment_date='2099-09-08' and status='Anulata';", "23P01")
    check("personal block prevents overlap", booking("12:00", service="Blocaj personal") + booking("12:30"), "23P01")
    check("self edit accepted", booking("13:00") + "update public.appointments set start_time='13:00' where client_id=900000001 and appointment_date='2099-09-08' and start_time='13:00';")
    check("reschedule into occupied slot rejected", booking("14:00") + booking("16:00") + "update public.appointments set start_time='14:30' where client_id=900000001 and appointment_date='2099-09-08' and start_time='16:00';", "23P01")
    check("invalid duration rejected", booking("17:00", duration="nonsense"), "22023")
    check("out-of-hours authorized application override remains possible", booking("23:00", duration="30min"))
    check("client deletion with history rejected", booking("18:00") + f"delete from public.clients where id={client_id};", "23503")
    check("client deletion with cancelled history rejected", booking("18:00", status="Anulata") + f"delete from public.clients where id={client_id};", "23503")

    check("active status change on historical overlap accepted", """
do $$
declare target_id bigint;
begin
  select a.id into target_id
  from public.appointments a
  join public.appointments b on a.appointment_date = b.appointment_date and a.id < b.id
  where a.appointment_date < date '2099-09-08'
    and a.status <> 'Anulata' and b.status <> 'Anulata'
    and extract(epoch from a.start_time) < extract(epoch from b.start_time)
        + 60 * public.solash_guard_duration_minutes(b.duration)
    and extract(epoch from b.start_time) < extract(epoch from a.start_time)
        + 60 * public.solash_guard_duration_minutes(a.duration)
  limit 1;
  if target_id is null then
    raise exception 'Expected historical overlap missing from verified snapshot';
  end if;
  update public.appointments
    set status = case when status = 'Programata' then 'Confirmata' else 'Programata' end
    where id = target_id;
end;
$$;
""")

    check("authenticated cannot delete customer appointment", booking("20:00") + """
set role authenticated;
do $$
declare removed integer;
begin
  delete from public.appointments
    where client_id = 900000001 and appointment_date = date '2099-09-08';
  get diagnostics removed = row_count;
  if removed <> 0 then
    raise exception 'Customer appointment was deleted by authenticated role';
  end if;
end;
$$;
reset role;
""")
    check("authenticated can delete personal block", booking("21:00", service="Blocaj personal") + """
set role authenticated;
do $$
declare removed integer;
begin
  delete from public.appointments
    where client_id = 900000001 and appointment_date = date '2099-09-08';
  get diagnostics removed = row_count;
  if removed <> 1 then
    raise exception 'Personal block deletion removed % rows, expected 1', removed;
  end if;
end;
$$;
reset role;
""")

    first = subprocess.Popen(
        ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    first.stdin.write("begin;\n" + booking("19:00") + "select pg_sleep(2);\ncommit;\n")
    first.stdin.close()
    time.sleep(0.4)
    second = sql("begin;\n" + booking("19:30") + "commit;\n")
    first.wait(timeout=15)
    passed = first.returncode == 0 and second.returncode != 0 and "overlaps" in second.stderr
    print(f"{'PASS' if passed else 'FAIL'} concurrent conflicting inserts serialize")
    if not passed:
        raise AssertionError("Concurrent insert race was not rejected")
finally:
    cleanup = sql(
        f"delete from public.appointments where client_id={client_id};\n"
        f"delete from public.clients where id={client_id};\n"
    )
    if cleanup.returncode:
        raise SystemExit("Synthetic cleanup failed in disposable container")
