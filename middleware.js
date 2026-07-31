// SNS(X/Facebook/LINE/Slackなど)のクローラーは記事ページのJSを実行しないため、
// クライアント側でどれだけog:titleを書き換えても共有カードには反映されない。
// そのためクローラーからのアクセスだけ検知し、記事の内容を反映したHTMLをサーバー側で返す。

export const config = {
    matcher: '/article/:path*',
};

const SUPABASE_URL = 'https://eiyzlawmcyybchxzyozr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpeXpsYXdtY3l5YmNoeHp5b3pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMDI2MjQsImV4cCI6MjA5NTU3ODYyNH0.SZVwqWKkk31npqdiiG5m3HdkF4JnQ7SgEzThaFfZ4q4';

const BOT_UA_REGEX = /bot|facebookexternalhit|Twitterbot|Slackbot|LinkedInBot|Discordbot|TelegramBot|WhatsApp|Pinterest|Googlebot|Applebot|SkypeUriPreview/i;

export default async function middleware(request) {
    const ua = request.headers.get('user-agent') || '';
    if (!BOT_UA_REGEX.test(ua)) return;

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/article\/(\d+)\/?$/);
    if (!match) return;
    const id = match[1];

    try {
        const [articleRes, settingsRes] = await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${id}&select=title,content`, {
                headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
            }),
            fetch(`${SUPABASE_URL}/rest/v1/site_settings?id=eq.1&select=site_title,og_image`, {
                headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
            }),
        ]);
        const [articleRows, settingsRows] = await Promise.all([articleRes.json(), settingsRes.json()]);
        const article = articleRows && articleRows[0];
        if (!article) return;
        const settings = (settingsRows && settingsRows[0]) || {};

        const title = escapeAttr(article.title || settings.site_title || '');
        // 本文中の画像だけをそのままシェアカードにすると記事のタイトルが分からないので、
        // 常にタイトル入りの自動生成カードを使う(本文に画像があれば背景として敷く)。
        // ただし管理画面で手動でog_imageを設定している場合は、その意図を尊重してそのまま使う
        const contentImage = extractFirstImage(article.content);
        const image = settings.og_image
            || `${url.origin}/api/og-image?id=${id}${contentImage ? `&bg=${encodeURIComponent(contentImage)}` : ''}`;
        const description = escapeAttr(stripAndTruncate(article.content, 140));
        const siteName = escapeAttr(settings.site_title || '');
        const pageUrl = escapeAttr(url.toString());

        const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${pageUrl}">
${siteName ? `<meta property="og:site_name" content="${siteName}">` : ''}
${image ? `<meta property="og:image" content="${escapeAttr(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
${image ? `<meta name="twitter:image" content="${escapeAttr(image)}">` : ''}
</head>
<body></body>
</html>`;

        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    } catch (e) {
        return;
    }
}

function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripAndTruncate(html, max) {
    const text = String(html).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max) + '…' : text;
}

function extractFirstImage(html) {
    const m = String(html).match(/<img[^>]+src="([^"]+)"/);
    return m ? m[1] : null;
}
