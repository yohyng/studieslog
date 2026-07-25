// 管理画面の記事編集から呼ばれる。日本語のタイトル・本文(HTML)をGemini APIで英訳して返す。
// APIキーはこの関数の外(ブラウザ側)には一切渡さない。呼び出し元はログイン中ユーザーの
// アクセストークンを送り、この関数がSupabaseに問い合わせて本人確認してから翻訳を実行する。

const SUPABASE_URL = 'https://eiyzlawmcyybchxzyozr.supabase.co';

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

    const title = typeof req.body?.title === 'string' ? req.body.title : '';
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!title.trim() && !content.trim()) {
        res.status(400).json({ error: 'title or content is required' });
        return;
    }
    // 無関係に巨大なリクエストで料金だけ膨らむのを防ぐ
    if (content.length > 50000) {
        res.status(400).json({ error: 'content is too long' });
        return;
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const prompt = `あなたは日本語のブログ記事を英語に翻訳する翻訳者です。以下のタイトルと本文(HTML)を、英語ネイティブが読んで自然な文章に翻訳してください。

- 本文はHTMLです。タグ・属性(class、hrefなど)は一切変更せず、タグの中のテキストだけを翻訳してください。
- 固有名詞・書籍名・人名などは、一般的な英語表記があればそれを使い、無ければ元の表記を活かしてください。
- 見出しの語調・段落構成は元の文章の構造をそのまま保ってください。
- 出力は指定のJSONスキーマ(title_en, content_en)のみで、それ以外の説明文は含めないでください。

タイトル:
${title}

本文(HTML):
${content}`;

    try {
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: 'object',
                            properties: {
                                title_en: { type: 'string' },
                                content_en: { type: 'string' },
                            },
                            required: ['title_en', 'content_en'],
                        },
                    },
                }),
            }
        );

        if (!geminiRes.ok) {
            const detail = await geminiRes.text();
            console.error('gemini translate failed', detail);
            res.status(502).json({ error: 'translation request failed' });
            return;
        }

        const data = await geminiRes.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            res.status(502).json({ error: 'translation returned no content' });
            return;
        }

        const parsed = JSON.parse(text);
        res.status(200).json({
            title_en: parsed.title_en || '',
            content_en: parsed.content_en || '',
        });
    } catch (e) {
        console.error(e);
        res.status(502).json({ error: 'translation failed' });
    }
};
