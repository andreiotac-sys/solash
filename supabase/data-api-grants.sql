grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete
on table public.clients,
  public.appointments,
  public.services
to authenticated;

grant select, insert, update, delete
on table public.clients,
  public.appointments,
  public.services,
  public.push_subscriptions,
  public.push_notification_runs,
  public.push_appointment_reminders,
  public.push_delivery_logs
to service_role;

grant usage, select
on sequence public.clients_id_seq,
  public.appointments_id_seq,
  public.services_id_seq
to authenticated;

grant usage, select
on sequence public.clients_id_seq,
  public.appointments_id_seq,
  public.services_id_seq,
  public.push_subscriptions_id_seq,
  public.push_notification_runs_id_seq,
  public.push_appointment_reminders_id_seq,
  public.push_delivery_logs_id_seq
to service_role;
