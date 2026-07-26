// 管理画面の記事編集画面から呼ばれる。NotionのDBを参照専用のサイドパネルに出すための橋渡し。
// APIキーはこの関数の外(ブラウザ側)には一切渡さない。呼び出し元はログイン中ユーザーの
// アクセストークンを送り、この関数がSupabaseに問い合わせて本人確認してから読み取りだけ行う。

const SUPABASE_URL = 'https://eiyzlawmcyybchxzyozr.supabase.co';
const NOTION_VERSION = '2022-06-28';
// このチェックボックスプロパティがtrueのページは、一覧から除外する(「完了」操作)。
// 対象DBにこのプロパティが無い場合は、絞り込みなし・完了操作なしで動く(下のcatchで自動フォールバック)。
const COMPLETE_PROPERTY = process.env.NOTION_COMPLETE_PROPERTY || 'Completed';

module.exports = async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
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
    const notionKey = process.env.NOTION_API_KEY;
    const databases = getConfiguredDatabases();
    if (!serviceKey || !notionKey || !databases.length) {
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

    try {
        if (req.method === 'POST') {
            const action = req.body?.action;
            if (action === 'complete') {
                const pageId = typeof req.body?.pageId === 'string' ? req.body.pageId : '';
                if (!pageId) {
                    res.status(400).json({ error: 'pageId is required' });
                    return;
                }
                await markPageComplete(pageId, notionKey);
                res.status(200).json({ ok: true });
                return;
            }
            res.status(400).json({ error: 'unknown action' });
            return;
        }

        const action = req.query.action;

        if (action === 'databases') {
            res.status(200).json({ databases });
            return;
        }

        if (action === 'page') {
            const pageId = typeof req.query.id === 'string' ? req.query.id : '';
            if (!pageId) {
                res.status(400).json({ error: 'id is required' });
                return;
            }
            const html = await fetchPagePreviewHtml(pageId, notionKey);
            res.status(200).json({ html });
            return;
        }

        if (!action || action === 'list') {
            const requestedDb = typeof req.query.db === 'string' ? req.query.db : '';
            const database = requestedDb ? databases.find((d) => d.id === requestedDb) : databases[0];
            if (!database) {
                res.status(400).json({ error: 'unknown database' });
                return;
            }
            const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
            const result = await fetchDatabaseList(database.id, notionKey, cursor);
            res.status(200).json(result);
            return;
        }

        res.status(400).json({ error: 'unknown action' });
    } catch (e) {
        console.error(e);
        res.status(502).json({ error: 'notion request failed' });
    }
};

// 複数DBを登録できるよう、NOTION_DATABASESに [{id, name}, ...] のJSONを入れる想定。
// 単一DBのみ使う場合は、これまで通りNOTION_DATABASE_ID(+任意でNOTION_DATABASE_NAME)だけでも動く。
function getConfiguredDatabases() {
    const raw = process.env.NOTION_DATABASES;
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed
                    .filter((d) => d && typeof d.id === 'string' && d.id)
                    .map((d) => ({ id: d.id, name: typeof d.name === 'string' && d.name ? d.name : d.id }));
            }
        } catch (e) {
            console.error('failed to parse NOTION_DATABASES', e);
        }
    }
    const singleId = process.env.NOTION_DATABASE_ID;
    if (singleId) {
        return [{ id: singleId, name: process.env.NOTION_DATABASE_NAME || 'Notion DB' }];
    }
    return [];
}

async function notionFetch(path, notionKey, options = {}) {
    const response = await fetch(`https://api.notion.com/v1${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${notionKey}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    if (!response.ok) {
        const detail = await response.text();
        const error = new Error(`notion api error (${response.status}): ${detail}`);
        error.status = response.status;
        throw error;
    }
    return response.json();
}

async function fetchDatabaseList(databaseId, notionKey, cursor) {
    const baseBody = {
        page_size: 50,
        ...(cursor ? { start_cursor: cursor } : {}),
    };
    let data;
    try {
        // 完了プロパティがあるDBでは、完了済みのページを一覧から除外する
        data = await notionFetch(`/databases/${encodeURIComponent(databaseId)}/query`, notionKey, {
            method: 'POST',
            body: JSON.stringify({
                ...baseBody,
                filter: { property: COMPLETE_PROPERTY, checkbox: { equals: false } },
            }),
        });
    } catch (e) {
        // 対象DBに完了プロパティが無ければ、絞り込みなしで取り直す
        if (e.status === 400) {
            data = await notionFetch(`/databases/${encodeURIComponent(databaseId)}/query`, notionKey, {
                method: 'POST',
                body: JSON.stringify(baseBody),
            });
        } else {
            throw e;
        }
    }

    const items = (data.results || []).map((page) => ({
        id: page.id,
        url: page.url,
        title: extractTitle(page.properties),
        properties: summarizeProperties(page.properties),
    }));

    return { items, hasMore: !!data.has_more, nextCursor: data.next_cursor || null };
}

async function markPageComplete(pageId, notionKey) {
    await notionFetch(`/pages/${encodeURIComponent(pageId)}`, notionKey, {
        method: 'PATCH',
        body: JSON.stringify({
            properties: {
                [COMPLETE_PROPERTY]: { checkbox: true },
            },
        }),
    });
}

async function fetchPagePreviewHtml(pageId, notionKey) {
    const blocks = [];
    let cursor;
    // プレビュー用途なので、量が多い記事でも重くならないよう上限を設ける
    const MAX_BLOCKS = 200;
    do {
        const data = await notionFetch(
            `/blocks/${encodeURIComponent(pageId)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`,
            notionKey,
            { method: 'GET' }
        );
        blocks.push(...(data.results || []));
        cursor = data.has_more ? data.next_cursor : null;
    } while (cursor && blocks.length < MAX_BLOCKS);

    return blocksToHtml(blocks.slice(0, MAX_BLOCKS));
}

function extractTitle(properties) {
    if (!properties) return '(無題)';
    for (const key of Object.keys(properties)) {
        const prop = properties[key];
        if (prop.type === 'title') {
            const text = richTextToPlain(prop.title);
            return text || '(無題)';
        }
    }
    return '(無題)';
}

function summarizeProperties(properties) {
    if (!properties) return [];
    const out = [];
    for (const name of Object.keys(properties)) {
        const prop = properties[name];
        if (prop.type === 'title') continue;
        if (name === COMPLETE_PROPERTY) continue;
        const value = propertyValueToText(prop);
        if (value === null) continue;
        out.push({ name, type: prop.type, value });
    }
    return out;
}

function propertyValueToText(prop) {
    switch (prop.type) {
        case 'rich_text':
            return richTextToPlain(prop.rich_text) || null;
        case 'number':
            return prop.number === null || prop.number === undefined ? null : String(prop.number);
        case 'select':
            return prop.select ? prop.select.name : null;
        case 'multi_select':
            return prop.multi_select && prop.multi_select.length ? prop.multi_select.map((o) => o.name).join(', ') : null;
        case 'status':
            return prop.status ? prop.status.name : null;
        case 'date':
            if (!prop.date) return null;
            return prop.date.end ? `${prop.date.start} → ${prop.date.end}` : prop.date.start;
        case 'checkbox':
            return prop.checkbox ? '✓' : '—';
        case 'people':
            return prop.people && prop.people.length ? prop.people.map((p) => p.name || '(名前非公開)').join(', ') : null;
        case 'url':
            return prop.url || null;
        case 'email':
            return prop.email || null;
        case 'phone_number':
            return prop.phone_number || null;
        case 'created_time':
            return prop.created_time || null;
        case 'last_edited_time':
            return prop.last_edited_time || null;
        case 'relation':
            return prop.relation && prop.relation.length ? `関連${prop.relation.length}件` : null;
        case 'formula':
            return prop.formula ? formulaOrRollupToText(prop.formula) : null;
        case 'rollup':
            return prop.rollup ? formulaOrRollupToText(prop.rollup) : null;
        default:
            return null;
    }
}

function formulaOrRollupToText(value) {
    if (value.type === 'string') return value.string || null;
    if (value.type === 'number') return value.number === null || value.number === undefined ? null : String(value.number);
    if (value.type === 'boolean') return value.boolean ? '✓' : '—';
    if (value.type === 'date') return value.date ? value.date.start : null;
    if (value.type === 'array') return value.array.map((v) => formulaOrRollupToText(v)).filter(Boolean).join(', ') || null;
    return null;
}

function richTextToPlain(richText) {
    if (!richText || !richText.length) return '';
    return richText.map((t) => t.plain_text || '').join('');
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function blocksToHtml(blocks) {
    const parts = [];
    for (const block of blocks) {
        const type = block.type;
        const data = block[type];
        if (!data) continue;
        const text = data.rich_text ? escapeHtml(richTextToPlain(data.rich_text)) : '';
        switch (type) {
            case 'paragraph':
                parts.push(`<p>${text || '&nbsp;'}</p>`);
                break;
            case 'heading_1':
                parts.push(`<h1>${text}</h1>`);
                break;
            case 'heading_2':
                parts.push(`<h2>${text}</h2>`);
                break;
            case 'heading_3':
                parts.push(`<h3>${text}</h3>`);
                break;
            case 'bulleted_list_item':
                parts.push(`<li>${text}</li>`);
                break;
            case 'numbered_list_item':
                parts.push(`<li>${text}</li>`);
                break;
            case 'to_do':
                parts.push(`<p>${data.checked ? '☑' : '☐'} ${text}</p>`);
                break;
            case 'quote':
                parts.push(`<blockquote>${text}</blockquote>`);
                break;
            case 'callout':
                parts.push(`<p>💡 ${text}</p>`);
                break;
            case 'code':
                parts.push(`<pre>${text}</pre>`);
                break;
            case 'divider':
                parts.push('<hr>');
                break;
            case 'bookmark':
            case 'link_preview':
                parts.push(`<p><a href="${escapeHtml(data.url || '')}" target="_blank" rel="noopener">${escapeHtml(data.url || '')}</a></p>`);
                break;
            case 'image':
                parts.push(`<p>🖼 ${escapeHtml(data.caption ? richTextToPlain(data.caption) : '画像')}</p>`);
                break;
            default:
                if (text) parts.push(`<p>${text}</p>`);
        }
    }
    return parts.join('\n') || '<p class="text-white/30">(本文なし)</p>';
}
