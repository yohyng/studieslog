// 記事・サイトのOGP画像をリクエストごとに動的生成する。
// 本文中の画像だけをそのままシェアカードにすると記事のタイトルが分からないので、
// タイトル・サイト名・台形装飾を必ず重ねる。本文に画像があればそれを背景に敷き、
// 無ければサイトの背景色のみのシンプルな見た目になる。
// middleware.js(記事ページのクローラー向けOGP差し替え)から常にこちらを参照する。
//
// クエリ: ?id=記事ID(タイトルをDBから取得) / ?title=文字列(直接指定、idより優先) / ?bg=本文中の画像URL(背景に敷く、任意)
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://eiyzlawmcyybchxzyozr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpeXpsYXdtY3l5YmNoeHp5b3pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMDI2MjQsImV4cCI6MjA5NTU3ODYyNH0.SZVwqWKkk31npqdiiG5m3HdkF4JnQ7SgEzThaFfZ4q4';

// タイトル横の台形装飾(index.htmlのTITLE_SHAPE_VARIANTSの1つ目)と同じ基準形。
// ここでは揺れ・ランダム化はせず固定形のまま使う。
// satori(@vercel/ogが使うSVGレンダラ)はpolygon要素を持たないため、path(M...L...Z)で描く
const SHAPE_PATH = 'M130,20 L180,38 L123,185 L30,94 Z';

function truncate(text, max) {
    const t = (text || '').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
}

// Google FontsからNoto Sans JPを必要な文字だけ取得する(textパラメータでサブセット化され軽量になる)
async function loadGoogleFont(weight, text) {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(cssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/);
    if (!match) throw new Error('font resource not found');
    const fontRes = await fetch(match[1]);
    return fontRes.arrayBuffer();
}

// @vercel/ogはJSXではなく素のReact風要素ツリー(type/props.children)を渡せば描画できる
function el(type, props, ...children) {
    return { type, props: { ...props, children: children.flat().filter(Boolean) } };
}

export default async function handler(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const bgImage = url.searchParams.get('bg') || '';
    let title = url.searchParams.get('title') || '';
    let siteName = '';
    let bgColor = '#6b7278';
    let textColor = '#ffffff';

    try {
        const settingsRes = await fetch(`${SUPABASE_URL}/rest/v1/site_settings?id=eq.1&select=site_title,bg_color,text_color`, {
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        });
        const settingsRows = await settingsRes.json();
        const settings = (settingsRows && settingsRows[0]) || {};
        siteName = settings.site_title || '';
        bgColor = settings.bg_color || bgColor;
        textColor = settings.text_color || textColor;

        if (id && !title) {
            const articleRes = await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${encodeURIComponent(id)}&select=title`, {
                headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
            });
            const articleRows = await articleRes.json();
            title = (articleRows && articleRows[0] && articleRows[0].title) || '';
        }
    } catch (e) {
        // 設定・記事の取得に失敗しても、既定色でとりあえず画像は返す
    }

    title = truncate(title, 42) || siteName || 'fragments';
    siteName = truncate(siteName, 30);

    // 背景画像がある場合は敷いた上から、下にいくほど暗くなるグラデーションを重ねて
    // 文字が常に読めるようにする(装飾・タイトルは白固定なので、textColorが暗色設定でも
    // ここは白のまま。背景が無いときはサイトの背景色がそのまま出るのでオーバーレイ自体を省く)
    const bgLayers = bgImage ? [
        el('img', {
            src: bgImage,
            style: { position: 'absolute', top: 0, left: 0, width: '1200px', height: '630px', objectFit: 'cover' },
        }),
        el('div', {
            style: {
                position: 'absolute', top: 0, left: 0, width: '1200px', height: '630px',
                backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0.25) 55%, rgba(0,0,0,0.05) 100%)',
            },
        }),
    ] : [];
    const overlayTextColor = bgImage ? '#ffffff' : textColor;

    const tree = el('div', {
        style: {
            width: '1200px',
            height: '630px',
            display: 'flex',
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: bgColor,
        },
    },
        ...bgLayers,
        el('svg', {
            width: 480,
            height: 464,
            viewBox: '0 0 200 193',
            style: { position: 'absolute', right: '-40px', top: '-60px' },
        },
            el('path', {
                d: SHAPE_PATH,
                fill: 'none',
                stroke: overlayTextColor,
                strokeWidth: 2,
                opacity: 0.35,
            })
        ),
        el('div', {
            style: {
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                height: '100%',
                width: '100%',
                padding: '70px',
            },
        },
            siteName && el('div', {
                style: { fontFamily: 'Noto Sans JP', fontSize: 28, color: overlayTextColor, opacity: 0.7, marginBottom: '18px' },
            }, siteName),
            el('div', {
                style: {
                    display: 'flex',
                    fontFamily: 'Noto Sans JP',
                    fontWeight: 700,
                    fontSize: 58,
                    lineHeight: 1.4,
                    color: overlayTextColor,
                    maxWidth: '760px',
                },
            }, title)
        )
    );

    try {
        const fontText = `${title}${siteName}0123456789…`;
        const [titleFont, siteFont] = await Promise.all([
            loadGoogleFont(700, fontText),
            loadGoogleFont(400, fontText),
        ]);
        return new ImageResponse(tree, {
            width: 1200,
            height: 630,
            fonts: [
                { name: 'Noto Sans JP', data: titleFont, weight: 700, style: 'normal' },
                { name: 'Noto Sans JP', data: siteFont, weight: 400, style: 'normal' },
            ],
            headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
        });
    } catch (e) {
        // フォント取得や描画に失敗しても、壊れた画像URLを返すよりは装飾だけのシンプルな画像を返す
        const fallbackTree = el('div', {
            style: { width: '1200px', height: '630px', display: 'flex', backgroundColor: bgColor },
        });
        return new ImageResponse(fallbackTree, { width: 1200, height: 630 });
    }
}
