-- QR2WebUpload 演示版数据库初始化脚本
-- 在 Supabase 控制台 → SQL Editor 中整段执行即可。

create extension if not exists pgcrypto;

create table if not exists public.subjects (
  id text primary key,
  name text not null,
  note text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  subject_id text not null references public.subjects(id) on delete cascade,
  image_url text not null,
  storage_path text,
  taken_at timestamptz,
  latitude double precision,
  longitude double precision,
  location_name text default '',
  camera text default '',
  note text default '',
  file_name text default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_uploads_subject_created
  on public.uploads (subject_id, created_at desc);

alter table public.subjects enable row level security;
alter table public.uploads enable row level security;

-- 演示策略：允许匿名读写。正式研究请改为基于登录用户的行级安全策略。
drop policy if exists "demo subjects anon all" on public.subjects;
create policy "demo subjects anon all" on public.subjects
  for all to anon using (true) with check (true);

drop policy if exists "demo uploads anon all" on public.uploads;
create policy "demo uploads anon all" on public.uploads
  for all to anon using (true) with check (true);

-- 照片存储桶（公开读，便于后台直接展示图片）
insert into storage.buckets (id, name, public)
  values ('booklet-photos', 'booklet-photos', true)
  on conflict (id) do nothing;

drop policy if exists "demo photos public read" on storage.objects;
create policy "demo photos public read" on storage.objects
  for select to public using (bucket_id = 'booklet-photos');

drop policy if exists "demo photos anon insert" on storage.objects;
create policy "demo photos anon insert" on storage.objects
  for insert to anon with check (bucket_id = 'booklet-photos');

drop policy if exists "demo photos anon delete" on storage.objects;
create policy "demo photos anon delete" on storage.objects
  for delete to anon using (bucket_id = 'booklet-photos');
