// Vercel Cron(vercel.jsonのcrons)から週1回呼ばれる。前回送信以降に公開された記事があれば、
// 購読者全員にダイジェストメールを送る。なければ何もしない。

const { buildDigestHtml, buildDigestSubject, buildDigestFrom, sortDigestArticles } = require('../lib/digest-template');

const SUPABASE_URL = 'https://eiyzlawmcyybchxzyozr.supabase.co';

// articles.date は「2026.08.03」形式のテキストで、閲覧ページの並び順にも使っている実質の公開日。
// 記事を書いた人が日本時間で入力する前提なので、比較する境界日も日本時間に直して同じ書式に揃える
function toArticleDateString(iso) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(iso));
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get('year')}.${get('month')}.${get('day')}`;
}

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

    // 公開済み記事は「作成日時が前回送信より後」または「日付(date)が前回送信日より後」で新着と見なす。
    //
    // created_at だけで見ていると、非公開や下書きのまま寝かせておいた記事を後から公開したときに、
    // 作成日時が古いままなので永久に拾われない。date は公開時にどのみち直す値(閲覧ページの並び順が
    // これなので、直さないと一覧の中ほどに埋もれる)なので、そちらでも拾えるようにする。
    //
    // 逆に date だけで見ると、date は日単位しか持たないため、送信した当日にもう1本公開した記事が
    // 「前回送信日より後」に当てはまらず落ちてしまう。両方のORにしておくと、片方が取りこぼす分を
    // もう片方が拾う。今の条件に足す形なので、これまで送られていた記事が送られなくなることはない。
    //
    // 予約投稿は予約日時を基準にする(予約投稿はcronで自動的にstatusが書き換わらないため、
    // created_atだけで判定すると予定日時を過ぎても永久に拾われない)
    const lastSentDay = toArticleDateString(lastSentAt);
    const publishedFilter = `and(status.eq.published,or(created_at.gt.${encodeURIComponent(lastSentAt)},date.gt.${encodeURIComponent(lastSentDay)}))`;
    const scheduledFilter = `and(status.eq.scheduled,scheduled_at.gt.${encodeURIComponent(lastSentAt)},scheduled_at.lte.${encodeURIComponent(nowIso)})`;
    const orFilter = `or=(${publishedFilter},${scheduledFilter})`;

    const [articlesRes, settingsRes] = await Promise.all([
        fetch(
            // 並び順も閲覧ページ(date降順)に合わせる。メールは古い順に並べたいのでascにする
            `${SUPABASE_URL}/rest/v1/articles?${orFilter}&select=id,title,date,category,content,created_at&order=date.asc,id.asc`,
            { headers: sbHeaders }
        ),
        // メールを閲覧ページと同じ見た目にするため、表示設定も一式取る
        fetch(`${SUPABASE_URL}/rest/v1/site_settings?id=eq.1&select=site_title,og_image,digest_bg_color,digest_text_color,digest_bg_image,font,title_font,font_size,line_height,letter_spacing,text_align,content_width,bg_color,text_color,body_text_opacity,title_text_opacity,footnote_color,footnote_bg_color`, { headers: sbHeaders }),
    ]);
    const rawArticles = await articlesRes.json();
    const settingsRows = await settingsRes.json();
    const settings = (settingsRows && settingsRows[0]) || {};
    const siteTitle = settings.site_title || '';

    // 抽出条件の書式を誤ると配列ではなくエラーオブジェクトが返る。これを「新着なし」と同じ扱いに
    // してしまうと、配信が黙って止まったまま誰も気づけないので、はっきり失敗として返す
    if (!Array.isArray(rawArticles)) {
        console.error('failed to fetch articles', rawArticles);
        res.status(502).json({ sent: false, error: 'failed to fetch articles', detail: rawArticles });
        return;
    }
    if (rawArticles.length === 0) {
        res.status(200).json({ sent: false, reason: 'no new articles since last send' });
        return;
    }

    // 記事本文をそのまま載せる(抜粋ではなく全文)
    const articles = sortDigestArticles(rawArticles.map(a => ({
        id: a.id,
        title: a.title,
        date: a.date,
        category: a.category || '',
        content: a.content || '',
    })));

    const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/subscribers?select=email,unsubscribe_token`, { headers: sbHeaders });
    const subscribers = await subsRes.json();

    if (!Array.isArray(subscribers) || subscribers.length === 0) {
        res.status(200).json({ sent: false, reason: 'no subscribers' });
        return;
    }

    const messages = subscribers.map(sub => ({
        from: buildDigestFrom({ siteTitle, fromEmail }),
        to: sub.email,
        subject: buildDigestSubject({ siteTitle, articles }),
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
