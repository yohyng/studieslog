// Vercel Cron(vercel.jsonのcrons)から週1回呼ばれる。前回送信以降に公開された記事があれば、
// 購読者全員にダイジェストメールを送る。なければ何もしない。

const SUPABASE_URL = 'https://eiyzlawmcyybchxzyozr.supabase.co';

module.exports = async function handler(req, res) {
    const auth = req.headers.authorization || '';
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.NEWSLETTER_FROM_EMAIL;
    const siteUrl = process.env.SITE_URL;
    if (!serviceKey || !resendKey || !fromEmail || !siteUrl) {
        res.status(500).json({ error: 'missing required environment variables' });
        return;
    }

    const sbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    const stateRes = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_state?id=eq.1&select=last_sent_at`, { headers: sbHeaders });
    const stateRows = await stateRes.json();
    const lastSentAt = (stateRows && stateRows[0] && stateRows[0].last_sent_at) || new Date(0).toISOString();

    const [articlesRes, settingsRes] = await Promise.all([
        fetch(
            `${SUPABASE_URL}/rest/v1/articles?created_at=gt.${encodeURIComponent(lastSentAt)}&status=eq.published&select=id,title,date,content,created_at&order=created_at.asc`,
            { headers: sbHeaders }
        ),
        fetch(`${SUPABASE_URL}/rest/v1/site_settings?id=eq.1&select=site_title,og_image`, { headers: sbHeaders }),
    ]);
    const rawArticles = await articlesRes.json();
    const settingsRows = await settingsRes.json();
    const settings = (settingsRows && settingsRows[0]) || {};
    const siteTitle = settings.site_title || '';

    if (!Array.isArray(rawArticles) || rawArticles.length === 0) {
        res.status(200).json({ sent: false, reason: 'no new articles since last send' });
        return;
    }

    const articles = rawArticles.map(a => ({
        id: a.id,
        title: a.title,
        date: a.date,
        image: extractFirstImage(a.content) || settings.og_image || null,
    }));

    const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/subscribers?select=email,unsubscribe_token`, { headers: sbHeaders });
    const subscribers = await subsRes.json();

    if (!Array.isArray(subscribers) || subscribers.length === 0) {
        res.status(200).json({ sent: false, reason: 'no subscribers' });
        return;
    }

    const messages = subscribers.map(sub => ({
        from: fromEmail,
        to: sub.email,
        subject: `【${siteTitle}】今週の更新(${articles.length}件)`,
        html: buildDigestHtml({
            siteTitle,
            siteUrl,
            articles,
            unsubscribeUrl: `${siteUrl}/api/unsubscribe?token=${sub.unsubscribe_token}`,
        }),
    }));

    // Resendのbatch送信APIは一度に最大100件まで
    for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100);
        const sendRes = await fetch('https://api.resend.com/emails/batch', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(chunk),
        });
        if (!sendRes.ok) {
            const detail = await sendRes.text();
            console.error('resend batch send failed', detail);
            res.status(502).json({ error: 'failed to send digest', detail });
            return;
        }
    }

    await fetch(`${SUPABASE_URL}/rest/v1/newsletter_state?id=eq.1`, {
        method: 'PATCH',
        headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ last_sent_at: new Date().toISOString() }),
    });

    res.status(200).json({ sent: true, articleCount: articles.length, subscriberCount: subscribers.length });
};

// 週次ダイジェストのメール本文。admin.htmlのプレビュー機能もこれと同じ見た目になるよう手動で揃えている。
// テーブルレイアウトなのは、古いOutlookなどflexbox非対応のメールクライアントでも崩れないようにするため
function buildDigestHtml({ siteTitle, siteUrl, articles, unsubscribeUrl }) {
    const fontStack = "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif";
    const rows = articles.map(a => {
        const url = `${siteUrl}/article/${a.id}`;
        const imageCell = a.image
            ? `<td width="64" style="width:64px; padding-right:14px; vertical-align:top;"><img src="${escapeHtml(a.image)}" width="64" height="64" style="width:64px; height:64px; object-fit:cover; border-radius:6px; display:block;" alt=""></td>`
            : '';
        return `
            <a href="${url}" style="text-decoration:none; display:block; padding:16px 0; border-bottom:1px solid #e8e4da;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                    <tr>
                        ${imageCell}
                        <td style="vertical-align:middle;">
                            <div style="font-size:11px; color:#9a9284; margin-bottom:4px; font-family:${fontStack};">${escapeHtml(a.date)}</div>
                            <div style="font-size:15px; color:#2b2b28; font-weight:600; line-height:1.5; font-family:${fontStack};">${escapeHtml(a.title)}</div>
                        </td>
                    </tr>
                </table>
            </a>
        `;
    }).join('');

    return `<!doctype html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#f4f1ea;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f1ea;">
        <tr>
            <td align="center" style="padding: 40px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; font-family:${fontStack};">
                    <tr>
                        <td align="center" style="padding-bottom: 32px;">
                            <div style="font-size:11px; letter-spacing:0.15em; color:#a39c8c; text-transform:uppercase; margin-bottom:10px;">Weekly Update</div>
                            <div style="font-size:22px; color:#2b2b28; font-weight:600;">${escapeHtml(siteTitle)}</div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 4px;">
                            <p style="font-size:14px; color:#5a5548; line-height:1.8; margin:0 0 8px;">今週、${articles.length}件の記事を公開しました。</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 4px;">
                            ${rows}
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding: 36px 0 8px;">
                            <a href="${siteUrl}" style="display:inline-block; padding:12px 28px; background-color:#2b2b28; color:#ffffff; text-decoration:none; border-radius:4px; font-size:13px;">サイトで読む</a>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding-top: 40px; border-top: 1px solid #e8e4da;">
                            <p style="font-size:11px; color:#a39c8c; line-height:1.8; margin: 24px 0 0;">
                                このメールは ${escapeHtml(siteTitle)} の更新通知として送信されています。<br>
                                <a href="${unsubscribeUrl}" style="color:#a39c8c;">配信停止はこちら</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractFirstImage(html) {
    const m = String(html).match(/<img[^>]+src="([^"]+)"/);
    return m ? m[1] : null;
}
