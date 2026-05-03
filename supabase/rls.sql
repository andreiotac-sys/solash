alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.services enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_notification_runs enable row level security;
alter table public.push_appointment_reminders enable row level security;
alter table public.push_delivery_logs enable row level security;

create policy "Allow authenticated users to read clients"
on public.clients
for select
to authenticated
using (true);

create policy "Allow authenticated users to insert clients"
on public.clients
for insert
to authenticated
with check (true);

create policy "Allow authenticated users to update clients"
on public.clients
for update
to authenticated
using (true)
with check (true);

create policy "Allow authenticated users to delete clients"
on public.clients
for delete
to authenticated
using (true);

create policy "Allow authenticated users to read appointments"
on public.appointments
for select
to authenticated
using (true);

create policy "Allow authenticated users to insert appointments"
on public.appointments
for insert
to authenticated
with check (true);

create policy "Allow authenticated users to update appointments"
on public.appointments
for update
to authenticated
using (true)
with check (true);

create policy "Allow authenticated users to delete appointments"
on public.appointments
for delete
to authenticated
using (true);

create policy "Allow authenticated users to read services"
on public.services
for select
to authenticated
using (true);

create policy "Allow authenticated users to insert services"
on public.services
for insert
to authenticated
with check (true);

create policy "Allow authenticated users to update services"
on public.services
for update
to authenticated
using (true)
with check (true);

create policy "Allow authenticated users to delete services"
on public.services
for delete
to authenticated
using (true);
