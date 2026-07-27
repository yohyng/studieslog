-- Notion アーカイブ用チャンクテーブル
-- ブログ記事 RAG (article_chunks) とは分離して管理する

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.notion_chunks (
    id          bigserial PRIMARY KEY,
    page_id     text NOT NULL,        -- Notion ページ ID (UUID形式)
    page_title  text,
    chunk_index int  NOT NULL,
    content     text NOT NULL,
    embedding   vector(3072)          -- gemini-embedding-001 の次元数
);

-- ベクトル近傍検索用インデックス（100件以上になってから有効化する）
-- CREATE INDEX notion_chunks_embedding_idx
--     ON public.notion_chunks USING ivfflat (embedding vector_cosine_ops)
--     WITH (lists = 100);

-- 類似チャンク検索関数
CREATE OR REPLACE FUNCTION match_notion_chunks(
    query_embedding vector(3072),
    match_count     int DEFAULT 6
)
RETURNS TABLE (
    page_id     text,
    page_title  text,
    chunk_index int,
    content     text,
    similarity  float
)
LANGUAGE sql STABLE AS $$
    SELECT page_id, page_title, chunk_index, content,
           1 - (embedding <=> query_embedding) AS similarity
    FROM   public.notion_chunks
    WHERE  embedding IS NOT NULL
    ORDER  BY embedding <=> query_embedding
    LIMIT  match_count;
$$;
