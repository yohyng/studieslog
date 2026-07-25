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

-- 紹介リンク(書籍など)。[{"label": "...", "url": "..."}, ...] の配列
alter table public.articles add column if not exists book_links jsonb not null default '[]';

-- 下書き/予約/公開の状態。既存記事を巻き込んで非公開にしないよう、デフォルトは'published'
alter table public.articles add column if not exists status text not null default 'published';

-- 予約投稿の公開予定日時(status='scheduled'の時だけ使う)
alter table public.articles add column if not exists scheduled_at timestamptz;

-- ジャンルとしてのカテゴリ(1記事につき1つ、任意)。タグ(複数付けられる横串)とは別の分類軸
alter table public.articles add column if not exists category text not null default '';

-- パターンBのArticle一覧の上部に固定表示するためのピン留め(目安3件程度、件数上限は特に強制しない)
alter table public.articles add column if not exists pinned boolean not null default false;

-- 日英対応。空文字の場合は英語表示時も日本語の値にフォールバックする
alter table public.articles add column if not exists title_en text not null default '';
alter table public.articles add column if not exists content_en text not null default '';

alter table public.articles enable row level security;

-- 閲覧は誰でも可能(公開ブログのため)。下書きは常に隠すが、
-- 予約投稿(status='scheduled')は予定日時を過ぎた瞬間に自動で見えるようになる(cron不要)
drop policy if exists "articles_public_read" on public.articles;
create policy "articles_public_read" on public.articles
  for select to anon using (
    status = 'published' or (status = 'scheduled' and scheduled_at <= now())
  );

-- ログイン済み(管理者)は下書きも含めて全部読める
create policy "articles_authenticated_read_all" on public.articles
  for select to authenticated using (true);

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
  site_title_font text not null default '',
  site_subtitle text not null default '記憶の集積。言葉は静かに積もっていく。',
  preview_lines int not null default 3,
  content_width int not null default 672,
  text_align text not null default 'left',
  tag_bg_color text not null default '#ffffff',
  tag_text_color text not null default '#6b7278',
  tag_font_size int not null default 12,
  tag_font text not null default '',
  site_title_size int not null default 14,
  site_title_color text not null default '#ffffff',
  site_subtitle_size int not null default 12,
  site_subtitle_color text not null default '#ffffff',
  selection_bg_color text not null default '#ffffff',
  selection_text_color text not null default '#6b7278',
  tag_description_size int not null default 12,
  tag_description_color text not null default '#ffffff',
  footnote_color text not null default '#7dd3fc',
  menu_font_size int not null default 12,
  og_image text not null default '',
  gradient_bg_style text not null default '',
  bg_image_url text not null default '',
  title_shape_enabled boolean not null default true,
  title_shape_width int not null default 200,
  title_shape_height int not null default 193,
  title_shape_top int not null default -45,
  title_shape_opacity numeric not null default 0.4,
  title_shape_stroke_width numeric not null default 1,
  title_shape_jitter numeric not null default 14,
  title_shape_wobble numeric not null default 6,
  title_shape_hover_intensity numeric not null default 1,
  silver_darkness numeric not null default 0.25,
  list_heading_bg_color text not null default '#ffffff',
  list_heading_text_color text not null default '#6b7278',
  digest_bg_color text not null default '#f4f1ea',
  digest_text_color text not null default '#2b2b28',
  subscribe_bg_color text not null default '#ffffff',
  subscribe_text_color text not null default '#6b7278',
  homepage_layout text not null default 'timeline',
  card_font_scale numeric not null default 1,
  card_title_font text not null default '',
  card_excerpt_font text not null default '',
  card_text_color text not null default '',
  updated_at timestamptz not null default now(),
  constraint site_settings_singleton check (id = 1)
);

-- 既存のテーブルに後から追加した列(テーブルが既にある環境向け)
alter table public.site_settings add column if not exists page_title text not null default '静謐な執筆アーカイブ';
alter table public.site_settings add column if not exists site_title text not null default '断片';
alter table public.site_settings add column if not exists site_title_font text not null default '';
alter table public.site_settings add column if not exists site_subtitle text not null default '記憶の集積。言葉は静かに積もっていく。';
alter table public.site_settings add column if not exists preview_lines int not null default 3;
alter table public.site_settings add column if not exists content_width int not null default 672;
alter table public.site_settings add column if not exists text_align text not null default 'left';
alter table public.site_settings add column if not exists tag_bg_color text not null default '#ffffff';
alter table public.site_settings add column if not exists tag_text_color text not null default '#6b7278';
alter table public.site_settings add column if not exists tag_font_size int not null default 12;
alter table public.site_settings add column if not exists tag_font text not null default '';
alter table public.site_settings add column if not exists site_title_size int not null default 14;
alter table public.site_settings add column if not exists site_title_color text not null default '#ffffff';
alter table public.site_settings add column if not exists site_subtitle_size int not null default 12;
alter table public.site_settings add column if not exists site_subtitle_color text not null default '#ffffff';
alter table public.site_settings add column if not exists selection_bg_color text not null default '#ffffff';
alter table public.site_settings add column if not exists selection_text_color text not null default '#6b7278';
alter table public.site_settings add column if not exists tag_description_size int not null default 12;
alter table public.site_settings add column if not exists tag_description_color text not null default '#ffffff';
alter table public.site_settings add column if not exists footnote_color text not null default '#7dd3fc';
alter table public.site_settings add column if not exists menu_font_size int not null default 12;
alter table public.site_settings add column if not exists og_image text not null default '';
alter table public.site_settings add column if not exists gradient_bg_style text not null default '';
alter table public.site_settings add column if not exists bg_image_url text not null default '';
alter table public.site_settings add column if not exists title_shape_enabled boolean not null default true;
alter table public.site_settings add column if not exists title_shape_width int not null default 200;
alter table public.site_settings add column if not exists title_shape_height int not null default 193;
alter table public.site_settings add column if not exists title_shape_top int not null default -45;
alter table public.site_settings add column if not exists title_shape_opacity numeric not null default 0.4;
alter table public.site_settings add column if not exists title_shape_stroke_width numeric not null default 1;
alter table public.site_settings add column if not exists title_shape_jitter numeric not null default 14;
alter table public.site_settings add column if not exists title_shape_wobble numeric not null default 6;
alter table public.site_settings add column if not exists title_shape_hover_intensity numeric not null default 1;
alter table public.site_settings add column if not exists silver_darkness numeric not null default 0.25;
alter table public.site_settings add column if not exists list_heading_bg_color text not null default '#ffffff';
alter table public.site_settings add column if not exists list_heading_text_color text not null default '#6b7278';
alter table public.site_settings add column if not exists digest_bg_color text not null default '#f4f1ea';
alter table public.site_settings add column if not exists digest_text_color text not null default '#2b2b28';
alter table public.site_settings add column if not exists subscribe_bg_color text not null default '#ffffff';
alter table public.site_settings add column if not exists subscribe_text_color text not null default '#6b7278';
alter table public.site_settings add column if not exists homepage_layout text not null default 'timeline';

-- パターンC(カード型)のカード内文字サイズ・フォント・文字色。空文字/1は「サイトの本文設定に従う」を意味する
alter table public.site_settings add column if not exists card_font_scale numeric not null default 1;
alter table public.site_settings add column if not exists card_title_font text not null default '';
alter table public.site_settings add column if not exists card_excerpt_font text not null default '';
alter table public.site_settings add column if not exists card_text_color text not null default '';

insert into public.site_settings (id) values (1)
on conflict (id) do nothing;

alter table public.site_settings enable row level security;

-- 閲覧は誰でも可能(公開ページが表示に使う)
create policy "site_settings_public_read" on public.site_settings
  for select using (true);

-- 更新はログイン済みユーザーのみ
create policy "site_settings_auth_update" on public.site_settings
  for update to authenticated using (id = 1) with check (id = 1);

-- アバウトページの内容
alter table public.site_settings add column if not exists about_content text not null default '';
alter table public.site_settings add column if not exists about_content_en text not null default '';

-- アバウトページに表示するSNSリンク(空文字なら非表示)
alter table public.site_settings add column if not exists sns_x_url text not null default '';
alter table public.site_settings add column if not exists sns_instagram_url text not null default '';
alter table public.site_settings add column if not exists sns_website_url text not null default '';

-- ハッシュタグ
create table if not exists public.tags (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

alter table public.tags enable row level security;

create policy "tags_public_read" on public.tags
  for select using (true);

create policy "tags_auth_insert" on public.tags
  for insert to authenticated with check (true);

create policy "tags_auth_update" on public.tags
  for update to authenticated using (true) with check (true);

create policy "tags_auth_delete" on public.tags
  for delete to authenticated using (true);

-- 記事とタグの中間テーブル(多対多)
create table if not exists public.article_tags (
  article_id bigint not null references public.articles(id) on delete cascade,
  tag_id bigint not null references public.tags(id) on delete cascade,
  primary key (article_id, tag_id)
);

alter table public.article_tags enable row level security;

create policy "article_tags_public_read" on public.article_tags
  for select using (true);

create policy "article_tags_auth_insert" on public.article_tags
  for insert to authenticated with check (true);

create policy "article_tags_auth_delete" on public.article_tags
  for delete to authenticated using (true);

-- ニュースレター購読者。読み取り・削除はservice role(週次ダイジェスト送信・配信解除用のAPI関数)経由でのみ行うため、
-- anonロールには登録(insert)以外のポリシーを与えない
create table if not exists public.subscribers (
  id bigint generated always as identity primary key,
  email text not null unique,
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- 購読者の中で「管理者用テストアドレス」として、配信メールの実機確認送信の宛先にする1件の目印
alter table public.subscribers add column if not exists is_admin_test boolean not null default false;

alter table public.subscribers enable row level security;

create policy "subscribers_public_insert" on public.subscribers
  for insert with check (true);

create policy "subscribers_auth_select" on public.subscribers
  for select to authenticated using (true);

create policy "subscribers_auth_delete" on public.subscribers
  for delete to authenticated using (true);

create policy "subscribers_auth_update" on public.subscribers
  for update to authenticated using (true) with check (true);

-- 週次ダイジェストを最後に送った時刻を覚えておく1行だけのテーブル(この時刻より新しい記事があれば送信対象になる)
create table if not exists public.newsletter_state (
  id int primary key default 1,
  last_sent_at timestamptz not null default now(),
  constraint newsletter_state_singleton check (id = 1)
);

insert into public.newsletter_state (id) values (1)
on conflict (id) do nothing;

alter table public.newsletter_state enable row level security;

create policy "newsletter_state_auth_all" on public.newsletter_state
  for all to authenticated using (true) with check (true);

-- Aboutページのお問い合わせフォームからの送信を保存するテーブル。
-- メール送信はせず、管理画面から確認・削除するだけのシンプルな受信箱として使う
create table if not exists public.inquiries (
  id bigint generated always as identity primary key,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.inquiries enable row level security;

create policy "inquiries_public_insert" on public.inquiries
  for insert with check (true);

create policy "inquiries_auth_select" on public.inquiries
  for select to authenticated using (true);

create policy "inquiries_auth_delete" on public.inquiries
  for delete to authenticated using (true);
