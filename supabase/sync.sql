-- Living World account sync: run once in Supabase → SQL Editor → New query → Run.
-- Everything stored here is encrypted on the device with a key made from your password,
-- so nobody (not even the project owner) can read your API keys or stories.
create table if not exists public.user_data (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  key text not null check (char_length(key) <= 200),
  value text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
create or replace function public.lw_touch() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch before insert or update on public.user_data for each row execute function public.lw_touch();
alter table public.user_data enable row level security;
drop policy if exists "own data" on public.user_data;
create policy "own data" on public.user_data for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.user_data to authenticated;
