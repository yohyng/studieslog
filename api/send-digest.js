// Vercel Cron(vercel.jsonのcrons)から週1回呼ばれる。前回送信以降に公開された記事があれば、
// 購読者全員にダイジェストメールを送る。なければ何もしない。

const { buildDigestHtml } = require('../lib/digest-template');

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
    const nowIso = new Date().toISOString();

    // 公開済み記事は作成日時、予約投稿は予約日時を基準に「前回送信以降の新着」を判定する
    // (予約投稿はcronで自動的にstatusが書き換わらないため、created_atだけで判定すると予定日時を過ぎても永久に拾われない)
    const orFilter = `or=(and(status.eq.published,created_at.gt.${encodeURIComponent(lastSentAt)}),and(status.eq.scheduled,scheduled_at.gt.${encodeURIComponent(lastSentAt)},scheduled_at.lte.${encodeURIComponent(nowIso)}))`;

    const [articlesRes, settingsRes] = await Promise.all([
        fetch(
            `${SUPABASE_URL}/rest/v1/articles?${orFilter}&select=id,title,date,category,content,created_at&order=created_at.asc`,
            { headers: sbHeaders }
        ),
        // メールを閲覧ページと同じ見た目にするため、表示設定も一式取る
        fetch(`${SUPABASE_URL}/rest/v1/site_settings?id=eq.1&select=site_title,og_image,digest_bg_color,digest_text_color,digest_bg_image,font,title_font,font_size,line_height,letter_spacing,text_align,content_width,bg_color,text_color,body_text_opacity,title_text_opacity,footnote_color,footnote_bg_color`, { headers: sbHeaders }),
    ]);
    const rawArticles = await articlesRes.json();
    const settingsRows = await settingsRes.json();
    const settings = (settingsRows && settingsRows[0]) || {};
    const siteTitle = settings.site_title || '';

    if (!Array.isArray(rawArticles) || rawArticles.length === 0) {
        res.status(200).json({ sent: false, reason: 'no new articles since last send' });
        return;
    }

    // 記事本文をそのまま載せる(抜粋ではなく全文)
    const articles = rawArticles.map(a => ({
        id: a.id,
        title: a.title,
        date: a.date,
        category: a.category || '',
        content: a.content || '',
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
            // digest_* は設定されていればメールだけ上書きする。空ならサイト本体の色に従う
            bgColor: settings.digest_bg_color,
            textColor: settings.digest_text_color,
            fontFamily: settings.font,
            typography: settings,
            bgImage: settings.digest_bg_image,
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
