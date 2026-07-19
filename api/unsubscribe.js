// メール本文の「配信停止はこちら」リンクの行き先。トークンに一致する購読者を削除する。

const SUPABASE_URL = 'https://eiyzlawmcyybchxzyozr.supabase.co';

module.exports = async function handler(req, res) {
    const token = req.query.token;
    res.setHeader('content-type', 'text/html; charset=utf-8');

    if (!token || typeof token !== 'string') {
        res.status(400).send(wrapHtml('リクエストが正しくありません。'));
        return;
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
        res.status(500).send(wrapHtml('サーバーの設定が完了していません。'));
        return;
    }

    try {
        await fetch(`${SUPABASE_URL}/rest/v1/subscribers?unsubscribe_token=eq.${encodeURIComponent(token)}`, {
            method: 'DELETE',
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        });
        res.status(200).send(wrapHtml('配信を停止しました。ご利用ありがとうございました。'));
    } catch (e) {
        console.error(e);
        res.status(500).send(wrapHtml('処理に失敗しました。時間をおいて再度お試しください。'));
    }
};

function wrapHtml(message) {
    return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family:sans-serif; text-align:center; padding:4rem 1rem;"><p>${message}</p></body></html>`;
}
