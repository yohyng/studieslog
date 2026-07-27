// Tiptap候補スキーマ(lib/editor-schema.mjs)が、既存エディタの生成するHTMLを
// 落とさずに往復できるかを合成フィクスチャで検証する。
//
//   node scripts/schema-fixture-test.mjs
//
// 実データでの検証は audit.html(ブラウザで実行)が担当する。こちらは
// 「エディタのコードが生成しうる形」を網羅的に固定して、退行を検出するためのもの。

import { JSDOM } from 'jsdom';

// @tiptap/html はDOMを使うのでglobalに用意してからimportする
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
// navigator は Node 22 では getter のみなので上書きしない

const { generateJSON, generateHTML } = await import('@tiptap/html');
const { buildExtensions } = await import('../lib/editor-schema.mjs');

const extensions = buildExtensions();

// ── フィクスチャ ────────────────────────────────────────────────────────────
// admin.html の各挿入経路が実際に生成する形＋execCommand時代に混入しうる形

const CARD = '<a href="https://example.com/x" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="book-link-card" style="display:flex; align-items:stretch; gap:0.5rem; border:1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius:0; overflow:hidden; text-decoration:none; color:inherit; margin:1em 0;">'
    + '<span style="flex:1; min-width:0; padding:0.5rem 0.7rem; display:flex; flex-direction:column; justify-content:center; gap:0.1rem;">'
    + '<span style="font-size:0.7rem; font-weight:500; line-height:1.4;">本のタイトル</span>'
    + '<span style="font-size:0.6rem; opacity:0.5;">example.com</span>'
    + '</span>'
    + '<img src="https://img.example.com/cover.jpg" style="width:3rem; flex-shrink:0; object-fit:cover; aspect-ratio:1;">'
    + '</a>';

const fixtures = [
    ['段落', '<p>ふつうの本文です。</p>'],
    ['見出しH2', '<h2>見出し</h2><p>本文</p>'],
    ['見出しH1/H3(旧記事)', '<h1>大見出し</h1><h3>小見出し</h3>'],
    ['引用(Chrome形)', '<blockquote>引用文</blockquote>'],
    ['引用(p入れ子形)', '<blockquote><p>引用文</p></blockquote>'],
    ['引用(複数行)', '<blockquote><p>一行目</p><p>二行目</p></blockquote>'],
    ['箇条書き', '<ul><li>あ</li><li>い</li></ul>'],
    ['番号リスト', '<ol><li>あ</li><li>い</li></ol>'],
    ['太字strong', '<p><strong>太字</strong>と普通</p>'],
    ['太字b(execCommand旧)', '<p><b>太字</b>と普通</p>'],
    ['斜体i', '<p><i>斜体</i></p>'],
    ['下線u', '<p><u>下線</u></p>'],
    ['取消strike(旧)', '<p><strike>取消</strike></p>'],
    ['取消s', '<p><s>取消</s></p>'],
    ['リンク', '<p><a href="https://example.com">リンク</a></p>'],
    ['脚注', '<p>本文<sup class="footnote-ref" data-note="これは注釈です">[1]</sup>のあと</p>'],
    ['脚注(複数)', '<p>A<sup class="footnote-ref" data-note="注1">[1]</sup>B<sup class="footnote-ref" data-note="注2">[2]</sup></p>'],
    ['脚注(旧inline形式)', '<p>本文<sup class="footnote-ref">[1]</sup><span class="footnote-note">古い注釈本文</span></p>'],
    ['リンクカード', CARD + '<p></p>'],
    ['リンクカード(画像なし)', CARD.replace(/<img[^>]*>/, '')],
    ['画像', '<p>前</p><img src="https://example.com/a.png"><p>後</p>'],
    ['画像(幅指定)', '<img src="https://example.com/a.png" style="width:50%; height:auto;">'],
    ['画像(選択中クラス混入)', '<img src="https://example.com/a.png" class="img-selected">'],
    // 画像をブロック扱いにすると段落が分割され、前後に空段落が生まれて本文の間隔が変わる。
    // 実データの監査で13本文が該当したため、退行しないよう固定する
    ['画像(段落内)', '<p>本文A</p><p><img src="https://example.com/a.png"></p><p>本文B</p>'],
    ['画像(div内)', '<div>本文A</div><div><img src="https://example.com/a.png"></div><div>本文B</div>'],
    ['画像(テキストと同一行)', '<div>説明<img src="https://example.com/a.png">つづき</div>'],
    ['画像(空行に挟まれる)', '<div>A</div><div><br></div><div><img src="https://example.com/a.png"></div><div><br></div><div>B</div>'],
    ['改行br', '<p>一行目<br>二行目</p>'],
    ['div段落(execCommand旧)', '<div>divで書かれた段落</div>'],
    ['span style(execCommand旧)', '<p><span style="font-weight:bold">太字っぽいspan</span></p>'],
    ['font tag(execCommand旧)', '<p><font color="#ff0000">赤文字</font></p>'],
    ['水平線', '<p>上</p><hr><p>下</p>'],
    ['コード', '<p><code>inline code</code></p>'],
    ['入れ子リスト', '<ul><li>親<ul><li>子</li></ul></li></ul>'],
    ['混在', '<h2>見出し</h2><p><strong>太字</strong><sup class="footnote-ref" data-note="注">[1]</sup></p><blockquote>引用</blockquote><ul><li>項目</li></ul>' + CARD],
];

// ── 計測ユーティリティ ──────────────────────────────────────────────────────

function parse(html) {
    return new dom.window.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
}

/** タグ名と、意味のある属性の出現数を数える */
function census(html) {
    const body = parse(html);
    const tags = {};
    const attrs = {};
    body.querySelectorAll('*').forEach((el) => {
        const t = el.tagName.toLowerCase();
        tags[t] = (tags[t] || 0) + 1;
        for (const a of el.attributes) {
            const key = `${t}[${a.name}]`;
            attrs[key] = (attrs[key] || 0) + 1;
        }
    });
    return { tags, attrs };
}

function textOf(html) {
    return parse(html).textContent.replace(/\s+/g, ' ').trim();
}

/** 空行(brだけ、または中身のない段落)の数。消えても増えても本文の間隔が変わる */
function emptyBlocks(html) {
    return [...parse(html).children].filter((el) => {
        if (el.textContent.trim()) return false;
        // 画像・水平線などは(自身がそれである場合も含めて)「空行」ではない。
        // querySelectorは自身を見ないので matches も併せて確認する
        const SOLID = 'img, hr, iframe, video';
        return !el.matches(SOLID) && !el.querySelector(SOLID);
    }).length;
}

/** 入力にあって出力で減ったものを列挙 */
function lost(before, after) {
    const out = [];
    for (const k of Object.keys(before)) {
        const b = before[k];
        const a = after[k] || 0;
        if (a < b) out.push(`${k} ${b}→${a}`);
    }
    return out;
}

/** 脚注の data-note 値をすべて取り出す */
function noteValues(html) {
    return Array.from(parse(html).querySelectorAll('sup.footnote-ref'))
        .map((el) => el.getAttribute('data-note') || '');
}

/** リンクカードの意味的属性を取り出す */
function cardValues(html) {
    return Array.from(parse(html).querySelectorAll('a.book-link-card')).map((el) => {
        const inner = el.querySelectorAll('span span');
        const img = el.querySelector('img');
        return [
            el.getAttribute('href') || '',
            inner[0] ? inner[0].textContent : '',
            inner[1] ? inner[1].textContent : '',
            img ? img.getAttribute('src') : '',
        ].join(' | ');
    });
}

function imageSrcs(html) {
    return Array.from(parse(html).querySelectorAll('img')).map((el) => el.getAttribute('src') || '');
}

function linkHrefs(html) {
    return Array.from(parse(html).querySelectorAll('a:not(.book-link-card)')).map((el) => el.getAttribute('href') || '');
}

// ── 実行 ───────────────────────────────────────────────────────────────────

const RED = '\x1b[31m', YEL = '\x1b[33m', GRN = '\x1b[32m', DIM = '\x1b[2m', OFF = '\x1b[0m';

let critical = 0, warned = 0, passed = 0;
const attrLossTotals = {};

console.log('\nTiptap候補スキーマ 往復フィクスチャテスト');
console.log('='.repeat(72));

for (const [name, input] of fixtures) {
    let output;
    try {
        output = generateHTML(generateJSON(input, extensions), extensions);
    } catch (e) {
        console.log(`${RED}✗ EXCEPTION${OFF}  ${name}\n    ${e.message}`);
        critical++;
        continue;
    }

    const problems = [];   // データ損失(致命的)
    const notes = [];      // 正規化(許容)

    // 1. テキストが消えていないか — 最重要
    const tIn = textOf(input), tOut = textOf(output);
    if (tIn !== tOut) problems.push(`本文テキスト変化:\n      in : "${tIn}"\n      out: "${tOut}"`);

    // 2. 空行の数(テキスト比較では検出できないが、見た目が変わる)
    const eIn = emptyBlocks(input), eOut = emptyBlocks(output);
    if (eIn !== eOut) problems.push(`空行の数が変化: ${eIn} → ${eOut}`);

    // 3. 脚注のdata-noteが保たれているか
    const nIn = noteValues(input), nOut = noteValues(output);
    if (JSON.stringify(nIn) !== JSON.stringify(nOut)) {
        problems.push(`脚注data-note変化: ${JSON.stringify(nIn)} → ${JSON.stringify(nOut)}`);
    }

    // 3. リンクカードの意味的属性
    const cIn = cardValues(input), cOut = cardValues(output);
    if (JSON.stringify(cIn) !== JSON.stringify(cOut)) {
        problems.push(`リンクカード変化: ${JSON.stringify(cIn)} → ${JSON.stringify(cOut)}`);
    }

    // 4. 画像src / リンクhref
    const iIn = imageSrcs(input), iOut = imageSrcs(output);
    if (JSON.stringify(iIn) !== JSON.stringify(iOut)) problems.push(`画像src変化: ${JSON.stringify(iIn)} → ${JSON.stringify(iOut)}`);
    const lIn = linkHrefs(input), lOut = linkHrefs(output);
    if (JSON.stringify(lIn) !== JSON.stringify(lOut)) problems.push(`リンクhref変化: ${JSON.stringify(lIn)} → ${JSON.stringify(lOut)}`);

    // 5. タグ・属性の減少(構造の正規化は許容範囲なので警告扱い)
    const before = census(input), after = census(output);
    const lostTags = lost(before.tags, after.tags);
    const lostAttrs = lost(before.attrs, after.attrs);
    if (lostTags.length) notes.push(`タグ減: ${lostTags.join(', ')}`);
    if (lostAttrs.length) notes.push(`属性減: ${lostAttrs.join(', ')}`);
    for (const a of lostAttrs) {
        const key = a.split(' ')[0];
        attrLossTotals[key] = (attrLossTotals[key] || 0) + 1;
    }

    if (problems.length) {
        console.log(`${RED}✗ 損失${OFF}      ${name}`);
        problems.forEach((p) => console.log(`    ${RED}${p}${OFF}`));
        notes.forEach((n) => console.log(`    ${DIM}${n}${OFF}`));
        critical++;
    } else if (notes.length) {
        console.log(`${YEL}△ 正規化${OFF}    ${name}`);
        notes.forEach((n) => console.log(`    ${DIM}${n}${OFF}`));
        warned++;
    } else {
        console.log(`${GRN}✓ 完全一致${OFF}  ${name}`);
        passed++;
    }
}

console.log('='.repeat(72));
console.log(`完全一致 ${passed} / 正規化のみ ${warned} / ${critical > 0 ? RED : ''}損失 ${critical}${OFF}`);

if (Object.keys(attrLossTotals).length) {
    console.log(`\n${DIM}落ちた属性の集計(スキーマ拡張の検討材料):${OFF}`);
    Object.entries(attrLossTotals)
        .sort((a, b) => b[1] - a[1])
        .forEach(([k, v]) => console.log(`  ${k}  ${v}件`));
}

console.log();
process.exit(critical > 0 ? 1 : 0);
