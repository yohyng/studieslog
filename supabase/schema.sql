-- 記事テーブル
create table if not exists public.articles (
  id bigint generated always as identity primary key,
  date text not null,
  title text not null default '',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 記事ごとの文字組みの上書き(NULLならサイト全体の表示設定に従う)
alter table public.articles add column if not exists font text;
alter table public.articles add column if not exists font_size int;
alter table public.articles add column if not exists line_height numeric;
alter table public.articles add column if not exists letter_spacing numeric;
alter table public.articles add column if not exists text_align text;

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

-- サイト全体の表示設定(1行だけ使うシングルトンテーブル)
create table if not exists public.site_settings (
  id int primary key default 1,
  bg_color text not null default '#6b7278',
  text_color text not null default '#ffffff',
  font text not null default '''Shippori Mincho'', serif',
  font_size int not null default 16,
  line_height numeric not null default 2.2,
  letter_spacing numeric not null default 0.08,
  page_title text not null default '静謐な執筆アーカイブ',
  site_title text not null default '断片',
  site_subtitle text not null default '記憶の集積。言葉は静かに積もっていく。',
  preview_lines int not null default 3,
  content_width int not null default 672,
  text_align text not null default 'left',
  updated_at timestamptz not null default now(),
  constraint site_settings_singleton check (id = 1)
);

-- 既存のテーブルに後から追加した列(テーブルが既にある環境向け)
alter table public.site_settings add column if not exists page_title text not null default '静謐な執筆アーカイブ';
alter table public.site_settings add column if not exists site_title text not null default '断片';
alter table public.site_settings add column if not exists site_subtitle text not null default '記憶の集積。言葉は静かに積もっていく。';
alter table public.site_settings add column if not exists preview_lines int not null default 3;
alter table public.site_settings add column if not exists content_width int not null default 672;
alter table public.site_settings add column if not exists text_align text not null default 'left';

insert into public.site_settings (id) values (1)
on conflict (id) do nothing;

alter table public.site_settings enable row level security;

-- 閲覧は誰でも可能(公開ページが表示に使う)
create policy "site_settings_public_read" on public.site_settings
  for select using (true);

-- 更新はログイン済みユーザーのみ
create policy "site_settings_auth_update" on public.site_settings
  for update to authenticated using (id = 1) with check (id = 1);
