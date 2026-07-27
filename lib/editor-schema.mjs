// Tiptap移行の候補スキーマ。既存エディタ(contenteditable + execCommand)が生成してきたHTMLを
// 取りこぼさずに読み書きできることを目標にしている。
//
// 重要: Tiptapはスキーマに無い要素を読み込み時に黙って捨てる。既存記事を開いて保存すると
// その瞬間に中身が消えるため、ここのカバー範囲がそのままデータ安全性に直結する。
// カバーできているかは scripts/schema-fixture-test.mjs と audit.html で検証する。
//
// このファイルはNode(テスト)とブラウザ(監査ページ・本実装)の両方から同じものをimportする。
// ブラウザ側はimport mapで @tiptap/* をesm.shに向けること。

import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';

// ── 脚注 ───────────────────────────────────────────────────────────────────
// 既存形式: <sup class="footnote-ref" data-note="注釈本文">[1]</sup>
// 表示テキスト([1])も label として保持して再出力する。採番し直しは本実装側の責務とし、
// ここでは往復で1バイトも変えないことを優先する(監査で差分ノイズを出さないため)。
export const FootnoteRef = Node.create({
    name: 'footnoteRef',
    group: 'inline',
    inline: true,
    atom: true,

    addAttributes() {
        return {
            note: {
                default: '',
                parseHTML: (el) => el.getAttribute('data-note') || '',
                renderHTML: (attrs) => ({ 'data-note': attrs.note || '' }),
            },
            // 表示上の[N]。属性としては出さず、テキストの子として描画する
            label: {
                default: '',
                parseHTML: (el) => el.textContent || '',
                renderHTML: () => ({}),
            },
        };
    },

    // 他の拡張(将来Superscriptを足した場合など)に横取りされないよう優先度を上げておく
    parseHTML() {
        return [{ tag: 'sup.footnote-ref', priority: 100 }];
    },

    renderHTML({ node, HTMLAttributes }) {
        return [
            'sup',
            mergeAttributes(HTMLAttributes, { class: 'footnote-ref' }),
            node.attrs.label || '',
        ];
    },
});

// ── 書影・リンクカード ──────────────────────────────────────────────────────
// 既存形式は admin.html の insertBookLinkCard() が生成するインラインstyle付きの<a>。
// 生HTMLをそのまま持つのではなく href/label/domain/image の4つに意味を抽出して保持し、
// 出力時に同じマークアップを組み立て直す。公開側(index.html)は保存済みHTMLを
// そのまま描画するので、インラインstyleは元と同じものを出す必要がある。
const CARD_STYLE = 'display:flex; align-items:stretch; gap:0.5rem; border:1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius:0; overflow:hidden; text-decoration:none; color:inherit; margin:1em 0;';
const CARD_BODY_STYLE = 'flex:1; min-width:0; padding:0.5rem 0.7rem; display:flex; flex-direction:column; justify-content:center; gap:0.1rem;';
const CARD_LABEL_STYLE = 'font-size:0.7rem; font-weight:500; line-height:1.4;';
const CARD_DOMAIN_STYLE = 'font-size:0.6rem; opacity:0.5;';
const CARD_IMAGE_STYLE = 'width:3rem; flex-shrink:0; object-fit:cover; aspect-ratio:1;';

export const BookLinkCard = Node.create({
    name: 'bookLinkCard',
    // 画像と同じ理由でinline。ブロックにすると段落の中にあるカードを外へ持ち上げる際に
    // ProseMirrorが段落を分割し、空段落が増えて本文の間隔が変わる。
    // 既存データではexecCommand('insertHTML')でキャレット位置＝段落の中に挿入されている。
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,

    // 構造: <a><span(本文枠)><span(タイトル)/><span(ドメイン)/></span><img/></a>
    // Tiptapは属性ごとのparseHTMLが未指定だと「同名のHTML属性を読む」既定動作に落ちるため、
    // ルール側のgetAttrsではなくここで個別に抽出する(getAttrsは上書きされて効かない)。
    addAttributes() {
        return {
            href: {
                default: '',
                parseHTML: (el) => el.getAttribute('href') || '',
            },
            label: {
                default: '',
                parseHTML: (el) => {
                    const inner = el.querySelectorAll('span span');
                    return inner[0] ? inner[0].textContent || '' : '';
                },
            },
            domain: {
                default: '',
                parseHTML: (el) => {
                    const inner = el.querySelectorAll('span span');
                    return inner[1] ? inner[1].textContent || '' : '';
                },
            },
            image: {
                default: '',
                parseHTML: (el) => {
                    const img = el.querySelector('img');
                    return img ? img.getAttribute('src') || '' : '';
                },
            },
        };
    },

    // priorityを上げないとStarterKitのLinkマークが先に<a>を食ってしまい、
    // カードがただのリンク付きテキストに潰れる(=カードの見た目とdomain/imageが消える)
    parseHTML() {
        return [{ tag: 'a.book-link-card', priority: 100 }];
    },

    renderHTML({ node }) {
        const { href, label, domain, image } = node.attrs;
        const body = ['span', { style: CARD_BODY_STYLE }, ['span', { style: CARD_LABEL_STYLE }, label || '']];
        if (domain) body.push(['span', { style: CARD_DOMAIN_STYLE }, domain]);

        const card = [
            'a',
            {
                href: href || '',
                target: '_blank',
                rel: 'noopener noreferrer',
                onclick: 'event.stopPropagation()',
                class: 'book-link-card',
                style: CARD_STYLE,
            },
            body,
        ];
        if (image) card.push(['img', { src: image, style: CARD_IMAGE_STYLE }]);
        return card;
    },
});

// ── 画像 ───────────────────────────────────────────────────────────────────
// resizeSelectedImage() が style="width:N%; height:auto" を直接書くので、styleを素通しする。
// class も拾う(画像選択中に保存すると img-selected が混入する既知の問題を検出するため)。
export const ImageWithStyle = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            style: {
                default: null,
                parseHTML: (el) => el.getAttribute('style'),
                renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {}),
            },
            class: {
                default: null,
                parseHTML: (el) => el.getAttribute('class'),
                renderHTML: (attrs) => (attrs.class ? { class: attrs.class } : {}),
            },
        };
    },
});

// ── 拡張一式 ────────────────────────────────────────────────────────────────
// StarterKit v3 には Link と Underline が含まれるので個別追加は不要。
// 既存記事に h1/h3 などが混ざっている可能性があるので heading は 1-6 のまま広く取る。
export function buildExtensions() {
    return [
        StarterKit.configure({
            heading: { levels: [1, 2, 3, 4, 5, 6] },
            link: {
                openOnClick: false,
                autolink: false,
                HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
            },
        }),
        // inline:false にすると、段落の中にある画像をブロックとして外へ持ち上げるため
        // ProseMirrorが段落を分割し、画像の前後に空段落が生まれて本文の間隔が変わってしまう。
        // 既存エディタは execCommand('insertImage') でキャレット位置に挿入する＝画像は
        // 段落の中にあるので、inline:true が既存データと一致する。
        ImageWithStyle.configure({ inline: true, allowBase64: true }),
        FootnoteRef,
        BookLinkCard,
    ];
}
