create table if not exists public.mileage_states (
  owner_user_id text primary key,
  owner_email text,
  mr_name text,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists mileage_states_mr_name_idx
  on public.mileage_states (mr_name);

alter table public.mileage_states enable row level security;

comment on table public.mileage_states is 'Clerk user-scoped state for the mileage manager app';
