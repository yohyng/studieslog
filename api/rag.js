// 執筆補助RAGの試作。自分の過去記事をチャンクに分けて埋め込みベクトル化して保存し(action=reindex)、
// 執筆中の質問・相談に対して近い過去記事を検索し、それを参考としてGeminiに答えさせる(action=ask)。
// 管理画面からのみ呼ばれる。APIキーはこの関数の外(ブラウザ側)には一切渡さない。

const SUPABASE_URL = 'https://eiyzlawmcyybchxzyozr.supabase.co';
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
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
