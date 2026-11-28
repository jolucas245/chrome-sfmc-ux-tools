import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { typedTags } from '../src/editor-language/rich-text.js';

// these tests run the built extension; "npm test" builds it first (pretest)
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const dataScript = read('../dist/extension/language-data.js');
const languageScript = read('../dist/extension/editor-language.js');
const NOTICE = '.sfmc-rich-text-notice';
const HIGHLIGHT = 'sfmc-typed-tag';
// the page is looked at shortly after it changed, and the content once typing has paused
const scanPause = () => new Promise((resolve) => setTimeout(resolve, 150));
const checkPause = () => new Promise((resolve) => setTimeout(resolve, 650));

/**
 * Creates a page the way Content Builder's is while a free form block is edited.
 *
 * @returns {object} the page's window
 */
function page() {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    return window;
}

/**
 * Gives a frame what a browser has for underlines that add no element, which jsdom lacks.
 *
 * @param {HTMLIFrameElement} frame frame of an editor
 */
function withHighlights(frame) {
    const view = frame.contentWindow;
    view.CSS.highlights = new Map();
    view.Highlight = class extends Set {};
}

/**
 * Adds a stand-in for a CKEditor 4 to the page: an element with a frame whose body is edited,
 * and the events of the editor.
 *
 * @param {object} window page window
 * @param {string} html content of the editor
 * @param {{hasHighlights?: boolean}} [options] whether the frame can underline without elements
 * @returns {object} the editor, with `fire(name)` to tell its listeners and `frame()` for its frame
 */
function addRichText(window, html, { hasHighlights = true } = {}) {
    const { document } = window;
    const container = document.createElement('div');
    container.className = 'cke';
    document.body.append(container);
    const listeners = {};
    let frame;
    const editor = {
        mode: 'wysiwyg',
        container: { $: container },
        editable: () => ({ $: frame.contentDocument.body }),
        /**
         * Registers a listener the way CKEditor does.
         *
         * @param {string} name name of the event
         * @param {(event: object) => unknown} listener what to call
         * @param {object | null} scope what the listener is called on
         * @param {unknown} data what the listener is handed
         * @param {number} priority place among the listeners
         */
        on(name, listener, scope, data, priority) {
            assert.equal(priority, 999, 'after the listeners of the editor itself');
            (listeners[name] ??= []).push(listener);
        },
        /**
         * Tells the listeners of an event, the way CKEditor does.
         *
         * @param {string} name name of the event
         */
        fire(name) {
            const told = listeners[name] ?? [];
            for (const listener of told) {
                // a returned false would cancel the editor's event
                assert.equal(listener({ name }), undefined);
            }
        },
        frame: () => frame,
        /**
         * Gives the editor a new frame with content, as it does when it gets its data.
         *
         * @param {string} content content of the editor
         */
        load(content) {
            frame?.remove();
            frame = document.createElement('iframe');
            container.append(frame);
            frame.contentDocument.body.innerHTML = content;
            if (hasHighlights) {
                withHighlights(frame);
            }
        },
    };
    editor.load(html);
    window.CKEDITOR ??= { instances: {} };
    window.CKEDITOR.instances[`editor${Object.keys(window.CKEDITOR.instances).length + 1}`] =
        editor;
    return editor;
}

/**
 * Runs the extension's language script in the page.
 *
 * @param {object} window page window
 */
function runExtension(window) {
    window.eval(dataScript);
    window.eval(languageScript);
}

/**
 * Lists what is underlined in an editor.
 *
 * @param {object} editor editor from `addRichText`
 * @returns {string[]} the underlined texts
 */
function underlined(editor) {
    const highlight = editor.frame().contentWindow.CSS.highlights.get(HIGHLIGHT);
    return [...(highlight ?? [])].map(String);
}

/**
 * Lists what looks like a tag in a text.
 *
 * @param {string} text text as it was typed
 * @returns {string[]} the tags
 */
function found(text) {
    return typedTags(text).map(({ start, end }) => text.slice(start, end));
}

test('typed tags: what looks like a tag is found, comparisons and AMPscript are not', () => {
    assert.deepEqual(found('a <script>x</script> b'), ['<script>', '</script>']);
    assert.deepEqual(found('<DIV class="x"> <br/> <br /> <my-tag>'), [
        '<DIV class="x">',
        '<br/>',
        '<br />',
        '<my-tag>',
    ]);
    assert.deepEqual(found('<script runat="server">'), ['<script runat="server">']);
    assert.deepEqual(found('a < b, c > d, <3, <a@b.c>, < b>, <>, 1<2>1'), []);
    assert.deepEqual(found('%%[ if @a <b and @c> 1 then ]%% %%=Concat("<b>")=%%'), []);
    assert.deepEqual(found('%%[ set @a = 1 ]%% <b>'), ['<b>']);
});

test('a tag typed into the rich text editor is underlined and explained above the editor', async () => {
    const window = page();
    const editor = addRichText(
        window,
        '<p>PROBE &lt;script&gt;alert(1)&lt;/script&gt; <b>bold</b> a &lt; b</p><p>&lt;br/&gt;</p>',
    );
    const before = editor.frame().contentDocument.body.outerHTML;
    runExtension(window);
    const notice = window.document.querySelector(NOTICE);
    assert.ok(notice, 'the note is there');
    assert.equal(notice.nextSibling, editor.container.$, 'right before the editor');
    assert.match(notice.textContent, /“<script>” and 2 more look like HTML tags/);
    assert.match(notice.textContent, /saved as plain text/);
    assert.match(notice.textContent, /HTML Editor tab of the block/);
    assert.equal(notice.querySelector('a').href, 'https://sfmc.guide/engagement/code-persistence/');
    const icon = notice.querySelector('.sfmc-rich-text-icon');
    assert.match(icon.title, /^SFMC UX Tools: /, 'the icon says what the extension added');
    assert.deepEqual(underlined(editor), ['<script>', '</script>', '<br/>']);
    assert.equal(editor.frame().contentDocument.adoptedStyleSheets.length, 1);
    // nothing of the extension is in what the editor saves
    assert.equal(editor.frame().contentDocument.body.outerHTML, before);
    assert.equal(editor.frame().contentDocument.querySelectorAll('style').length, 0);
});

test('rich text: real elements, scripts and AMPscript are not marked', async () => {
    const window = page();
    const editor = addRichText(
        window,
        '<p><b>bold</b> <br> %%[ if @a &lt;b and @c&gt; 1 then ]%% x</p><script>if (a <b> c) {}</script>',
    );
    runExtension(window);
    assert.equal(window.document.querySelector(NOTICE), null);
    assert.deepEqual(underlined(editor), []);
});

test('rich text: the note follows the text, with one tag, a long tag, and a tag in pieces', async () => {
    const window = page();
    const editor = addRichText(window, '<p>plain</p>');
    runExtension(window);
    assert.equal(window.document.querySelector(NOTICE), null);

    // the editor splits what is typed into text nodes that touch
    const paragraph = editor.frame().contentDocument.querySelector('p');
    paragraph.append('<scr', 'ipt>');
    editor.fire('change');
    assert.equal(window.document.querySelector(NOTICE), null, 'only once typing has paused');
    await checkPause();
    const notice = window.document.querySelector(NOTICE);
    assert.match(notice.textContent, /“<script>” looks like an HTML tag\. Typed here, it is/);
    assert.deepEqual(underlined(editor), ['<script>']);

    paragraph.textContent = `<div style="${'x'.repeat(60)}">`;
    editor.fire('change');
    await checkPause();
    assert.match(notice.textContent, /“<div style="x{28}…” looks like/);
    assert.equal(window.document.querySelector(NOTICE), notice, 'the same note');

    paragraph.textContent = 'fixed';
    editor.fire('change');
    await checkPause();
    assert.equal(window.document.querySelector(NOTICE), null);
    assert.deepEqual(underlined(editor), []);
});

test('rich text: new content, the source view, a redrawn page and the end of the editor', async () => {
    const window = page();
    const editor = addRichText(window, '<p>&lt;b&gt;</p>');
    runExtension(window);
    assert.deepEqual(underlined(editor), ['<b>']);

    // the editor gets its content in a new frame
    editor.load('<p>&lt;i&gt; and &lt;/i&gt;</p>');
    editor.fire('contentDom');
    assert.deepEqual(underlined(editor), ['<i>', '</i>']);
    assert.equal(editor.frame().contentDocument.adoptedStyleSheets.length, 1);
    assert.match(window.document.querySelector(NOTICE).textContent, /“<i>” and 1 more/);

    // the page takes the note away while it redraws; it comes back
    window.document.querySelector(NOTICE).remove();
    window.document.body.append(window.document.createElement('span'));
    await scanPause();
    assert.equal(window.document.querySelector(NOTICE)?.nextSibling, editor.container.$);

    editor.mode = 'source';
    editor.fire('mode');
    assert.equal(window.document.querySelector(NOTICE), null);
    assert.deepEqual(underlined(editor), []);
    editor.mode = 'wysiwyg';
    editor.fire('mode');
    assert.ok(window.document.querySelector(NOTICE));

    editor.fire('destroy');
    assert.equal(window.document.querySelector(NOTICE), null);
    assert.deepEqual(underlined(editor), []);
    window.document.body.append(window.document.createElement('span'));
    await scanPause();
    assert.equal(window.document.querySelector(NOTICE), null, 'and stays away');
});

test('rich text: an editor that is opened later is found, each editor has its own note, and a browser without highlights still gets the note', async () => {
    const window = page();
    runExtension(window);
    assert.equal(window.document.querySelector(NOTICE), null, 'a page without such an editor');

    const first = addRichText(window, '<p>&lt;b&gt;</p>', { hasHighlights: false });
    const second = addRichText(window, '<p>fine</p>');
    await scanPause();
    const notices = window.document.querySelectorAll(NOTICE);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].nextSibling, first.container.$);
    assert.equal(first.frame().contentWindow.CSS.highlights, undefined);
    assert.deepEqual(underlined(second), []);

    // an editor whose content cannot be read keeps the others working
    window.CKEDITOR.instances.odd = {
        /**
         *
         */
        on() {},
        mode: 'wysiwyg',
        editable: () => null,
    };
    window.CKEDITOR.instances.none = null;
    second.frame().contentDocument.querySelector('p').textContent = '</td>';
    second.fire('change');
    await checkPause();
    assert.equal(window.document.querySelectorAll(NOTICE).length, 2);
    assert.deepEqual(underlined(second), ['</td>']);
});
