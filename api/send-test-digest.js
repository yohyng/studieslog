// 管理画面から呼ばれる。購読者リストの中で「管理者用テストアドレス」に指定された1件だけに、
// 実際にResendでダイジェストメールを送る(見え方の実機確認用。他の購読者には送らない)。

const { buildDigestHtml } = require('../lib/digest-template');

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
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.NEWSLETTER_FROM_EMAIL;
    const siteUrl = process.env.SITE_URL;
    if (!serviceKey || !resendKey || !fromEmail || !siteUrl) {
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

    const sbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    const [subRes, settingsRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/subscribers?is_admin_test=eq.true&select=email,unsubscribe_token&limit=1`, { headers: sbHeaders }),
        // メールを閲覧ページと同じ見た目にするため、表示設定も一式取る
        fetch(`${SUPABASE_URL}/rest/v1/site_settings?id=eq.1&select=site_title,og_image,digest_bg_color,digest_text_color,font,title_font,font_size,line_height,letter_spacing,text_align,content_width,bg_color,text_color,body_text_opacity,title_text_opacity,footnote_color`, { headers: sbHeaders }),
    ]);
    const subRows = await subRes.json();
    const adminSub = Array.isArray(subRows) ? subRows[0] : null;
    if (!adminSub) {
        res.status(400).json({ error: 'no admin test address is set' });
        return;
    }

    const settingsRows = await settingsRes.json();
    const settings = (settingsRows && settingsRows[0]) || {};
    const siteTitle = settings.site_title || '';

    const nowIso = new Date().toISOString();
    const orFilter = `or=(status.eq.published,and(status.eq.scheduled,scheduled_at.lte.${encodeURIComponent(nowIso)}))`;
    const articlesRes = await fetch(
        `${SUPABASE_URL}/rest/v1/articles?${orFilter}&select=id,title,date,category,content,created_at&order=created_at.desc&limit=5`,
        { headers: sbHeaders }
    );
    const rawArticles = await articlesRes.json();
    const articles = (Array.isArray(rawArticles) ? rawArticles : []).reverse().map(a => ({
        id: a.id,
        title: a.title,
        date: a.date,
        category: a.category || '',
        content: a.content || '',
    }));

    if (articles.length === 0) {
        res.status(400).json({ error: 'no published articles to include' });
        return;
    }

    const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: fromEmail,
            to: adminSub.email,
            subject: `【テスト】【${siteTitle}】今週の更新(${articles.length}件)`,
            html: buildDigestHtml({
                siteTitle,
                siteUrl,
                articles,
                unsubscribeUrl: `${siteUrl}/api/unsubscribe?token=${adminSub.unsubscribe_token}`,
                bgColor: settings.digest_bg_color,
                textColor: settings.digest_text_color,
                fontFamily: settings.font,
                typography: settings,
            }),
        }),
    });

    if (!sendRes.ok) {
        const detail = await sendRes.text();
        console.error('resend test send failed', detail);
        res.status(502).json({ error: 'failed to send test email', detail });
        return;
    }

    res.status(200).json({ sent: true, to: adminSub.email, articleCount: articles.length });
};
