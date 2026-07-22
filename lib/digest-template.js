// 16進カラーコードを比率で混ぜる(メールはCSSのcolor-mix()が使えないクライアントもあるため、送信時に計算しておく)
function mixHex(hexA, hexB, ratio) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    const r = Math.round(a.r + (b.r - a.r) * ratio);
    const g = Math.round(a.g + (b.g - a.g) * ratio);
    const bl = Math.round(a.b + (b.b - a.b) * ratio);
    return `#${[r, g, bl].map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex) {
    const clean = String(hex).replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const num = parseInt(full, 16) || 0;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

// 週次ダイジェスト・管理者向けテストメール共通のメール本文テンプレート。
// admin.htmlのプレビュー機能もこれと同じ見た目になるよう手動で揃えている。
// テーブルレイアウトなのは、古いOutlookなどflexbox非対応のメールクライアントでも崩れないようにするため
const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500&family=Shippori+Mincho+B1:wght@400;500&family=Noto+Serif+JP:wght@400;500;700&family=Zen+Old+Mincho:wght@400;700&family=Kaisei+Tokumin:wght@400;500;700&family=Kaisei+Decol:wght@400;700&family=BIZ+UDPMincho:wght@400;700&family=Noto+Sans+JP:wght@400;500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=BIZ+UDPGothic:wght@400;700&family=Sawarabi+Gothic&family=M+PLUS+1p:wght@400;500;700&family=Kosugi+Maru&family=Zen+Maru+Gothic:wght@400;500;700&family=M+PLUS+Rounded+1c:wght@400;500;700&family=Klee+One:wght@400;600&family=New+Tegomin&family=Yuji+Syuku&family=Fraunces:wght@400;600;700&family=Bodoni+Moda:wght@400;500;700&family=Abril+Fatface&family=Grenze+Gotisch:wght@400;600;700&family=Italiana&family=Cormorant:wght@300;400;500;600;700&display=swap";

function buildDigestHtml({ siteTitle, siteUrl, articles, unsubscribeUrl, bgColor, textColor, fontFamily }) {
    const bg = bgColor || '#f4f1ea';
    const text = textColor || '#2b2b28';
    const muted = mixHex(text, bg, 0.55);
    const border = mixHex(text, bg, 0.88);
    // サイト本体と同じGoogle Fontsを読み込む(対応していないメールクライアントでは末尾の総称フォントにフォールバックする)
    const fontStack = fontFamily || "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif";
    const excerptColor = mixHex(text, bg, 0.3);
    const rows = articles.map(a => {
        const url = `${siteUrl}/article/${a.id}`;
        const imageCell = a.image
            ? `<td width="64" style="width:64px; padding-right:14px; vertical-align:top;"><img src="${escapeHtml(a.image)}" width="64" height="64" style="width:64px; height:64px; object-fit:cover; border-radius:6px; display:block;" alt=""></td>`
            : '';
        const excerptHtml = a.excerpt
            ? `<div style="font-size:13px; color:${excerptColor}; line-height:1.6; margin-top:6px; font-family:${fontStack};">${escapeHtml(a.excerpt)}</div>`
            : '';
        return `
            <a href="${url}" style="text-decoration:none; display:block; padding:16px 0; border-bottom:1px solid ${border};">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                    <tr>
                        ${imageCell}
                        <td style="vertical-align:middle;">
                            <div style="font-size:11px; color:${muted}; margin-bottom:4px; font-family:${fontStack};">${escapeHtml(a.date)}</div>
                            <div style="font-size:15px; color:${text}; font-weight:600; line-height:1.5; font-family:${fontStack};">${escapeHtml(a.title)}</div>
                            ${excerptHtml}
                        </td>
                    </tr>
                </table>
            </a>
        `;
    }).join('');

    return `<!doctype html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${GOOGLE_FONTS_URL}">
    <style>@import url('${GOOGLE_FONTS_URL}');</style>
</head>
<body style="margin:0; padding:0; background-color:${bg};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${bg};">
        <tr>
            <td align="center" style="padding: 40px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; font-family:${fontStack};">
                    <tr>
                        <td align="center" style="padding-bottom: 32px;">
                            <div style="font-size:11px; letter-spacing:0.15em; color:${muted}; text-transform:uppercase; margin-bottom:10px;">Weekly Update</div>
                            <div style="font-size:22px; color:${text}; font-weight:600;">${escapeHtml(siteTitle)}</div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 4px;">
                            <p style="font-size:14px; color:${muted}; line-height:1.8; margin:0 0 8px;">今週、${articles.length}件の記事を公開しました。</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 4px;">
                            ${rows}
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding: 36px 0 8px;">
                            <a href="${siteUrl}" style="display:inline-block; padding:12px 28px; background-color:${text}; color:${bg}; text-decoration:none; border-radius:4px; font-size:13px;">サイトで読む</a>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding-top: 40px; border-top: 1px solid ${border};">
                            <p style="font-size:11px; color:${muted}; line-height:1.8; margin: 24px 0 0;">
                                このメールは ${escapeHtml(siteTitle)} の更新通知として送信されています。<br>
                                <a href="${unsubscribeUrl}" style="color:${muted};">配信停止はこちら</a> ／ <a href="${siteUrl}/about" style="color:${muted};">お問い合わせ</a>
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

// 本文の頭出し用の抜粋を作る。リンクカード(Amazonなどの紹介リンク)・画像・注釈は
// メールに乗せると邪魔になるので取り除き、地の文だけを残す
function extractExcerpt(html, maxLen = 90) {
    let s = String(html || '');
    s = s.replace(/<a[^>]*class="[^"]*book-link-card[^"]*"[^>]*>[\s\S]*?<\/a>/gi, ' ');
    s = s.replace(/<span[^>]*class="[^"]*footnote-note[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ');
    s = s.replace(/<sup[^>]*class="[^"]*footnote-ref[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, ' ');
    s = s.replace(/<img[^>]*>/gi, ' ');
    s = s.replace(/<br\s*\/?>/gi, ' ');
    s = s.replace(/<\/(p|div|li|h[1-6])>/gi, ' ');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > maxLen) s = s.slice(0, maxLen).trim() + '…';
    return s;
}

module.exports = { buildDigestHtml, escapeHtml, extractFirstImage, extractExcerpt };
