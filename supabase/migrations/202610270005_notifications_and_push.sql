-- Durable notification inbox, device push subscriptions and per-user preferences.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('attendance', 'calendar', 'leave', 'account', 'system')),
  title text not null check (char_length(title) between 2 and 120),
  body text not null check (char_length(body) between 2 and 500),
  action_url text not null default '/app' check (action_url like '/%'),
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id, dedupe_key)
);

create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications(recipient_id, created_at desc)
  where read_at is null;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  user_agent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id, active);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  push_enabled boolean not null default true,
  attendance_reminders boolean not null default true,
  leave_updates boolean not null default true,
  calendar_updates boolean not null default true,
  reminder_minutes integer not null default 10 check (reminder_minutes between 0 and 60),
  updated_at timestamptz not null default now()
);

drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at before update on public.push_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at before update on public.notification_preferences
for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;

revoke all on public.notifications, public.push_subscriptions, public.notification_preferences from anon;
revoke all on public.notifications, public.push_subscriptions, public.notification_preferences from authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;

drop policy if exists "users read their notifications" on public.notifications;
create policy "users read their notifications" on public.notifications
for select to authenticated using (recipient_id = (select auth.uid()));

drop policy if exists "users mark their notifications read" on public.notifications;
create policy "users mark their notifications read" on public.notifications
for update to authenticated using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

drop policy if exists "users manage their push devices" on public.push_subscriptions;
create policy "users manage their push devices" on public.push_subscriptions
for all to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "users manage their notification preferences" on public.notification_preferences;
create policy "users manage their notification preferences" on public.notification_preferences
for all to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

alter table public.notifications replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
