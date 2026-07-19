// 紹介リンク(書籍など)入力時に、リンク先のOGP(タイトル・画像)を取得してカード表示用データを返す。
// 誰でも叩けるエンドポイントなので、http(s)以外・ローカル/プライベートアドレスへのリクエストは弾く(SSRF対策)。

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

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(parsed.toString(), {
            headers: {
                'user-agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0; +https://vercel.com)',
                accept: 'text/html',
            },
            redirect: 'follow',
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
            res.status(200).json({ title: null, image: null, domain: parsed.hostname });
            return;
        }

        // 巨大なページで無駄に時間・メモリを使わないよう、先頭だけ読む(<head>に大抵のOGPタグは収まる)
        const reader = response.body.getReader();
        let html = '';
        const decoder = new TextDecoder();
        let bytesRead = 0;
        const MAX_BYTES = 300000;
        while (bytesRead < MAX_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesRead += value.length;
            html += decoder.decode(value, { stream: true });
        }
        reader.cancel().catch(() => {});

        const finalUrl = response.url || parsed.toString();
        const title = decodeEntities(extractMeta(html, 'og:title') || extractTitleTag(html) || '');
        let image = extractMeta(html, 'og:image');
        if (image) {
            try {
                image = new URL(image, finalUrl).toString();
            } catch (e) {
                image = null;
            }
        }

        res.status(200).json({ title: title || null, image: image || null, domain: parsed.hostname });
    } catch (e) {
        res.status(200).json({ title: null, image: null, domain: parsed.hostname });
    }
};

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
