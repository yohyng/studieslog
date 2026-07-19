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

    const articlesRes = await fetch(
        `${SUPABASE_URL}/rest/v1/articles?created_at=gt.${encodeURIComponent(lastSentAt)}&select=id,title,date,created_at&order=created_at.asc`,
        { headers: sbHeaders }
    );
    const articles = await articlesRes.json();

    if (!Array.isArray(articles) || articles.length === 0) {
        res.status(200).json({ sent: false, reason: 'no new articles since last send' });
        return;
    }

    const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/subscribers?select=email,unsubscribe_token`, { headers: sbHeaders });
    const subscribers = await subsRes.json();

    if (!Array.isArray(subscribers) || subscribers.length === 0) {
        res.status(200).json({ sent: false, reason: 'no subscribers' });
        return;
    }

    const listHtml = articles
        .map(a => `<li><a href="${siteUrl}/article/${a.id}">${escapeHtml(a.title)}</a> <span style="opacity:0.6;">(${escapeHtml(a.date)})</span></li>`)
        .join('');

    const messages = subscribers.map(sub => ({
        from: fromEmail,
        to: sub.email,
        subject: `今週の更新(${articles.length}件)`,
        html: `
            <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; line-height: 1.7;">
                <p>今週公開された記事です。</p>
                <ul>${listHtml}</ul>
                <p style="margin-top: 2em; font-size: 12px; opacity: 0.6;">
                    <a href="${siteUrl}/api/unsubscribe?token=${sub.unsubscribe_token}">配信停止はこちら</a>
                </p>
            </div>
        `,
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

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
