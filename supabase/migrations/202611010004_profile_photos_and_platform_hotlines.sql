-- Private low-resolution staff photos and a platform-managed support directory.
alter table public.profiles
  add column if not exists avatar_path text;

comment on column public.profiles.avatar_path is
  'Private Supabase Storage object path. Images are served only through an authorized application route.';

create table if not exists public.platform_hotlines (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(trim(label)) between 2 and 60),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  availability text check (availability is null or char_length(trim(availability)) between 2 and 100),
  call_enabled boolean not null default true,
  whatsapp_enabled boolean not null default true,
  active boolean not null default true,
  sort_order smallint not null default 0 check (sort_order between 0 and 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_hotlines_contact_method check (call_enabled or whatsapp_enabled)
);

create index if not exists platform_hotlines_active_order_idx
  on public.platform_hotlines(active, sort_order, created_at);

alter table public.platform_hotlines enable row level security;
revoke all on public.platform_hotlines from anon, authenticated;
grant select on public.platform_hotlines to authenticated;

drop policy if exists "authenticated users read active hotlines" on public.platform_hotlines;
create policy "authenticated users read active hotlines"
  on public.platform_hotlines for select to authenticated
  using (active = true);

-- Uploads use the service role after application-level authorization. The bucket
-- remains private so an object URL cannot bypass tenant/profile visibility.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  false,
  102400,
  array['image/webp', 'image/jpeg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Add the company owner's profile photo to the platform directory summary.
drop function if exists public.platform_organization_summary(uuid);
create function public.platform_organization_summary(p_actor_id uuid)
returns table (
  id uuid,
  name text,
  slug text,
  billing_email text,
  plan text,
  staff_limit integer,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  member_count bigint,
  branch_count bigint,
  owner_id uuid,
  owner_name text,
  owner_email text,
  owner_avatar_path text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.role = 'super_admin'::public.app_role and p.active = true
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  return query
  select o.id, o.name, o.slug, o.billing_email, o.plan, o.staff_limit, o.status,
    o.created_at, o.updated_at,
    (select count(*) from public.profiles p where p.organization_id = o.id and p.active = true),
    (select count(*) from public.branches b where b.organization_id = o.id and b.active = true),
    owner.id, owner.full_name, owner.email, owner.avatar_path
  from public.organizations o
  left join lateral (
    select p.id, p.full_name, p.email, p.avatar_path from public.profiles p
    where p.organization_id = o.id and p.role = 'company_admin'::public.app_role and p.active = true
    order by p.created_at limit 1
  ) owner on true
  order by o.created_at desc;
end;
$$;
revoke all on function public.platform_organization_summary(uuid) from public, anon, authenticated;
grant execute on function public.platform_organization_summary(uuid) to service_role;
