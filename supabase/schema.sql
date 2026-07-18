-- 記事テーブル
create table if not exists public.articles (
  id bigint generated always as identity primary key,
  date text not null,
  title text not null default '',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.articles enable row level security;

-- 閲覧は誰でも可能(公開ブログのため)
create policy "articles_public_read" on public.articles
  for select using (true);

-- 作成・更新・削除はログイン済みユーザーのみ
create policy "articles_auth_insert" on public.articles
  for insert to authenticated with check (true);

create policy "articles_auth_update" on public.articles
  for update to authenticated using (true) with check (true);

create policy "articles_auth_delete" on public.articles
  for delete to authenticated using (true);

-- 画像アップロード用ストレージバケット
insert into storage.buckets (id, name, public)
values ('article-images', 'article-images', true)
on conflict (id) do nothing;

create policy "article_images_public_read" on storage.objects
  for select using (bucket_id = 'article-images');

create policy "article_images_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'article-images');

create policy "article_images_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'article-images');
