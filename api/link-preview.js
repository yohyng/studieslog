// 紹介リンク(書籍など)入力時に、リンク先のOGP(タイトル・画像)を取得してカード表示用データを返す。
// 誰でも叩けるエンドポイントなので、http(s)以外・ローカル/プライベートアドレスへのリクエストは弾く(SSRF対策)。
//
// 取得に失敗しても200で返し、reason に理由を入れる。管理画面はそれを出して原因を追えるようにする
// (以前は失敗時もdomainだけ返していたため、ネットワークの問題かタグが無いのか区別できなかった)。

const MAX_BYTES = 300000;   // <head>に大抵のOGPタグは収まるので先頭だけ読む
const TIMEOUT_MS = 8000;

// 通常のブラウザを装う。自己申告のbot UAだと一部サイト(Amazon等)がOGPの入っていない
// 簡易ページを返すため。弾かれた場合に備えて、検索エンジンのbotとしても試す
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

module.exports = async function handler(req, res) {
    const target = req.query.url;
    if (!target || typeof target !== 'string') {
        res.status(400).json({ error: 'url is required' });
        return;
    }

    let parsed;
    try {
        parsed = new URL(target);
    } catch (e) {
        res.status(400).json({ error: 'invalid url' });
        return;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        res.status(400).json({ error: 'unsupported protocol' });
        return;
    }
    if (isBlockedHostname(parsed.hostname)) {
        res.status(400).json({ error: 'this host is not allowed' });
        return;
    }

    const domain = parsed.hostname;
    let lastReason = 'unknown';

    // ブラウザのUAで弾かれるサイトと、botのUAで弾かれるサイトの両方があるので順に試す
    for (const ua of [UA_BROWSER, UA_BOT]) {
        const page = await fetchPage(parsed.toString(), ua);
        if (!page.ok) {
            lastReason = page.reason;
            continue;
        }

        const html = decodeBody(page.bytes, page.contentType);
        const title = decodeEntities(extractMeta(html, 'og:title') || extractTitleTag(html) || '').trim();
        let image = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image');
        if (image) {
            try {
                image = new URL(decodeEntities(image), page.finalUrl).toString();
            } catch (e) {
                image = null;
            }
        }

        if (title || image) {
            res.status(200).json({ title: title || null, image: image || null, domain, reason: null });
            return;
        }
        // 取得はできたがタグが無かった。UAを変えると出てくることがあるので次を試す
        lastReason = 'no_og_tags';
    }

    res.status(200).json({ title: null, image: null, domain, reason: lastReason });
};

/** ページの先頭だけを取得する。本文はデコードせずバイト列のまま返す(文字コード判定のため) */
async function fetchPage(url, userAgent) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            headers: {
                'user-agent': userAgent,
                'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                // WAFがブラウザらしさの判定に使うことがあるヘッダを添える
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'none',
                'upgrade-insecure-requests': '1',
            },
            redirect: 'follow',
            signal: controller.signal,
        });

        if (!response.ok) {
            return { ok: false, reason: `http_${response.status}` };
        }

        const chunks = [];
        let total = 0;
        const reader = response.body.getReader();
        while (total < MAX_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.length;
        }
        reader.cancel().catch(() => {});

        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
            bytes.set(c, offset);
            offset += c.length;
        }

        return {
            ok: true,
            bytes,
            finalUrl: response.url || url,
            contentType: response.headers.get('content-type') || '',
        };
    } catch (e) {
        return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : 'fetch_failed' };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 文字コードを判定してからデコードする。
 * 日本語のサイトにはShift_JISやEUC-JPのものがあり、UTF-8決め打ちだとタイトルが文字化けする。
 */
function decodeBody(bytes, contentType) {
    const charset = detectCharset(bytes, contentType);
    try {
        return new TextDecoder(charset).decode(bytes);
    } catch (e) {
        return new TextDecoder('utf-8').decode(bytes);
    }
}

function detectCharset(bytes, contentType) {
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';

    const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '');
    if (fromHeader) return normalizeCharset(fromHeader[1]);

    // metaタグ自体はASCII互換の範囲にあるので、一旦latin1で覗いて探す
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 8192));
    const m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)
        || /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w-]+)/i.exec(head);
    return m ? normalizeCharset(m[1]) : 'utf-8';
}

function normalizeCharset(name) {
    const c = String(name).toLowerCase();
    if (c === 'shift-jis' || c === 'x-sjis' || c === 'ms932' || c === 'windows-31j') return 'shift_jis';
    if (c === 'euc_jp') return 'euc-jp';
    return c;
}

function isBlockedHostname(hostname) {
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0') return true;
    if (h === '::1') return true;
    // IPv4リテラルのプライベート/ループバック/リンクローカル帯域
    const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
        const a = Number(ipv4[1]), b = Number(ipv4[2]);
        if (a === 127 || a === 10 || a === 0) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
    }
    return false;
}

function extractMeta(html, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    return m ? m[1] : null;
}

function extractTitleTag(html) {
    const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return m ? m[1].trim() : null;
}

function decodeEntities(str) {
    return String(str)
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}
