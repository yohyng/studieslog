// admin.html から使うエディタのエントリポイント。
// esbuild で IIFE にバンドルされ、window.StudiesEditor として公開される(scripts/build.js)。
//
// 既存エディタ(contenteditable + execCommand)からの置き換え。保存形式はHTMLのまま変えないので、
// Supabaseのスキーマも公開側 index.html も RAGインデクサ(api/rag.js)も変更不要。

import { Editor } from '@tiptap/core';
import { buildExtensions } from './editor-schema.mjs';

/**
 * 旧形式の脚注を新形式へ寄せる。
 * 旧: <sup class="footnote-ref">[1]</sup><span class="footnote-note">注釈本文</span>
 * 新: <sup class="footnote-ref" data-note="注釈本文">[1]</sup>
 *
 * Tiptapのスキーマは span.footnote-note を知らないため、そのまま読み込むと注釈本文が
 * 本文中の地の文として残ってしまう。パースする前に必ず通すこと。
 * (既存の admin.html: migrateInlineFootnoteNotes と同じ役割)
 */
export function migrateLegacyFootnotes(html) {
    if (!html || html.indexOf('footnote-note') === -1) return html || '';
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    doc.body.querySelectorAll('.footnote-ref').forEach((ref) => {
        const next = ref.nextElementSibling;
        if (next && next.classList.contains('footnote-note')) {
            if (!ref.getAttribute('data-note')) {
                ref.setAttribute('data-note', next.textContent || '');
            }
            next.remove();
        }
    });
    return doc.body.innerHTML;
}

/**
 * エディタを1つ作る。
 * @param {HTMLElement} element   エディタを描画する要素
 * @param {string}      content   初期HTML
 * @param {Function}    onUpdate  内容が変わるたびに呼ばれる(自動保存・文字数用)
 * @param {string}      placeholder
 */
export function createEditor({ element, content = '', onUpdate = null, editable = true }) {
    const options = {
        element,
        extensions: buildExtensions(),
        content: migrateLegacyFootnotes(content) || '<p></p>',
        editable,
        // contenteditable時代のCSS(.content-editor)をそのまま効かせる
        editorProps: { attributes: { class: 'content-editor-body' } },
    };
    // onUpdate: undefined をそのまま渡すとTiptapがそれをリスナーとして登録してしまい、
    // トランザクションのたびに undefined.apply で例外になる。渡すときだけ入れる
    let editor;
    if (onUpdate) options.onUpdate = () => onUpdate(editor);
    editor = new Editor(options);
    return editor;
}

/**
 * 保存用のHTMLを取り出す。空のときは既存実装と同じく <p></p> を返す。
 *
 * 空段落は Tiptap の出力では <p></p> になるが、閲覧ページはTailwindのpreflightで
 * p { margin: 0 } のため、中身が無いと行の高さを持たず、書き手が入れた空行が消えてしまう。
 * 既存記事も空行を <br> 入りのブロックとして持っているので、それに揃えて <br> を補う。
 */
export function getHtml(editor) {
    if (!editor) return '<p></p>';
    if (editor.isEmpty) return '<p></p>';
    return editor.getHTML().replace(/<p><\/p>/g, '<p><br></p>');
}

/** 記事を読み込み直すときに使う。旧形式の脚注はここでも吸収する */
export function setHtml(editor, html) {
    if (!editor) return;
    editor.commands.setContent(migrateLegacyFootnotes(html) || '<p></p>', { emitUpdate: false });
}

/** 文字数(既存の updateCharCount と同じく、タグを除いた本文の長さ) */
export function getTextLength(editor) {
    return editor ? editor.getText().length : 0;
}

// ── タイプライターモード・貼り付け・プレーンテキスト化 ──────────────────────

/**
 * キャレットの画面上のY座標。
 * DOMのRangeから測る方法だと、空行で矩形が取れずゼロ幅文字を仮挿入する必要があり、
 * それがProseMirrorの管理下のDOMを書き換えてしまう。文書の位置から直接引く。
 */
export function caretViewportTop(editor) {
    if (!editor) return null;
    try {
        return editor.view.coordsAtPos(editor.state.selection.head).top;
    } catch {
        return null;
    }
}

/** 貼り付け用。HTMLとして解釈させず、文字どおり入れる */
export function insertPlainText(editor, text) {
    if (!editor) return;
    const lines = String(text ?? '').split(/\r?\n/);
    if (lines.length === 1) {
        // insertContentに文字列を渡すとHTMLとして解釈されるため、テキストとして挿入する
        editor.view.dispatch(editor.state.tr.insertText(lines[0]));
        editor.commands.focus();
        return;
    }
    editor.chain().focus().insertContent(
        lines.map((line) => ({
            type: 'paragraph',
            content: line ? [{ type: 'text', text: line }] : [],
        }))
    ).run();
}

/** 本文全体を書式なしのテキストに置き換える(空行は落とす) */
export function setPlainText(editor) {
    if (!editor) return;
    const lines = editor.getText({ blockSeparator: '\n' })
        .split('\n').filter((l) => l.trim() !== '');
    // HTMLを組み立てずJSONで渡すので、本文に < が含まれていても壊れない
    editor.commands.setContent({
        type: 'doc',
        content: (lines.length ? lines : ['']).map((line) => ({
            type: 'paragraph',
            content: line ? [{ type: 'text', text: line }] : [],
        })),
    });
}

// ── 画像・リンクカード ──────────────────────────────────────────────────────

/** カーソル位置に画像を挿入する */
export function insertImage(editor, src) {
    if (!editor || !src) return;
    editor.chain().focus().setImage({ src }).run();
}

/** カーソル位置にリンクカードを挿入する */
export function insertBookLinkCard(editor, { href, label, domain, image }) {
    if (!editor) return;
    editor.chain().focus().insertContent({
        type: 'bookLinkCard',
        attrs: { href: href || '', label: label || '', domain: domain || '', image: image || '' },
    }).run();
}

/** カーソル位置に表(3行3列、見出し行付き)を挿入する */
export function insertTable(editor) {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
}

/**
 * YouTube/VimeoのURLを解析し、埋め込み用のiframe src(あるいはnull)を返す。
 * 見た目のHTMLは組み立てず、srcの値だけをここで決める(組み立てはスキーマ側の責務)。
 */
export function parseVideoEmbedUrl(url) {
    let u;
    try { u = new URL(String(url || '').trim()); } catch { return null; }
    const host = u.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
        const id = u.pathname.slice(1).split('/')[0];
        return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
        if (u.pathname === '/watch') {
            const id = u.searchParams.get('v');
            return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
        }
        const m = /^\/(embed|shorts)\/([^/?]+)/.exec(u.pathname);
        if (m) return `https://www.youtube-nocookie.com/embed/${m[2]}`;
        return null;
    }
    if (host === 'vimeo.com') {
        const m = /^\/(\d+)/.exec(u.pathname);
        return m ? `https://player.vimeo.com/video/${m[1]}` : null;
    }
    if (host === 'player.vimeo.com') {
        return u.pathname.startsWith('/video/') ? u.toString() : null;
    }
    return null;
}

/** カーソル位置に動画埋め込みを挿入する。urlが対応外の形式ならfalseを返す */
export function insertVideoEmbed(editor, url) {
    if (!editor) return false;
    const src = parseVideoEmbedUrl(url);
    if (!src) return false;
    editor.chain().focus().insertContent({ type: 'videoEmbed', attrs: { src } }).run();
    return true;
}

/**
 * DOM上の<img>に対応するノードのstyle属性を書き換える(サイズ変更用)。
 * DOMを直接いじってもgetHTML()は文書の状態から作られるため保存されない。
 * posAtDOMは画像の直前/直後を返すことがあるので、前後を見てノードを特定する。
 */
export function setImageStyle(editor, domImg, style) {
    if (!editor || !domImg) return false;
    const view = editor.view;
    let base;
    try { base = view.posAtDOM(domImg, 0); } catch { return false; }
    for (const pos of [base, base - 1, base + 1]) {
        if (pos < 0 || pos > editor.state.doc.content.size) continue;
        const node = editor.state.doc.nodeAt(pos);
        if (node && (node.type.name === 'image' || node.type.name === 'imageFigure')) {
            view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs, style: style || null,
            }));
            return true;
        }
    }
    return false;
}

/**
 * DOM上の<img>にキャプション(出典など)を付ける・外す。
 * キャプション有無で別のノード型(image ⇔ imageFigure)を使うため、属性の書き換えではなく
 * ノードの差し替えになる。無地画像(インライン)→キャプション付き(ブロックのfigure)への
 * 変更は、insertContentAtがブロックノードを段落の中に挿入する際に自動で段落を分割してくれる
 * 挙動を利用する(通常の画像挿入と同じ仕組み)。
 */
export function setImageCaption(editor, domImg, caption) {
    if (!editor || !domImg) return false;
    const view = editor.view;
    let base;
    try { base = view.posAtDOM(domImg, 0); } catch { return false; }
    const trimmed = (caption || '').trim();

    for (const pos of [base, base - 1, base + 1]) {
        if (pos < 0 || pos > editor.state.doc.content.size) continue;
        const node = editor.state.doc.nodeAt(pos);
        if (!node || (node.type.name !== 'image' && node.type.name !== 'imageFigure')) continue;

        const attrs = { src: node.attrs.src, style: node.attrs.style || null, class: node.attrs.class || null };
        if (node.type.name === 'imageFigure' && !trimmed) {
            // キャプションを空にした → 通常の画像(インライン)に戻す
            editor.chain().focus()
                .command(({ tr }) => { tr.delete(pos, pos + node.nodeSize); return true; })
                .insertContentAt(pos, { type: 'image', attrs })
                .run();
            return true;
        }
        if (node.type.name === 'imageFigure') {
            // キャプションの文言だけ差し替え
            view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...attrs, caption: trimmed }));
            return true;
        }
        if (!trimmed) return true; // 通常画像のままでキャプションも空 → 何もしない
        editor.chain().focus()
            .command(({ tr }) => { tr.delete(pos, pos + node.nodeSize); return true; })
            .insertContentAt(pos, { type: 'imageFigure', attrs: { ...attrs, caption: trimmed } })
            .run();
        return true;
    }
    return false;
}

/** 座標にいちばん近い位置へカーソルを移す(ドロップ位置に挿入するため) */
export function focusAtCoords(editor, x, y) {
    if (!editor) return;
    const found = editor.view.posAtCoords({ left: x, top: y });
    if (found) editor.commands.setTextSelection(found.pos);
    editor.commands.focus();
}

// ── 脚注 ───────────────────────────────────────────────────────────────────
// 本文中には印([1])だけを置き、注釈本文は note 属性に持つ。
// 一覧パネル(footnote-list-panel)とはこの4つの関数を通してやりとりする。

/** 本文中の脚注を文書順に返す [{ note, pos }] */
export function listFootnotes(editor) {
    const out = [];
    if (!editor) return out;
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'footnoteRef') out.push({ note: node.attrs.note || '', pos });
    });
    return out;
}

/**
 * 表示上の番号([1][2]...)を文書順に振り直す。
 * 途中に差し込んだときに以降の番号がずれるのを防ぐ。
 * 属性だけの変更で文書の長さは変わらないため、走査中のposはそのまま使える。
 */
export function renumberFootnotes(editor) {
    if (!editor) return;
    const { state } = editor;
    const tr = state.tr;
    let n = 0, changed = false;
    state.doc.descendants((node, pos) => {
        if (node.type.name !== 'footnoteRef') return;
        n += 1;
        const label = `[${n}]`;
        if (node.attrs.label !== label) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, label });
            changed = true;
        }
    });
    // 番号の振り直しは書き手の操作ではないので、undo履歴には積まない
    if (changed) editor.view.dispatch(tr.setMeta('addToHistory', false));
}

/** カーソル位置に脚注を挿入する。番号は挿入後に振り直す */
export function insertFootnote(editor, note) {
    if (!editor) return;
    editor.chain().focus().insertContent({
        type: 'footnoteRef',
        attrs: { note: note || '', label: '[?]' },
    }).run();
    renumberFootnotes(editor);
}

/** 一覧パネルで編集された注釈本文を、対応する脚注へ書き戻す */
export function updateFootnote(editor, index, note) {
    if (!editor) return;
    const target = listFootnotes(editor)[index];
    if (!target) return;
    const node = editor.state.doc.nodeAt(target.pos);
    if (!node) return;
    editor.view.dispatch(
        editor.state.tr.setNodeMarkup(target.pos, undefined, { ...node.attrs, note })
    );
}

export { Editor, buildExtensions };
