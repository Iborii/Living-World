-- Living World Studio: run this once in Supabase → SQL Editor → New query → Run.

-- Public profile for each account (display name shown on published items)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Creator' check (char_length(name) between 1 and 40),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Everything people publish: races, characters, worlds
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('race','character','world')),
  title text not null check (char_length(title) between 1 and 80),
  summary text not null default '' check (char_length(summary) <= 500),
  tags text[] not null default '{}' check (array_length(tags,1) is null or array_length(tags,1) <= 12),
  rating text not null default 'general' check (rating in ('general','mature')),
  has_minor boolean not null default false,
  data jsonb not null,
  likes int not null default 0,
  downloads int not null default 0,
  reports int not null default 0,
  status text not null default 'public' check (status in ('public','hidden','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- anything with a character under 18 can never be marked mature
  constraint minors_never_mature check (not (has_minor and rating = 'mature')),
  constraint size_limit check (pg_column_size(data) < 1500000)
);
create index if not exists items_kind_likes on public.items(kind, likes desc);
create index if not exists items_kind_new on public.items(kind, created_at desc);
create index if not exists items_owner on public.items(owner);

create table if not exists public.likes (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  item_id uuid not null references public.items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.reports (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  item_id uuid not null references public.items(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- keep counts in sync; hide items automatically after 3 reports (an admin can restore them)
create or replace function public.lw_like_count() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('lw.sys','1',true);
  if tg_op = 'INSERT' then update items set likes = likes + 1 where id = new.item_id;
  else update items set likes = greatest(likes - 1, 0) where id = old.item_id; end if;
  perform set_config('lw.sys','',true);
  return null;
end $$;
drop trigger if exists likes_count on public.likes;
create trigger likes_count after insert or delete on public.likes for each row execute function public.lw_like_count();

create or replace function public.lw_report_count() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('lw.sys','1',true);
  update items set reports = reports + 1, status = case when reports + 1 >= 3 and status = 'public' then 'hidden' else status end where id = new.item_id;
  perform set_config('lw.sys','',true);
  return null;
end $$;
drop trigger if exists reports_count on public.reports;
create trigger reports_count after insert on public.reports for each row execute function public.lw_report_count();

-- owners can't fake their own counters or un-hide reported items
create or replace function public.lw_guard_item() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('lw.sys', true) = '1' then return new; end if;
  if exists (select 1 from profiles where id = auth.uid() and is_admin) then new.updated_at = now(); return new; end if;
  if tg_op = 'INSERT' then
    new.likes = 0; new.downloads = 0; new.reports = 0; new.status = 'public'; new.owner = auth.uid();
  else
    new.likes = old.likes; new.downloads = old.downloads; new.reports = old.reports; new.owner = old.owner;
    if old.status <> 'public' then new.status = old.status; end if;
    new.updated_at = now();
  end if;
  return new;
end $$;
drop trigger if exists items_guard on public.items;
create trigger items_guard before insert or update on public.items for each row execute function public.lw_guard_item();

-- counting a download (anyone, no account needed)
create or replace function public.lw_downloaded(item uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('lw.sys','1',true);
  update items set downloads = downloads + 1 where id = item and status = 'public';
  perform set_config('lw.sys','',true);
end $$;
grant execute on function public.lw_downloaded(uuid) to anon, authenticated;

-- make a profile row on sign-up
create or replace function public.lw_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, name) values (new.id, coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.lw_new_user();

-- Row level security
alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.likes enable row level security;
alter table public.reports enable row level security;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select using (true);
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and is_admin = (select is_admin from profiles where id = auth.uid()));

drop policy if exists "read public items" on public.items;
create policy "read public items" on public.items for select using (status = 'public' or owner = auth.uid() or exists (select 1 from profiles where id = auth.uid() and is_admin));
drop policy if exists "publish" on public.items;
create policy "publish" on public.items for insert to authenticated with check (owner = auth.uid());
drop policy if exists "edit own" on public.items;
create policy "edit own" on public.items for update to authenticated using (owner = auth.uid() or exists (select 1 from profiles where id = auth.uid() and is_admin));
drop policy if exists "delete own" on public.items;
create policy "delete own" on public.items for delete to authenticated using (owner = auth.uid() or exists (select 1 from profiles where id = auth.uid() and is_admin));

drop policy if exists "see own likes" on public.likes;
create policy "see own likes" on public.likes for select to authenticated using (user_id = auth.uid());
drop policy if exists "like" on public.likes;
create policy "like" on public.likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unlike" on public.likes;
create policy "unlike" on public.likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "report" on public.reports;
create policy "report" on public.reports for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "admins read reports" on public.reports;
create policy "admins read reports" on public.reports for select to authenticated using (exists (select 1 from profiles where id = auth.uid() and is_admin));

-- browsing view without the heavy data column, with creator names
create or replace view public.item_list with (security_invoker = true) as
  select i.id, i.kind, i.title, i.summary, i.tags, i.rating, i.has_minor, i.likes, i.downloads, i.status, i.created_at, i.updated_at, i.owner,
         p.name as creator, (i.data->>'img') as img, (i.data->>'color') as color
  from public.items i left join public.profiles p on p.id = i.owner;
grant select on public.item_list to anon, authenticated;
