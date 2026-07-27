#!/usr/bin/env python3
"""
Notion Database → Supabase RAG indexer

Usage:
    python notion_rag.py              # フルリインデックス（既存チャンクを全削除して作り直す）
    python notion_rag.py --resume     # チェックポイントを使って中断箇所から再開
    python notion_rag.py --dry-run    # Notionからは取得するが埋め込み・保存は行わない

環境変数は scripts/.env に書くか、あらかじめシェルで export しておく。
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# ── 設定 ──────────────────────────────────────────────────────────────────

NOTION_TOKEN        = os.environ["NOTION_TOKEN"]
NOTION_DATABASE_ID  = os.environ["NOTION_DATABASE_ID"]
GEMINI_API_KEY      = os.environ["GEMINI_API_KEY"]
SUPABASE_URL        = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
EMBEDDING_MODEL     = os.environ.get("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")

CHUNK_SIZE       = 800   # 1チャンクあたりの最大文字数
CHECKPOINT_FILE  = Path(__file__).parent / "notion_rag_checkpoint.json"
NOTION_SLEEP     = 0.35  # Notion API は平均 3req/s 制限
GEMINI_SLEEP     = 0.05  # Gemini embedding: ~20req/s


# ── Notion API ─────────────────────────────────────────────────────────────

def notion_headers():
    return {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": "2022-06-28",
    }

def notion_post(path, body):
    r = requests.post(
        f"https://api.notion.com/v1{path}",
        headers={**notion_headers(), "Content-Type": "application/json"},
        json=body, timeout=30,
    )
    r.raise_for_status()
    return r.json()

def notion_get(path, params=None):
    r = requests.get(
        f"https://api.notion.com/v1{path}",
        headers=notion_headers(), params=params, timeout=30,
    )
    r.raise_for_status()
    return r.json()


def fetch_all_pages(database_id):
    """Notion Database の全ページを取得（ページネーション対応）。"""
    pages, cursor = [], None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        data = notion_post(f"/databases/{database_id}/query", body)
        pages.extend(data["results"])
        print(f"  {len(pages)} ページ取得中...", end="\r", flush=True)
        if not data.get("has_more"):
            break
        cursor = data["next_cursor"]
        time.sleep(NOTION_SLEEP)
    print()
    return pages


def get_page_title(page):
    for prop in page["properties"].values():
        if prop["type"] == "title":
            return "".join(t["plain_text"] for t in prop["title"])
    return "(無題)"


def fetch_top_level_blocks(page_id):
    """トップレベルのブロックだけ取得（サブページ・入れ子は取得しない）。"""
    blocks, cursor = [], None
    while True:
        params = {"page_size": 100}
        if cursor:
            params["start_cursor"] = cursor
        data = notion_get(f"/blocks/{page_id}/children", params)
        blocks.extend(data["results"])
        if not data.get("has_more"):
            break
        cursor = data["next_cursor"]
        time.sleep(NOTION_SLEEP)
    return blocks


def block_to_text(block):
    """1ブロックをプレーンテキストに変換。対応していない種類は空文字を返す。"""
    t = block["type"]
    d = block.get(t, {})
    rich = d.get("rich_text", [])
    text = "".join(rt["plain_text"] for rt in rich)

    if t in ("paragraph", "heading_1", "heading_2", "heading_3",
             "bulleted_list_item", "numbered_list_item",
             "quote", "callout", "toggle", "code"):
        return text
    if t == "to_do":
        return ("✓" if d.get("checked") else "□") + " " + text
    if t == "divider":
        return "---"
    return ""   # image / embed / bookmark など → スキップ


def blocks_to_plain_text(blocks):
    lines = [block_to_text(b) for b in blocks]
    return "\n\n".join(l for l in lines if l)


# ── テキスト分割（api/rag.js と同じロジック）────────────────────────────────

def chunk_text(text, max_len=CHUNK_SIZE):
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks, current = [], ""
    for p in paragraphs:
        if current and len(current) + len(p) + 2 > max_len:
            chunks.append(current)
            current = p
        else:
            current = f"{current}\n\n{p}" if current else p
        while len(current) > max_len * 1.5:
            chunks.append(current[:max_len])
            current = current[max_len:]
    if current:
        chunks.append(current)
    return chunks


# ── Gemini 埋め込み ────────────────────────────────────────────────────────

def embed_text(text):
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models"
        f"/{EMBEDDING_MODEL}:embedContent"
    )
    r = requests.post(
        url, params={"key": GEMINI_API_KEY},
        json={"content": {"parts": [{"text": text}]}}, timeout=30,
    )
    r.raise_for_status()
    return r.json()["embedding"]["values"]


# ── Supabase REST ───────────────────────────────────────────────────────────

def supabase(path, method="GET", body=None, extra_headers=None):
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        **(extra_headers or {}),
    }
    r = requests.request(
        method, f"{SUPABASE_URL}/rest/v1{path}",
        headers=headers, json=body, timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"Supabase {r.status_code}: {r.text}")
    return r.json() if r.text else None


# ── チェックポイント ──────────────────────────────────────────────────────

def load_checkpoint():
    if CHECKPOINT_FILE.exists():
        return set(json.loads(CHECKPOINT_FILE.read_text())["done"])
    return set()

def save_checkpoint(done_ids):
    CHECKPOINT_FILE.write_text(json.dumps({"done": list(done_ids)}, ensure_ascii=False))


# ── メイン ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Notion DB → Supabase RAG indexer")
    parser.add_argument("--resume",  action="store_true", help="チェックポイントから再開")
    parser.add_argument("--dry-run", action="store_true", help="埋め込み・保存をスキップ")
    args = parser.parse_args()

    if args.resume:
        done_ids = load_checkpoint()
        print(f"再開モード: {len(done_ids)} ページはスキップします")
    else:
        done_ids = set()
        if not args.dry_run:
            print("notion_chunks を全削除して作り直します...")
            supabase("/notion_chunks?id=gte.0", "DELETE")
        CHECKPOINT_FILE.unlink(missing_ok=True)

    print(f"Notion Database からページを取得中...")
    pages = fetch_all_pages(NOTION_DATABASE_ID)
    print(f"合計 {len(pages)} ページ")

    total_chunks = 0
    for i, page in enumerate(pages):
        page_id = page["id"]
        title   = get_page_title(page)
        prefix  = f"[{i+1}/{len(pages)}]"

        if page_id in done_ids:
            print(f"{prefix} skip  {title[:55]}")
            continue

        print(f"{prefix} {title[:55]}", end="  ", flush=True)

        # ブロック取得
        try:
            blocks = fetch_top_level_blocks(page_id)
        except Exception as e:
            print(f"⚠ ブロック取得失敗: {e}")
            continue

        body_text = blocks_to_plain_text(blocks)
        full_text = f"{title}\n\n{body_text}" if body_text else title
        chunks = chunk_text(full_text)

        if not chunks:
            print("(空、スキップ)")
            continue

        print(f"{len(chunks)} チャンク", end="", flush=True)

        if args.dry_run:
            print(" [dry-run]")
            done_ids.add(page_id)
            continue

        # 埋め込みと保存
        rows = []
        for j, chunk in enumerate(chunks):
            try:
                vector = embed_text(chunk)
                rows.append({
                    "page_id":     page_id,
                    "page_title":  title,
                    "chunk_index": j,
                    "content":     chunk,
                    "embedding":   f"[{','.join(str(v) for v in vector)}]",
                })
                time.sleep(GEMINI_SLEEP)
            except Exception as e:
                print(f"\n  ⚠ チャンク {j} の埋め込み失敗: {e}")

        if rows:
            try:
                supabase("/notion_chunks", "POST", body=rows,
                         extra_headers={"Prefer": "return=minimal"})
                total_chunks += len(rows)
                print(f" → 保存完了")
            except Exception as e:
                print(f"\n  ⚠ 保存失敗: {e}")
                continue

        done_ids.add(page_id)
        save_checkpoint(done_ids)

    print(f"\n✓ 完了 — {len(done_ids)} ページ / {total_chunks} チャンク保存")
    if not args.dry_run:
        CHECKPOINT_FILE.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
