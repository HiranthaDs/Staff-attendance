-- Keep platform operators separate from company owners.
-- PostgreSQL enum values must be committed before they are referenced by later migrations.

alter type public.app_role add value if not exists 'company_admin' before 'branch_admin';
