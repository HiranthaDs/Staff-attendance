-- Business identity captured when the system owner provisions a company.

alter table public.organizations
  add column if not exists legal_name text,
  add column if not exists registration_number text,
  add column if not exists industry text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists country text not null default 'Sri Lanka',
  add column if not exists timezone text not null default 'Asia/Colombo';

alter table public.organizations drop constraint if exists organizations_legal_name_length;
alter table public.organizations add constraint organizations_legal_name_length
  check (legal_name is null or char_length(legal_name) between 2 and 160);
alter table public.organizations drop constraint if exists organizations_registration_number_length;
alter table public.organizations add constraint organizations_registration_number_length
  check (registration_number is null or char_length(registration_number) between 2 and 80);
alter table public.organizations drop constraint if exists organizations_industry_length;
alter table public.organizations add constraint organizations_industry_length
  check (industry is null or char_length(industry) between 2 and 100);
alter table public.organizations drop constraint if exists organizations_phone_length;
alter table public.organizations add constraint organizations_phone_length
  check (phone is null or char_length(phone) between 7 and 30);
alter table public.organizations drop constraint if exists organizations_website_length;
alter table public.organizations add constraint organizations_website_length
  check (website is null or char_length(website) <= 240);
alter table public.organizations drop constraint if exists organizations_address_length;
alter table public.organizations add constraint organizations_address_length
  check (address is null or char_length(address) between 4 and 300);
alter table public.organizations drop constraint if exists organizations_city_length;
alter table public.organizations add constraint organizations_city_length
  check (city is null or char_length(city) between 2 and 100);

create unique index if not exists organizations_registration_number_uidx
  on public.organizations(lower(registration_number))
  where registration_number is not null;
