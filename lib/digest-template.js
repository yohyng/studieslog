// 週次ダイジェスト・管理者向けテストメール・管理画面のプレビューで共通に使うメール本文テンプレート。
//
// 閲覧ページ(index.html)の見た目に揃えることを狙っている。メールではCSS変数もclassベースの
// スタイルも当てにできないため、閲覧ページがCSSでやっていることを、ここで計算してインラインの
// styleとして焼き込む。
//
// テーブルレイアウトなのは、古いOutlookなどflexbox非対応のメールクライアントでも崩れないようにするため。

const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500&family=Shippori+Mincho+B1:wght@400;500&family=Noto+Serif+JP:wght@400;500;700&family=Zen+Old+Mincho:wght@400;700&family=Kaisei+Tokumin:wght@400;500;700&family=Kaisei+Decol:wght@400;700&family=BIZ+UDPMincho:wght@400;700&family=Noto+Sans+JP:wght@400;500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=BIZ+UDPGothic:wght@400;700&family=Sawarabi+Gothic&family=M+PLUS+1p:wght@400;500;700&family=Kosugi+Maru&family=Zen+Maru+Gothic:wght@400;500;700&family=M+PLUS+Rounded+1c:wght@400;500;700&family=Klee+One:wght@400;600&family=New+Tegomin&family=Yuji+Syuku&family=Fraunces:wght@400;600;700&family=Bodoni+Moda:wght@400;500;700&family=Abril+Fatface&family=Grenze+Gotisch:wght@400;600;700&family=Italiana&family=Cormorant:wght@300;400;500;600;700&display=swap";

// 閲覧ページの既定値(index.htmlの:rootと揃えている)
const DEFAULTS = {
    bgColor: '#6b7278',
    textColor: '#ffffff',
    fontSize: 16,
    lineHeight: 1.9,
    letterSpacing: 0.07,
    textAlign: 'left',
    contentWidth: 672,
    bodyTextOpacity: 0.75,
    footnoteColor: '#7dd3fc',
};

// ── 色の計算 ───────────────────────────────────────────────────────────────
// メールではcolor-mix()もopacityも当てにできないので、送信時に実際の色を計算しておく

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

/** 背景の上に不透明度opacityで文字を置いたときの見た目の色 */
function fade(textColor, bgColor, opacity) {
    return mixHex(textColor, bgColor, 1 - opacity);
}

// ── 本文の変換 ─────────────────────────────────────────────────────────────

/**
 * 記事本文のHTMLを、メールでも同じ見た目になる形に変換する。
 * 閲覧ページの .content-body 配下のCSSに相当するものをインラインstyleとして入れる。
 * サーバー(Node)でも動かすのでDOMは使わず、文字列処理で行う。
 */
function articleBodyToEmail(html, s) {
    let out = String(html || '');
    const notes = [];

    // 脚注: 本文中は[n]の印だけにして、注釈本文は末尾にまとめる(閲覧ページと同じ扱い)。
    // 旧形式(印の直後に<span class="footnote-note">で注釈が続く)も拾えるよう、続きも一緒に食う
    out = out.replace(
        /<sup[^>]*class="[^"]*footnote-ref[^"]*"[^>]*>[\s\S]*?<\/sup>(\s*<span[^>]*class="[^"]*footnote-note[^"]*"[^>]*>([\s\S]*?)<\/span>)?/gi,
        (whole, _legacyWrap, legacyText) => {
            const attr = /data-note\s*=\s*"([^"]*)"/i.exec(whole);
            const note = attr ? decodeEntities(attr[1]) : stripTags(legacyText || '');
            notes.push(note);
            // line-height:0を付けるとsupのデフォルトのvertical-align:superと重なって
            // 行boxの高さがゼロになり、前後の行に埋もれて見えなくなることがある
            // (閲覧ページの.footnote-refにはこの指定が無く、実際にそちらでは問題が出ていない)
            return `<sup style="color:${s.footnoteColor}; font-size:0.75em;">[${notes.length}]</sup>`;
        }
    );

    // メールでは動かず、クライアントに除去されることもあるので落とす
    out = out.replace(/\sonclick\s*=\s*"[^"]*"/gi, '');
    // メールクライアントはcolor-mix()を解釈できないため、計算済みの色に置き換える
    out = out.replace(/color-mix\(in srgb,\s*currentColor\s+20%,\s*transparent\)/gi, s.border);

    // 画像は横幅に収める(閲覧ページの .content-body img 相当)
    out = out.replace(/<img([^>]*)>/gi, (m, attrs) => {
        const extra = 'max-width:100%; height:auto; display:block; margin:1.5em auto; border:0;';
        return /style\s*=\s*"/i.test(attrs)
            ? `<img${attrs.replace(/style\s*=\s*"([^"]*)"/i, (mm, v) => `style="${v}; ${extra}"`)}>`
            : `<img${attrs} style="${extra}">`;
    });

    // ブロック要素に、閲覧ページ相当の見た目をインラインで与える
    out = out.replace(/<blockquote(\s[^>]*)?>/gi,
        `<blockquote style="border-left:1px solid ${s.quoteBorder}; padding-left:1.5em; margin:2em 0; font-style:italic; color:${s.quoteText};">`);
    out = out.replace(/<h2(\s[^>]*)?>/gi,
        `<h2 style="font-size:1.2em; font-weight:normal; margin:2em 0 1em; color:${s.headingText};">`);
    out = out.replace(/<(p|div)(\s[^>]*)?>/gi, (m, tag, attrs) =>
        `<${tag}${attrs || ''} style="margin:0 0 1em;">`);
    out = out.replace(/<(ul|ol)(\s[^>]*)?>/gi, (m, tag, attrs) =>
        `<${tag}${attrs || ''} style="margin:1em 0; padding-left:1.5em;">`);
    // 本文中のリンク(リンクカードは自前のstyleを持っているので触らない)
    out = out.replace(/<a(?![^>]*book-link-card)([^>]*)>/gi, (m, attrs) =>
        /style\s*=\s*"/i.test(attrs) ? `<a${attrs}>` : `<a${attrs} style="color:${s.linkColor};">`);

    const notesHtml = notes.length === 0 ? '' : `
        <div style="margin-top:2.5em; padding-top:1em; border-top:1px solid ${s.border};">
            ${notes.map((note, i) => `
                <div style="font-size:0.8em; line-height:1.8; color:${s.mutedText}; margin-bottom:0.4em;">
                    <span style="color:${s.footnoteColor};">[${i + 1}]</span> ${escapeHtml(note)}
                </div>
            `).join('')}
        </div>`;

    return out + notesHtml;
}

// ── メール全体 ─────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {Array}  o.articles   [{ id, title, date, category, content }] contentは記事本文のHTML
 * @param {object} o.typography 閲覧ページの表示設定(site_settings)。空ならDEFAULTSを使う
 */
function buildDigestHtml({ siteTitle, siteUrl, articles, unsubscribeUrl, bgColor, textColor, fontFamily, typography, bgImage }) {
    const t = typography || {};
    // digest_bg_color / digest_text_color は「設定されていればメールだけ上書きする」扱い。
    // 空ならサイト本体の色に従うので、閲覧ページと同じ見た目になる
    const bg = bgColor || t.bg_color || DEFAULTS.bgColor;
    const text = textColor || t.text_color || DEFAULTS.textColor;

    const fontStack = fontFamily || t.font
        || "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif";
    const titleFont = t.title_font || fontStack;
    const rootSize = Number(t.font_size) || DEFAULTS.fontSize;
    const lineHeight = t.line_height || DEFAULTS.lineHeight;
    const letterSpacing = (t.letter_spacing != null ? t.letter_spacing : DEFAULTS.letterSpacing) + 'em';
    const textAlign = t.text_align || DEFAULTS.textAlign;
    const contentWidth = Number(t.content_width) || DEFAULTS.contentWidth;
    const bodyOpacity = t.body_text_opacity != null ? Number(t.body_text_opacity) : DEFAULTS.bodyTextOpacity;
    const titleOpacity = t.title_text_opacity != null ? Number(t.title_text_opacity) : 1;

    // 閲覧ページは本文を text-sm(0.875rem)、タイトルを text-lg(1.125rem)、日付を text-xs(0.75rem)で
    // 出しており、remはルートのフォントサイズ(=font_size)基準。同じ実寸になるようpxに直す
    const bodySize = Math.round(rootSize * 0.875);
    const titleSize = Math.round(rootSize * 1.125);
    const smallSize = Math.round(rootSize * 0.75);
    const framePad = Math.round(rootSize * 1.5);   // 記事枠の padding:1.5rem 相当

    const s = {
        border: mixHex(text, bg, 0.7),
        mutedText: fade(text, bg, 0.45),
        bodyText: fade(text, bg, bodyOpacity),
        headingText: fade(text, bg, Math.min(1, bodyOpacity + 0.15)),
        quoteText: fade(text, bg, bodyOpacity * 0.9),
        quoteBorder: fade(text, bg, 0.5),
        linkColor: fade(text, bg, Math.min(1, bodyOpacity + 0.2)),
        footnoteColor: t.footnote_color || DEFAULTS.footnoteColor,
    };

    // メールでは data: URI が除去されるため、背景はStorage上の画像をURLで参照する。
    // 外部画像を読み込まない設定のクライアントでは表示されないので、背景色が実質のフォールバックになる
    const bgLayer = bgImage ? ` background-image:url('${bgImage}'); background-repeat:repeat;` : '';
    // OutlookデスクトップはWordのエンジンでbackground-imageを解釈しないためVMLで敷く
    const vmlBackground = bgImage ? `<!--[if gte mso 9]>
                <v:background xmlns:v="urn:schemas-microsoft-com:vml" fill="t">
                    <v:fill type="tile" src="${bgImage}" color="${bg}"/>
                </v:background>
                <![endif]-->` : '';

    // 記事ごとに独立した同一構造のtableを繰り返すと、Gmailなどが「並んだ項目」と
    // 自動判定してカルーセル風のUI(「•••」で記事を切り替える表示)を後付けすることがある。
    // 見た目(枠線・余白)は変えず、1つのtableの行としてつなげることでこれを避ける。
    // 最後の記事だけ下の余白を付けない(それ以外は次の記事との間隔として付ける)
    const articleRows = articles.map((a, i) => {
        const url = `${siteUrl}/article/${a.id}`;
        const heading = a.category
            ? `<span style="opacity:0.75;">${escapeHtml(a.category)}</span> | ${escapeHtml(a.title)}`
            : escapeHtml(a.title);
        const isLast = i === articles.length - 1;
        return `
                <tr><td style="${isLast ? '' : `padding-bottom:${framePad}px;`}">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                        <tr>
                            <td style="border:1px solid ${s.border}; padding:${framePad}px;">
                                <div style="font-size:${smallSize}px; color:${s.mutedText}; margin-bottom:0.6em;">${escapeHtml(a.date || '')}</div>
                                <div style="font-size:${titleSize}px; line-height:1.6; margin-bottom:1em; font-family:${titleFont}; color:${fade(text, bg, titleOpacity)};">${heading}</div>
                                <div style="font-size:${bodySize}px; line-height:${lineHeight}; letter-spacing:${letterSpacing}; color:${s.bodyText};">
                                    ${articleBodyToEmail(a.content, s)}
                                </div>
                                <div style="margin-top:1.5em;">
                                    <a href="${url}" style="font-size:${smallSize}px; color:${s.mutedText};">サイトで読む →</a>
                                </div>
                            </td>
                        </tr>
                    </table>
                </td></tr>
        `;
    }).join('');
    const articleBlocks = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;">${articleRows}</table>`;

    return `<!doctype html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- GmailやApple Mailの「ダークモード自動調整」を止める宣言。これが無いと、
         受信側の端末がダークモードのときにメールクライアントが背景色・文字色を
         自動で反転/調整してしまい、閲覧ページの配色に揃えて計算した色(特に
         脚注の水色のような、背景とのコントラストを前提にした色)が、調整後の
         背景と同化してほぼ見えなくなることがある。この宣言でライトモード
         固定にし、こちらで計算した色がそのまま出るようにする -->
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <link rel="stylesheet" href="${GOOGLE_FONTS_URL}">
    <style>@import url('${GOOGLE_FONTS_URL}');
        :root { color-scheme: light; supported-color-schemes: light; }
    </style>
</head>
<body style="margin:0; padding:0; background-color:${bg};${bgLayer}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${bg};${bgLayer}">
        <tr>
            <td align="center" style="padding: 40px 16px;${bgLayer}">
                ${vmlBackground}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                       style="max-width:${contentWidth}px; font-family:${fontStack}; text-align:${textAlign};">
                    <tr>
                        <td align="center" style="padding-bottom: 40px;">
                            <div style="font-size:${smallSize}px; letter-spacing:0.15em; color:${s.mutedText}; text-transform:uppercase; margin-bottom:10px;">Weekly Update</div>
                            <div style="font-size:${titleSize}px; color:${text}; font-family:${titleFont}; letter-spacing:0.1em;">${escapeHtml(siteTitle)} Newsletter</div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding-bottom: 24px;">
                            <p style="font-size:${smallSize}px; color:${s.mutedText}; line-height:1.8; margin:0;">今週、${articles.length}件の記事を公開しました。</p>
                        </td>
                    </tr>
                    <tr>
                        <td>${articleBlocks}</td>
                    </tr>
                    <tr>
                        <td align="center" style="padding-top: 32px; border-top: 1px solid ${s.border};">
                            <p style="font-size:${smallSize}px; color:${s.mutedText}; line-height:1.8; margin: 24px 0 0;">
                                このメールは ${escapeHtml(siteTitle)} の更新通知として送信されています。<br>
                                <a href="${unsubscribeUrl}" style="color:${s.mutedText};">配信停止はこちら</a> ／ <a href="${siteUrl}/contact" style="color:${s.mutedText};">お問い合わせ</a>
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

// ── 補助 ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripTags(str) {
    return String(str || '').replace(/<[^>]+>/g, '').trim();
}

function decodeEntities(str) {
    return String(str)
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function extractFirstImage(html) {
    const m = String(html).match(/<img[^>]+src="([^"]+)"/);
    return m ? m[1] : null;
}

// 本文の頭出し用の抜粋。全文を載せるようになったのでメール本体では使わないが、
// 一覧やプレビューの見出しなどで使えるよう残してある
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

const api = { buildDigestHtml, articleBodyToEmail, escapeHtml, extractFirstImage, extractExcerpt };

// サーバー(Node)からも管理画面(ブラウザ)からも同じ実装を使う。
// 以前は管理画面のプレビューが別実装で、見た目を手で揃える必要があり、ずれる原因になっていた
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.DigestTemplate = api;
