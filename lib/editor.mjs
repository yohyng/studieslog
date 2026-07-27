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
    const editor = new Editor({
        element,
        extensions: buildExtensions(),
        content: migrateLegacyFootnotes(content) || '<p></p>',
        editable,
        // contenteditable時代のCSS(.content-editor)をそのまま効かせる
        editorProps: { attributes: { class: 'content-editor-body' } },
        onUpdate: onUpdate ? () => onUpdate(editor) : undefined,
    });
    return editor;
}

/** 保存用のHTMLを取り出す。空のときは既存実装と同じく <p></p> を返す */
export function getHtml(editor) {
    if (!editor) return '<p></p>';
    return editor.isEmpty ? '<p></p>' : editor.getHTML();
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

export { Editor, buildExtensions };
