// 執筆補助RAGの試作。自分の過去記事をチャンクに分けて埋め込みベクトル化して保存し(action=reindex)、
// 執筆中の質問・相談に対して近い過去記事を検索し、それを参考としてGeminiに答えさせる(action=ask)。
// 管理画面からのみ呼ばれる。APIキーはこの関数の外(ブラウザ側)には一切渡さない。

const SUPABASE_URL = 'https://eiyzlawmcyybchxzyozr.supabase.co';
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const CHAT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'method not allowed' });
        return;
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!serviceKey || !geminiKey) {
        res.status(500).json({ error: 'missing required environment variables' });
        return;
    }

    // 管理画面からのリクエストであることを、ログイン中ユーザーのアクセストークンで確認する
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }

    const action = req.body?.action;
    try {
        if (action === 'reindex') {
            const result = await reindexArticles(serviceKey, geminiKey);
            res.status(200).json(result);
            return;
        }
        if (action === 'ask') {
            const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
            if (!query) {
                res.status(400).json({ error: 'query is required' });
                return;
            }
            const result = await answerWithRag(query, serviceKey, geminiKey);
            res.status(200).json(result);
            return;
        }
        if (action === 'ask-notion') {
            const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
            if (!query) {
                res.status(400).json({ error: 'query is required' });
                return;
            }
            const result = await answerWithNotionRag(query, serviceKey, geminiKey);
            res.status(200).json(result);
            return;
        }
        if (action === 'analyze-articles') {
            // 1回のリクエストで少しずつ進める。Geminiの応答は1件あたり数秒かかるので、
            // 全件を1回で処理しようとすると関数の実行時間の上限に当たる
            const limit = Number(req.body?.limit) || 5;
            const force = req.body?.force === true;
            const skip = Array.isArray(req.body?.skip) ? req.body.skip : [];
            const result = await analyzeArticles({ serviceKey, geminiKey, limit, force, skip });
            res.status(200).json(result);
            return;
        }
        if (action === 'find-working-model') {
            // ListModelsは「カタログに存在し generateContent に対応している」ことしか示さず、
            // このAPIキーで実際に呼べるかは反映していない。新規ユーザーへの提供終了のような制限は
            // 実際に呼び出した瞬間にだけ404として現れる。そのため候補を実際に1つずつ試す。
            const result = await findWorkingModel(geminiKey);
            res.status(200).json(result);
            return;
        }
        if (action === 'listmodels') {
            const r = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(geminiKey)}`
            );
            const data = await r.json();
            // 生成に使えるモデルだけを分けて返す。設定中のモデル名も返して、
            // 「設定しているモデルが実際に使えるか」をそのまま確認できるようにする
            const models = (data.models || []).map(m => ({
                name: String(m.name || '').replace(/^models\//, ''),
                methods: m.supportedGenerationMethods || [],
            }));
            res.status(200).json({
                configured: { chat: CHAT_MODEL, embedding: EMBEDDING_MODEL },
                chatModels: models.filter(m => m.methods.includes('generateContent')).map(m => m.name),
                embeddingModels: models.filter(m => m.methods.includes('embedContent')).map(m => m.name),
                models: models.map(m => m.name),
            });
            return;
        }
        res.status(400).json({ error: 'unknown action' });
    } catch (e) {
        console.error(e);
        res.status(502).json({ error: 'rag request failed', detail: String((e && e.message) || e) });
    }
};

async function supabaseRest(path, serviceKey, options = {}) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        ...options,
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`supabase error (${response.status}): ${detail}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

async function embedTexts(texts, geminiKey) {
    const vectors = [];
    for (const text of texts) {
        vectors.push(await embedText(text, geminiKey));
        // 埋め込みの無料枠は 100回/分・30Kトークン/分。連続で投げると超えるので少し間を置く
        await sleep(700);
    }
    return vectors;
}

async function embedText(text, geminiKey) {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(geminiKey)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: { parts: [{ text }] } }),
        }
    );
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`gemini embed error (${response.status}): ${detail}`);
    }
    const data = await response.json();
    return data.embedding?.values;
}

async function reindexArticles(serviceKey, geminiKey) {
    const articles = await supabaseRest('/articles?select=id,title,content', serviceKey, { method: 'GET' });

    // 件数が減った記事の古いチャンクが残らないよう、まず全消しして作り直す
    await supabaseRest('/article_chunks?id=gte.0', serviceKey, { method: 'DELETE' });

    let chunkCount = 0;
    for (const article of articles || []) {
        const plainText = stripHtml(article.content);
        const fullText = article.title ? `${article.title}\n\n${plainText}` : plainText;
        const chunks = chunkText(fullText);
        if (!chunks.length) continue;

        const vectors = await embedTexts(chunks, geminiKey);
        const rows = chunks
            .map((content, i) => ({
                article_id: article.id,
                chunk_index: i,
                content,
                // pgvector via PostgREST needs vector as string "[x,y,...]", not a JSON array
                embedding: Array.isArray(vectors[i]) ? `[${vectors[i].join(',')}]` : null,
            }))
            .filter((row) => row.embedding !== null);

        if (rows.length) {
            await supabaseRest('/article_chunks', serviceKey, {
                method: 'POST',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify(rows),
            });
            chunkCount += rows.length;
        }
    }

    return { articleCount: (articles || []).length, chunkCount };
}

async function answerWithRag(query, serviceKey, geminiKey) {
    const queryEmbedding = await embedText(query, geminiKey);
    if (!queryEmbedding) throw new Error('failed to embed query');

    const matches = await supabaseRest('/rpc/match_article_chunks', serviceKey, {
        method: 'POST',
        body: JSON.stringify({ query_embedding: queryEmbedding, match_count: 6 }),
    });

    const articleIds = [...new Set((matches || []).map((m) => m.article_id))];
    let titleById = {};
    if (articleIds.length) {
        const idFilter = articleIds.join(',');
        const rows = await supabaseRest(`/articles?select=id,title&id=in.(${idFilter})`, serviceKey, { method: 'GET' });
        titleById = Object.fromEntries((rows || []).map((r) => [r.id, r.title]));
    }

    const contextBlocks = (matches || [])
        .map((m, i) => `[参考${i + 1}: 「${titleById[m.article_id] || '(無題)'}」より]\n${m.content}`)
        .join('\n\n---\n\n');

    const prompt = `あなたはこのサイトの書き手の執筆を手伝うアシスタントです。以下は、書き手自身の過去記事から検索で見つかった関連する抜粋です。
これらを参考にしつつ、書き手の質問・相談に日本語で答えてください。過去記事の内容と矛盾しないよう注意し、
関連する抜粋があれば「〜という記事で書いていたように」のように軽く触れてもかまいません。抜粋に無い話を、
断定的に書き手自身の考えであるかのように語らないでください。

# 過去記事からの参考抜粋
${contextBlocks || '(関連する抜粋が見つかりませんでした)'}

# 書き手からの質問・相談
${query}`;

    const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
    );
    if (!geminiRes.ok) {
        const detail = await geminiRes.text();
        throw new Error(`gemini generate error (${geminiRes.status}): ${detail}`);
    }
    const geminiData = await geminiRes.json();
    const answer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
        answer,
        sources: (matches || []).map((m) => ({
            articleId: m.article_id,
            title: titleById[m.article_id] || '(無題)',
            similarity: m.similarity,
            excerpt: m.content.slice(0, 120),
        })),
    };
}

async function answerWithNotionRag(query, serviceKey, geminiKey) {
    const queryEmbedding = await embedText(query, geminiKey);
    if (!queryEmbedding) throw new Error('failed to embed query');

    const matches = await supabaseRest('/rpc/match_notion_chunks', serviceKey, {
        method: 'POST',
        body: JSON.stringify({ query_embedding: queryEmbedding, match_count: 6 }),
    });

    const contextBlocks = (matches || [])
        .map((m, i) => `[参考${i + 1}: 「${m.page_title || '(無題)'}」より]\n${m.content}`)
        .join('\n\n---\n\n');

    const prompt = `あなたはこのサイトの書き手のアシスタントです。以下は、書き手自身のNotionメモ・アーカイブから検索で見つかった関連する抜粋です。
これらを参考にしつつ、書き手の質問・相談に日本語で答えてください。

# Notionメモからの参考抜粋
${contextBlocks || '(関連する抜粋が見つかりませんでした)'}

# 書き手からの質問・相談
${query}`;

    const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
    );
    if (!geminiRes.ok) {
        const detail = await geminiRes.text();
        throw new Error(`gemini generate error (${geminiRes.status}): ${detail}`);
    }
    const geminiData = await geminiRes.json();
    const answer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
        answer,
        sources: (matches || []).map((m) => ({
            pageId: m.page_id,
            title: m.page_title || '(無題)',
            similarity: m.similarity,
            excerpt: m.content.slice(0, 120),
        })),
    };
}

// ── 記事ごとの内容分析 ──────────────────────────────────────────────────────
// タグを付けるための処理ではない。「この記事が何を論じているか」だけを記事単独で読み取り、
// 保存しておく。タグはこれらを統合した結果として、あとからボトムアップに生まれる。
// そのため、ここでは既存のタグ語彙を一切プロンプトに含めない。

const ANALYZE_PROMPT = `あなたはこのアーカイブの書き手のアシスタントです。以下の記事それぞれを読んで、内容を分析してください。

重要な前提: 既存の分類やタグは一切考慮しないでください。それぞれの記事そのものが何を扱い、何を論じているかだけを見てください。
分類のために都合よく丸めず、実際に書かれていることに即して抽出してください。
記事どうしを揃えようとせず、1件ずつ独立に読んでください。

出力は次の形のJSONのみ。前後に説明やコードブロックの記号を付けないでください。
入力された記事すべてについて、idをそのまま使って返してください。
{
  "results": [
    {
      "id": 記事のid(数値),
      "summary": "1〜2文で、この記事が何を論じているか",
      "themes": ["この記事の主題。2〜4個。抽象度は中くらい(「建築」のように広すぎず、固有名詞のように狭すぎない)"],
      "concepts": ["論の中で鍵になっている概念や語。3〜6個"],
      "subjects": ["具体的に言及されている書名・人名・作品・場所・製品。0〜8個。無ければ空配列"]
    }
  ]
}`;

/** GeminiがJSONをコードブロックで包んで返すことがあるので、それを剥がして解析する */
function parseJsonLoose(text) {
    const cleaned = String(text || '').trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) throw new Error('JSONが見つかりません: ' + cleaned.slice(0, 200));
    return JSON.parse(cleaned.slice(start, end + 1));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Geminiで生成する。503(一時的な混雑)は少し待って1度だけ再試行し、
 * 429(利用上限)はステータスを付けて投げ直す。上限に達したら処理を続けても無駄なため。
 */
async function geminiGenerate(prompt, geminiKey, retries = 1) {
    for (let attempt = 0; ; attempt++) {
        const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${encodeURIComponent(geminiKey)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: 'application/json' },
                }),
            }
        );
        if (r.ok) return r.json();
        const detail = (await r.text()).slice(0, 200);
        if (r.status === 503 && attempt < retries) { await sleep(2000); continue; }
        const err = new Error(`gemini ${r.status}: ${detail}`);
        err.status = r.status;
        throw err;
    }
}

function contentHash(text) {
    return require('node:crypto').createHash('sha1').update(String(text || '')).digest('hex');
}

async function analyzeArticles({ serviceKey, geminiKey, limit, force, skip }) {
    const articles = await supabaseRest('/articles?select=id,title,content&order=id', serviceKey, { method: 'GET' });
    const done = await supabaseRest('/article_analysis?select=article_id,content_hash', serviceKey, { method: 'GET' });
    const hashById = new Map((done || []).map((r) => [r.article_id, r.content_hash]));

    // 一度失敗した記事は呼び出し側から渡してもらって除外する。
    // 除外しないと保存されないまま pending に残り続け、同じ記事を延々と再試行してしまう
    const skipSet = new Set((skip || []).map(Number));

    // 本文が変わっていない記事は飛ばす。書き足すたびに全件を投げ直さずに済む
    const pending = (articles || []).filter((a) => {
        if (skipSet.has(a.id)) return false;
        const text = stripHtml(a.content);
        if (!text.trim()) return false;
        if (force) return true;
        return hashById.get(a.id) !== contentHash(text);
    });

    const processed = [];
    const failed = [];
    let quotaExceeded = false;

    // 無料枠は「1日あたりの回数」が少ない(2.5 Flashで20回)。1記事1リクエストだと
    // 26記事で26回かかって枠に収まらないので、複数記事をまとめて1回で投げる
    const batch = pending.slice(0, limit);
    if (batch.length) {
        const body = batch.map((a) => `## id: ${a.id}
### タイトル
${a.title || '(無題)'}
### 本文
${stripHtml(a.content).slice(0, 8000)}`).join('\n\n---\n\n');

        try {
            const data = await geminiGenerate(`${ANALYZE_PROMPT}\n\n# 記事\n\n${body}`, geminiKey);
            const parsed = parseJsonLoose(data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
            const results = Array.isArray(parsed.results) ? parsed.results : [];
            const byId = new Map(results.map((r) => [Number(r.id), r]));

            const rows = [];
            for (const article of batch) {
                const r = byId.get(article.id);
                if (!r) {
                    failed.push({ id: article.id, title: article.title, error: '結果が返りませんでした' });
                    continue;
                }
                rows.push({
                    article_id: article.id,
                    summary: String(r.summary || ''),
                    themes: Array.isArray(r.themes) ? r.themes.map(String) : [],
                    concepts: Array.isArray(r.concepts) ? r.concepts.map(String) : [],
                    subjects: Array.isArray(r.subjects) ? r.subjects.map(String) : [],
                    content_hash: contentHash(stripHtml(article.content)),
                    analyzed_at: new Date().toISOString(),
                });
                processed.push({ id: article.id, title: article.title, themes: rows[rows.length - 1].themes });
            }

            if (rows.length) {
                await supabaseRest('/article_analysis', serviceKey, {
                    method: 'POST',
                    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                    body: JSON.stringify(rows),
                });
            }
        } catch (e) {
            const message = String(e.message || e);
            for (const article of batch) {
                failed.push({ id: article.id, title: article.title, error: message });
            }
            // 利用上限に達したら、この先を試しても同じなので打ち切る
            if (e.status === 429) quotaExceeded = true;
        }
    }

    return {
        processed,
        failed,
        quotaExceeded,
        remaining: Math.max(0, pending.length - batch.length),
        total: (articles || []).length,
        analyzed: (done || []).length + processed.length,
    };
}

async function findWorkingModel(geminiKey) {
    const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(geminiKey)}`
    );
    if (!r.ok) throw new Error(`モデル一覧の取得に失敗 (${r.status}): ${(await r.text()).slice(0, 200)}`);
    const data = await r.json();
    const candidates = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        // 廃止版・プレビュー版・実験版・視覚/音声特化などは後回しにし、
        // 素の安定版らしい名前(flash / pro のみで余計な接尾辞が無いもの)を先に試す
        .sort((a, b) => {
            const score = (n) => {
                let s = 0;
                if (/preview|exp|thinking|vision|audio|tts|image|embed|deprecated/i.test(n)) s -= 10;
                if (/flash/i.test(n)) s += 3;
                if (/^gemini-\d+\.\d+-(flash|pro)$/i.test(n)) s += 5;
                return -s;
            };
            return score(a) - score(b);
        });

    const tried = [];
    for (const name of candidates.slice(0, 15)) {
        const r2 = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent?key=${encodeURIComponent(geminiKey)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'ok とだけ返してください' }] }],
                    generationConfig: { maxOutputTokens: 5 },
                }),
            }
        );
        if (r2.ok) {
            tried.push({ name, ok: true });
            return { working: name, tried, totalCandidates: candidates.length };
        }
        const detail = (await r2.text()).slice(0, 150);
        tried.push({ name, ok: false, status: r2.status, detail });
        // 利用上限に達したら、これ以上試しても分からないので打ち切る
        if (r2.status === 429) break;
    }
    return { working: null, tried, totalCandidates: candidates.length };
}

function stripHtml(html) {
    return String(html || '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function chunkText(text, maxLen = 800) {
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const chunks = [];
    let current = '';
    for (const p of paragraphs) {
        if (current && current.length + p.length + 2 > maxLen) {
            chunks.push(current);
            current = p;
        } else {
            current = current ? `${current}\n\n${p}` : p;
        }
        while (current.length > maxLen * 1.5) {
            chunks.push(current.slice(0, maxLen));
            current = current.slice(maxLen);
        }
    }
    if (current) chunks.push(current);
    return chunks;
}
