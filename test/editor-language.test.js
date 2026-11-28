import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { coveringDialog } from '../src/editor-language/tooltip.js';
import { findDynamicCode } from '../scripts/find-dynamic-code.js';

// these tests run the built extension; "npm test" builds it first (pretest)
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const codeMirrorSource = readFileSync(require.resolve('codemirror/lib/codemirror.js'), 'utf8');
const showHintSource = readFileSync(require.resolve('codemirror/addon/hint/show-hint.js'), 'utf8');
const htmlModeSources = [
    'codemirror/mode/xml/xml.js',
    'codemirror/mode/javascript/javascript.js',
    'codemirror/mode/css/css.js',
    'codemirror/mode/htmlmixed/htmlmixed.js',
].map((id) => readFileSync(require.resolve(id), 'utf8'));
const dataScript = read('../dist/extension/language-data.js');
const highlightScript = read('../dist/extension/editor-highlight.js');
const completionsScript = read('../dist/extension/editor-language.js');
const formatScript = read('../dist/extension/editor-format.js');
// not a content script: the extension loads it on demand, which `runExtension` does when asked to
const typescriptScript = read('../dist/extension/editor-typescript.js');
const BASE_MODE = 'ampScriptHtmlMixed';
const POPUP = '.CodeMirror-hints';

/**
 * Creates a page that has CodeMirror 5 the way Marketing Cloud ships it: with an
 * "ampScriptHtmlMixed" mode (here plain HTML) and without a global `CodeMirror`.
 *
 * @param {{hasShowHint?: boolean}} [options] whether the page's CodeMirror has the hint addon
 * @returns {{window: object, CodeMirror: object}} the page and its CodeMirror constructor
 */
function page({ hasShowHint = true } = {}) {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    // jsdom has no layout; CodeMirror only needs these to exist
    window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    window.Range.prototype.getClientRects = () => [];
    window.eval(codeMirrorSource);
    for (const source of htmlModeSources) {
        window.eval(source);
    }
    if (hasShowHint) {
        window.eval(showHintSource);
    }
    const CodeMirror = window.CodeMirror;
    delete window.CodeMirror;
    CodeMirror.defineMode(BASE_MODE, (config) => CodeMirror.getMode(config, 'htmlmixed'));
    return { window, CodeMirror };
}

/**
 * Adds an editor to the page, with the cursor where the content has a "|".
 *
 * @param {{window: object, CodeMirror: object}} context page from `page()`
 * @param {string} content editor content; a "|" marks the cursor and is removed
 * @param {string} [mode] mode option
 * @returns {object} CodeMirror instance
 */
function addEditor({ window, CodeMirror }, content, mode = BASE_MODE) {
    const offset = content.indexOf('|');
    const value = offset === -1 ? content : content.slice(0, offset) + content.slice(offset + 1);
    const editor = new CodeMirror(window.document.body, { value, mode });
    if (offset !== -1) {
        editor.setCursor(editor.posFromIndex(offset));
    }
    return editor;
}

/**
 * Runs the extension's editor scripts in the page, in the order of the manifest.
 *
 * @param {object} window page window
 * @param {{hasTypescript?: boolean}} [options] whether the TypeScript script is loaded as well
 */
function runExtension(window, { hasTypescript = false } = {}) {
    window.eval(dataScript);
    window.eval(highlightScript);
    window.eval(completionsScript);
    window.eval(formatScript);
    if (hasTypescript) {
        window.eval(typescriptScript);
    }
}

/**
 * Presses Ctrl-Space the way CodeMirror would: through the key map the extension registered.
 *
 * @param {object} editor CodeMirror instance
 * @returns {unknown} what the key binding returned
 */
function pressCtrlSpace(editor) {
    const keyMap = editor.state.keyMaps.find((map) => 'Ctrl-Space' in map);
    assert.ok(keyMap, 'Ctrl-Space is bound');
    return keyMap['Ctrl-Space'](editor);
}

/**
 * Types text at the cursor and tells the editor's listeners about it, like real input does.
 *
 * @param {{CodeMirror: object}} context page from `page()`
 * @param {object} editor CodeMirror instance
 * @param {string} text typed text
 */
function type({ CodeMirror }, editor, text) {
    editor.replaceSelection(text, 'end', '+input');
    CodeMirror.signal(editor, 'inputRead', editor, { origin: '+input', text: [text] });
}

/**
 * The suggestions that are currently on offer.
 *
 * @param {object} editor CodeMirror instance
 * @returns {object[]} CodeMirror hints; empty if no popup is open
 */
function hints(editor) {
    // copied, because an array of the page is never deep-equal to one of the test
    return [...(editor.state.completionActive?.data?.list ?? [])];
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 200));

test('offers AMPscript functions that start with the typed word', () => {
    const context = page();
    const editor = addEditor(context, '<p>%%[ set @a = Loo| ]%%</p>');
    runExtension(context.window);
    pressCtrlSpace(editor);
    const labels = hints(editor).map((hint) => hint.displayText);
    assert.ok(labels.includes('Lookup'), labels.join(' | '));
    assert.ok(labels.includes('LookupRows'), labels.join(' | '));
    assert.ok(labels.length < 20, 'only names that start with "Loo"');
    for (const label of labels) {
        assert.match(label, /^loo/i);
    }
    const popup = context.window.document.querySelector(POPUP);
    assert.equal(popup.parentNode, context.window.document.body);
    const entry = [...popup.children].find((item) => item.firstChild.textContent === 'Lookup');
    // category and parameters, cut to length; the name is not repeated
    assert.equal(
        entry.querySelector('.sfmc-hint-detail').textContent,
        'Data Extension · dataObject, returnColumn, searchColumn1, s…',
    );
});

test('ignores the letter case of the typed word and offers keywords and variables too', () => {
    const context = page();
    const editor = addEditor(context, '%%[ var @count\nSE| ]%%');
    runExtension(context.window);
    pressCtrlSpace(editor);
    assert.ok(
        hints(editor)
            .map((hint) => hint.displayText)
            .includes('set'),
    );
    editor.state.completionActive.close();
    editor.replaceRange('set @co', { line: 1, ch: 0 }, { line: 1, ch: 2 });
    pressCtrlSpace(editor);
    assert.deepEqual(
        hints(editor).map((hint) => hint.displayText),
        ['@count'],
    );
});

test('offers nothing in plain HTML text', () => {
    const context = page();
    const html = addEditor(context, '<p>Hello Loo|</p> %%[ set @a = 1 ]%%');
    runExtension(context.window);
    // the key is passed on, so that a binding of the page still runs
    assert.equal(pressCtrlSpace(html), context.CodeMirror.Pass);
    assert.equal(html.state.completionActive, undefined);
    assert.deepEqual(hints(html), []);
    assert.equal(context.window.document.querySelector(POPUP), null);
});

/**
 * Opens the popup in a server-side script and lists what it offers.
 *
 * @param {object} context page from `page()`
 * @param {string} body content of the script; a "|" marks the cursor
 * @param {{hasTypescript?: boolean}} [options] passed on to `runExtension`
 * @returns {{editor: object, labels: string[], pick: (label: string) => void}} the editor, the names on offer and a way to choose one
 */
function inSsjs(context, body, options) {
    const editor = addEditor(
        context,
        `<p>%%=v(@a)=%%</p>\n<script runat="server">\n${body}\n</script>`,
    );
    runExtension(context.window, options);
    pressCtrlSpace(editor);
    return {
        editor,
        labels: hints(editor).map((hint) => hint.displayText),
        pick: (label) => {
            const completion = editor.state.completionActive;
            completion.pick(
                completion.data,
                completion.data.list.findIndex((entry) => entry.displayText === label),
            );
        },
    };
}

test('offers SSJS names in a server-side script, by their objects or by the name alone', () => {
    const chain = inSsjs(page(), 'var a = Platform.Function.Loo|');
    assert.ok(chain.labels.includes('Platform.Function.Lookup'), chain.labels.join(' | '));
    for (const label of chain.labels) {
        assert.match(label, /^Platform\.Function\.Loo/);
    }
    chain.pick('Platform.Function.Lookup');
    assert.equal(chain.editor.getLine(2), 'var a = Platform.Function.Lookup(');

    const word = inSsjs(page(), 'var a = looku|');
    assert.ok(word.labels.includes('Platform.Function.Lookup'), word.labels.join(' | '));
    assert.ok(!word.labels.includes('LookupRows'), 'no AMPscript names');
    word.pick('Platform.Function.LookupRows');
    assert.equal(word.editor.getLine(2), 'var a = Platform.Function.LookupRows(');

    const starts = inSsjs(page(), 'Wr|');
    assert.equal(starts.labels[0], 'Write', 'names that start with the typed text come first');
    const entry = [
        ...starts.editor.getWrapperElement().ownerDocument.querySelector(POPUP).children,
    ][0];
    assert.equal(entry.querySelector('.sfmc-hint-detail').textContent, 'global · text');
});

test('SSJS: objects, own functions, constructors and existing brackets', () => {
    const object = inSsjs(page(), 'var de = DataEx|');
    object.pick('DataExtension');
    assert.equal(object.editor.getLine(2), 'var de = DataExtension');

    const own = inSsjs(page(), 'function greet(name) { return name; }\ngre|');
    assert.deepEqual(own.labels, ['greet']);
    own.pick('greet');
    assert.equal(own.editor.getLine(3), 'greet(');

    const created = inSsjs(page(), 'var req = new Script.Util.HttpR|');
    created.pick('Script.Util.HttpRequest');
    assert.equal(created.editor.getLine(2), 'var req = new Script.Util.HttpRequest(');

    const bracket = inSsjs(page(), 'Platform.Function.Loo|kup("a")');
    bracket.pick('Platform.Function.LookupRows');
    assert.equal(bracket.editor.getLine(2), 'Platform.Function.LookupRows("a")');
});

test('SSJS: nothing for members of unknown values, and AMPscript stays AMPscript', () => {
    const context = page();
    const member = addEditor(context, '<script runat="server">\nvar a = de.Ro|\n</script>');
    const result = addEditor(context, '<script runat="server">\nvar a = get().Wr|\n</script>');
    const browser = addEditor(context, '<script>\nvar a = Platform.Function.Loo|\n</script>');
    const block = addEditor(
        context,
        '<script runat="server">var a = 1;</script>\n%%[ set @a = Loo| ]%%',
    );
    runExtension(context.window);
    assert.equal(pressCtrlSpace(member), context.CodeMirror.Pass);
    assert.equal(pressCtrlSpace(result), context.CodeMirror.Pass);
    assert.equal(pressCtrlSpace(browser), context.CodeMirror.Pass, 'no SSJS in browser scripts');
    pressCtrlSpace(block);
    assert.ok(
        hints(block)
            .map((hint) => hint.displayText)
            .includes('LookupRows'),
    );
});

test('SSJS: the popup opens while typing, also after a dot, but not in strings or comments', async () => {
    const context = page();
    const open = '<script runat="server">\n';
    const code = addEditor(context, open + 'Platform.Function|\n</script>');
    const string = addEditor(context, open + 'var a = "Platform|";\n</script>');
    const comment = addEditor(context, open + '// Platform|\n</script>');
    const html = addEditor(context, '<p>Platform|</p>');
    runExtension(context.window);
    for (const editor of [code, string, comment, html]) {
        type(context, editor, '.');
    }
    await pause();
    assert.ok(hints(code).length > 0);
    for (const hint of hints(code)) {
        assert.match(hint.displayText, /^Platform\.Function\./);
    }
    assert.equal(string.state.completionActive, undefined);
    assert.equal(comment.state.completionActive, undefined);
    assert.equal(html.state.completionActive, undefined);
});

/**
 * Opens the popup and lists the names it offers.
 *
 * @param {object} context page from `page()`
 * @param {string} content editor content; a "|" marks the cursor
 * @returns {{editor: object, labels: string[]}} the editor and the names on offer
 */
function offered(context, content) {
    const editor = addEditor(context, content);
    runExtension(context.window);
    pressCtrlSpace(editor);
    return { editor, labels: hints(editor).map((hint) => hint.displayText) };
}

test('browser scripts get plain JavaScript: their own names, keywords and globals', () => {
    const own = offered(
        page(),
        '<script runat="server">var counterServer = 1;</script>\n' +
            '<script>\nvar counterTotal = 1; // counterComment "counterString"\n' +
            'function countUp(step) { item.counterMember = step; }\ncou|\n</script>',
    );
    assert.deepEqual(own.labels, ['counterTotal', 'countUp']);

    const words = offered(page(), '<script>\nco|\n</script>');
    assert.deepEqual(words.labels, ['console', 'continue', 'const']);

    const module = offered(page(), '<script type="module">\nconst total = 1;\nto|\n</script>');
    assert.deepEqual(module.labels, ['total']);

    const member = offered(page(), '<script>\nvar total = 1;\ndocument.to|\n</script>');
    assert.deepEqual(member.labels, [], 'nothing is known about members');

    const template = offered(
        page(),
        '<script type="text/x-template">\nvar total = 1;\nto|\n</script>',
    );
    assert.deepEqual(template.labels, [], 'not JavaScript');
});

test('SSJS also gets the names of its own scripts, after those of Marketing Cloud', () => {
    const { labels } = offered(
        page(),
        '<script>var rowsBrowser = 1; let letter;</script>\n' +
            '<script runat="server">\nvar rowsFound = 1;\nr|\n</script>',
    );
    assert.ok(labels.includes('rowsFound'), labels.join(' | '));
    assert.ok(labels.includes('return'));
    assert.ok(!labels.includes('rowsBrowser'), 'names of browser scripts stay there');
    assert.ok(labels.indexOf('Request.GetQueryStringParameter') < labels.indexOf('rowsFound'));
    const none = offered(page(), '<script runat="server">\nle|\n</script>');
    assert.ok(!none.labels.includes('let'), 'no keywords that SSJS rejects');
});

test('leaves read-only editors and selections alone', () => {
    const context = page();
    const locked = addEditor(context, '%%[ set @a = Loo| ]%%');
    locked.setOption('readOnly', true);
    const selecting = addEditor(context, '%%[ set @a = Loo| ]%%');
    selecting.setSelection({ line: 0, ch: 13 }, { line: 0, ch: 16 });
    runExtension(context.window);
    assert.equal(pressCtrlSpace(locked), context.CodeMirror.Pass);
    assert.equal(pressCtrlSpace(selecting), context.CodeMirror.Pass);
    assert.equal(context.window.document.querySelector(POPUP), null);
});

test('a pick inside a word replaces the whole word and keeps an existing bracket', () => {
    const context = page();
    const editor = addEditor(context, '%%[ set @a = Loo|kup("a") ]%%');
    runExtension(context.window);
    pressCtrlSpace(editor);
    const completion = editor.state.completionActive;
    completion.pick(
        completion.data,
        completion.data.list.findIndex((entry) => entry.displayText === 'LookupRows'),
    );
    assert.equal(editor.getValue(), '%%[ set @a = LookupRows("a") ]%%');
});

test('picking a suggestion replaces only the typed word', () => {
    const context = page();
    const editor = addEditor(context, '<p>%%[ set @a = Loo| ]%%</p>');
    runExtension(context.window);
    pressCtrlSpace(editor);
    const completion = editor.state.completionActive;
    completion.pick(
        completion.data,
        hints(editor).findIndex((hint) => hint.displayText === 'Lookup'),
    );
    assert.equal(editor.getValue(), '<p>%%[ set @a = Lookup( ]%%</p>');
    assert.equal(editor.getCursor().ch, '<p>%%[ set @a = Lookup('.length);
    assert.equal(context.window.document.querySelector(POPUP), null);
});

test('inserts keywords and variables as plain text, without snippet placeholders', () => {
    const context = page();
    const editor = addEditor(context, '%%[ var @count\ni| ]%%');
    runExtension(context.window);
    pressCtrlSpace(editor);
    const byLabel = (label) => hints(editor).find((hint) => hint.displayText === label);
    // the language service offers "if ${1:condition} then ..."; the text ends where the cursor belongs
    assert.equal(byLabel('if').text, 'if ');
    editor.state.completionActive.close();
    editor.replaceRange('@', { line: 1, ch: 0 }, { line: 1, ch: 1 });
    pressCtrlSpace(editor);
    assert.equal(byLabel('@count').text, '@count');
    for (const hint of hints(editor)) {
        assert.doesNotMatch(hint.text, /\$\{|\$\d/);
    }
});

test('opens the popup while typing, but not inside strings or comments', async () => {
    const context = page();
    const code = addEditor(context, '%%[ set @a = | ]%%');
    const string = addEditor(context, '%%[ set @a = "| ]%%');
    const comment = addEditor(context, '%%[ /* | */ ]%%');
    const space = addEditor(context, '%%[ set @a =| ]%%');
    runExtension(context.window);
    type(context, code, 'L');
    type(context, code, 'o');
    type(context, string, 'L');
    type(context, comment, 'L');
    type(context, space, ' ');
    assert.deepEqual(hints(code), [], 'waits until typing pauses');
    await pause();
    assert.ok(
        hints(code)
            .map((hint) => hint.displayText)
            .includes('Lookup'),
    );
    assert.equal(string.state.completionActive, undefined);
    assert.equal(comment.state.completionActive, undefined);
    assert.equal(space.state.completionActive, undefined);
    assert.equal(code.getValue(), '%%[ set @a = Lo ]%%', 'typing alone inserts nothing');
});

const HOVER = '.sfmc-hover';
const hoverPause = () => new Promise((resolve) => setTimeout(resolve, 450));

/**
 * Rests the mouse on a character of an editor. jsdom has no layout, so the editor is told
 * which character that is.
 *
 * @param {object} context page from `page()`
 * @param {object} editor CodeMirror instance
 * @param {string} before text that ends right before the character
 * @param {object} [extra] more of what CodeMirror reports for the place, like `outside`
 */
function rest(context, editor, before, extra = {}) {
    const place = editor.posFromIndex(editor.getValue().indexOf(before) + before.length);
    // the gap after the character and "left of it" is what CodeMirror reports for its right half
    editor.coordsChar = () => ({ line: place.line, ch: place.ch + 1, xRel: -1, ...extra });
    editor.charCoords = () => ({ left: 10, right: 20, top: 100, bottom: 115 });
    editor
        .getWrapperElement()
        .dispatchEvent(new context.window.MouseEvent('mousemove', { bubbles: true }));
}

test('resting the mouse on an AMPscript function shows its documentation', async () => {
    const context = page();
    const editor = addEditor(context, '<p>%%[ set @a = Lookup("a", "b", "c", 1) ]%%</p>');
    runExtension(context.window);
    const { document } = context.window;
    rest(context, editor, 'set @a = Look');
    assert.equal(document.querySelector(HOVER), null, 'waits until the mouse rests');
    await hoverPause();
    const box = document.querySelector(HOVER);
    assert.equal(box.parentNode, document.body);
    assert.match(box.querySelector('pre').textContent, /^\(function\) Lookup\(dataObject: string/);
    assert.match(box.textContent, /Returns a single field value/);
    assert.ok([...box.querySelectorAll('code')].some((code) => code.textContent === 'dataObject'));
    const link = box.querySelector('a');
    assert.match(link.href, /^https:\/\//);
    assert.equal(link.target, '_blank');
    assert.match(link.rel, /noopener/);
    assert.equal(box.querySelector('script'), null);
    assert.doesNotMatch(box.textContent, /\*\*|```/, 'no Markdown marks are left');
    // the code has the editor's colours: the signature as JavaScript, the example as AMPscript
    const [signature, example] = box.querySelectorAll('pre');
    assert.ok(signature.querySelector('span[class^="cm-"]'), signature.textContent);
    assert.match(example.textContent, /^%%=Lookup\(/);
    assert.equal(example.querySelector('.cm-sfmc-function').textContent, 'Lookup');
    assert.equal(example.querySelector('.cm-sfmc-delimiter').textContent, '%%=');

    rest(context, editor, '<');
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null, 'gone where there is nothing to say');
    rest(context, editor, 'set @a = Look', { outside: 1 });
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null, 'nothing beside the text');
});

test('hover: SSJS in server-side scripts, nothing in browser scripts, gone on typing', async () => {
    const context = page();
    const editor = addEditor(
        context,
        '<script runat="server">\nvar a = Platform.Function.Lookup("a", "b", "c", 1);\n</script>\n' +
            '<script>\nvar b = Platform.Function.Lookup("a");\n</script>',
    );
    runExtension(context.window);
    const { document } = context.window;
    rest(context, editor, 'var a = Platform.Function.Look');
    await hoverPause();
    assert.match(
        document.querySelector(HOVER + ' pre').textContent,
        /^\(function\) Platform\.Function\.Lookup\(deName: string/,
    );
    editor.replaceRange(' ', { line: 0, ch: 0 });
    assert.equal(document.querySelector(HOVER), null);
    rest(context, editor, 'var b = Platform.Function.Look');
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null);
});

test('boxes go away with their editor', async () => {
    const context = page();
    const { editor, box } = await withCursor(context, '%%[ set @a = Lookup("de", |"field") ]%%');
    const { document } = context.window;
    rest(context, editor, 'set @a = Look');
    await hoverPause();
    assert.ok(box());
    assert.ok(document.querySelector(HOVER));
    editor.getWrapperElement().remove();
    await pause();
    assert.equal(box(), null);
    assert.equal(document.querySelector(HOVER), null);
});

test('an editor that left the page is let go of once, and watched again when it comes back', async () => {
    const context = page();
    const { editor, box } = await withCursor(context, '%%[ set @a = Lookup("de", |"field") ]%%');
    const { document } = context.window;
    const shown = box();
    const wrapper = editor.getWrapperElement();
    wrapper.remove();
    await pause();
    assert.equal(box(), null);
    // the page changes on; what was taken away is not taken away again
    let removals = 0;
    const { remove } = shown;
    shown.remove = () => removals++;
    for (let change = 0; change < 3; change++) {
        document.body.append(document.createElement('p'));
        await pause();
    }
    assert.equal(removals, 0);
    shown.remove = remove;
    // back on the page it works as before, and its box goes with it again
    document.body.append(wrapper);
    await pause();
    context.CodeMirror.signal(editor, 'cursorActivity', editor);
    await pause();
    assert.equal(box(), shown);
    wrapper.remove();
    await pause();
    assert.equal(box(), null);
});

/**
 * Puts a focused editor into a dialog that is open, with the cursor in a call and behind the
 * start of a name, and opens its suggestions.
 *
 * @param {(dialog: HTMLDialogElement, document: Document) => void} place puts the dialog on the page
 * @returns {Promise.<{document: Document, dialog: HTMLDialogElement, parents: () => (Node | null)[]}>} the page, the dialog, and where the box of the parameter help and the list of suggestions stand
 */
async function inDialog(place) {
    const context = page();
    const { document } = context.window;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    place(dialog, document);
    const content = '%%[ set @a = Lookup("de", Loo';
    const editor = new context.CodeMirror(dialog, { value: content, mode: BASE_MODE });
    editor.setCursor(editor.posFromIndex(content.length));
    editor.hasFocus = () => true;
    editor.cursorCoords = () => ({ left: 10, right: 10, top: 100, bottom: 115 });
    runExtension(context.window);
    context.CodeMirror.signal(editor, 'cursorActivity', editor);
    await pause();
    pressCtrlSpace(editor);
    assert.ok(hints(editor).length > 0);
    return {
        document,
        dialog,
        parents: () => [
            document.querySelector(SIGNATURE).parentNode,
            document.querySelector(POPUP).parentNode,
        ],
    };
}

/**
 * Makes a dialog say that it is a modal one; jsdom knows none.
 *
 * @param {HTMLDialogElement} dialog the dialog
 */
function asModal(dialog) {
    const { matches } = dialog;
    dialog.matches = (selector) => selector === ':modal' || matches.call(dialog, selector);
}

test('boxes and suggestions stand in a dialog only if it is a modal one of the page itself', async () => {
    const modal = await inDialog((dialog, document) => {
        asModal(dialog);
        document.body.append(dialog);
    });
    assert.deepEqual(modal.parents(), [modal.dialog, modal.dialog]);
    // a dialog that is merely open covers nothing
    const open = await inDialog((dialog, document) => document.body.append(dialog));
    assert.deepEqual(open.parents(), [open.document.body, open.document.body]);
    // nor is one of a shadow tree used, which the stylesheet of the boxes does not reach into
    const { document } = open;
    const inside = (dialog) => {
        const element = document.createElement('div');
        dialog.append(element);
        return element;
    };
    const shadowed = document.createElement('dialog');
    asModal(shadowed);
    const host = document.createElement('div');
    document.body.append(host);
    host.attachShadow({ mode: 'open' }).append(shadowed);
    assert.equal(coveringDialog(inside(shadowed)), null);
    assert.equal(coveringDialog(inside(modal.dialog)), modal.dialog);
    assert.equal(coveringDialog(inside(open.dialog)), null);
    assert.equal(coveringDialog(document.body), null);
    assert.equal(coveringDialog(), null);
});

/**
 * Lists the coloured names of a code block of a box.
 *
 * @param {Element} block the code block
 * @returns {Object.<string, string>} class of each coloured piece by its text; the last one wins
 */
function coloured(block) {
    return Object.fromEntries(
        [...block.querySelectorAll('span')].map((piece) => [piece.textContent, piece.className]),
    );
}

test('hover: code has the colours VS Code gives it: function names, types, and no frame', async () => {
    const context = page();
    const editor = addEditor(
        context,
        '<script runat="server">\nPlatform.Response.Write("x");\n</script>',
    );
    runExtension(context.window);
    rest(context, editor, 'Platform.Response.Wri');
    await hoverPause();
    const [signature, example] = context.window.document.querySelectorAll(`${HOVER} pre`);
    // ... function ... Platform.Response.Write(content: string): void
    const declared = coloured(signature);
    assert.match(signature.textContent, /Platform\.Response\.Write\(content: string\): void$/);
    assert.equal(declared.function, 'cm-keyword');
    // in a declaration the whole dotted name is the function's name, dots included
    assert.equal(declared.Platform, 'cm-sfmc-function');
    assert.equal(declared.Response, 'cm-sfmc-function');
    assert.equal(declared.Write, 'cm-sfmc-function');
    assert.equal(declared['.'], 'cm-sfmc-function');
    assert.match(declared.content, /^cm-(?:variable|def)/);
    assert.equal(declared.string, 'cm-type');
    assert.equal(declared.void, 'cm-type');
    // in the example only what is called is a function; the objects in front of it are not
    const called = coloured(example);
    assert.equal(called.Write, 'cm-sfmc-function');
    assert.equal(called.Stringify, 'cm-sfmc-function');
    assert.notEqual(called.Platform, 'cm-sfmc-function');
    assert.equal(called.var, 'cm-keyword');
    assert.match(called['"Jane"'], /cm-string/);

    const css = read('../dist/extension/editor-highlight.css');
    assert.match(css, /html \.sfmc-tooltip pre \{[^}]*border: 0;[^}]*background: none;/);
    assert.match(css, /html \.sfmc-tooltip code \{[^}]*background: var\(--sfmc-code-background\)/);
});

test('hover: the box stays while the mouse is on it and goes when it leaves', async () => {
    const context = page();
    const editor = addEditor(context, '%%[ set @a = Lookup("a", "b", "c", 1) ]%%');
    runExtension(context.window);
    const { document, MouseEvent } = context.window;
    rest(context, editor, 'set @a = Look');
    await hoverPause();
    const box = document.querySelector(HOVER);
    editor.getWrapperElement().dispatchEvent(new MouseEvent('mouseleave'));
    box.dispatchEvent(new MouseEvent('mouseenter'));
    await hoverPause();
    assert.equal(document.querySelector(HOVER), box);
    box.dispatchEvent(new MouseEvent('mouseleave'));
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null);
});

const SIGNATURE = '.sfmc-signature';

/**
 * Adds a focused editor and lets the extension react to its cursor. jsdom has no layout and no
 * real focus, so the editor is told both.
 *
 * @param {object} context page from `page()`
 * @param {string} content editor content; a "|" marks the cursor
 * @returns {Promise.<{editor: object, box: () => Element | null, moveTo: (before: string) => Promise.<void>}>} the editor, the box of the parameter help and a way to move the cursor behind some text
 */
async function withCursor(context, content) {
    const editor = addEditor(context, content);
    editor.hasFocus = () => true;
    editor.cursorCoords = () => ({ left: 10, right: 10, top: 100, bottom: 115 });
    runExtension(context.window);
    const moveTo = async (before) => {
        editor.setCursor(editor.posFromIndex(editor.getValue().indexOf(before) + before.length));
        await pause();
    };
    // the cursor is "moved" to where it is, which tells the listeners about it
    context.CodeMirror.signal(editor, 'cursorActivity', editor);
    await pause();
    return { editor, box: () => context.window.document.querySelector(SIGNATURE), moveTo };
}

test('parameter help shows the AMPscript function and marks the parameter being typed', async () => {
    const context = page();
    const { box, moveTo } = await withCursor(context, '%%[ set @a = Lookup("de", |"field") ]%%');
    assert.equal(box().parentNode, context.window.document.body);
    assert.match(
        box().querySelector('pre').textContent,
        /^Lookup\(dataObject: string, returnColumn/,
    );
    assert.equal(box().querySelector('strong').textContent, 'returnColumn: string');
    assert.match(box().querySelector('p').textContent, /column to return/);
    await moveTo('Lookup("');
    assert.equal(box().querySelector('strong').textContent, 'dataObject: string');
    await moveTo('"field")');
    assert.equal(box(), null, 'gone outside the call');
    await moveTo('%%[ set');
    assert.equal(box(), null);
});

test('parameter help: SSJS by its full name only, nothing in browser scripts or unfocused', async () => {
    const context = page();
    const ssjs = await withCursor(
        context,
        '<p>(</p><script runat="server">\nvar a = Platform.Function.Lookup("de", |"f");\n' +
            'var b = other.Lookup("de", "f");\nfunction add(first, second) {}\nadd(1, 2);\n</script>',
    );
    assert.match(ssjs.box().querySelector('pre').textContent, /^Platform\.Function\.Lookup\(/);
    assert.equal(ssjs.box().querySelector('strong').textContent, 'returnField');
    await ssjs.moveTo('other.Lookup("de", ');
    assert.equal(ssjs.box(), null, 'a method of something else is not the Platform function');
    await ssjs.moveTo('add(1, ');
    assert.equal(ssjs.box().querySelector('strong').textContent, 'second');
    context.CodeMirror.signal(ssjs.editor, 'blur', ssjs.editor);
    assert.equal(ssjs.box(), null, 'gone when the editor loses the focus');

    const other = page();
    const browser = await withCursor(other, '<script>\nvar a = Lookup("de", |"f");\n</script>');
    assert.equal(browser.box(), null);
    const idle = addEditor(other, '%%[ set @a = Lookup("de", |"field") ]%%');
    await pause();
    other.CodeMirror.signal(idle, 'cursorActivity', idle);
    await pause();
    assert.equal(browser.box(), null, 'an editor without the focus shows nothing');
});

test('parameter help closes on Escape and lets the key go on', async () => {
    const context = page();
    const { editor, box } = await withCursor(context, '%%[ set @a = Lookup("de", |"field") ]%%');
    assert.ok(box());
    const keyMap = editor.state.keyMaps.find((map) => 'Esc' in map);
    assert.equal(keyMap.Esc(editor), context.CodeMirror.Pass);
    assert.equal(box(), null);
});

const checkPause = () => new Promise((resolve) => setTimeout(resolve, 650));

/**
 * Lists what is underlined in an editor.
 *
 * @param {object} editor CodeMirror instance
 * @returns {string[]} kind of underline and underlined text, in document order
 */
function underlined(editor) {
    // copied, because an array of the page is never deep-equal to one of the test
    return [...editor.getAllMarks()]
        .filter((mark) => mark.className?.includes('sfmc-diagnostic'))
        .map((mark) => {
            const { from, to } = mark.find();
            return `${mark.className.split('sfmc-diagnostic-', 2)[1]}: ${editor.getRange(from, to)}`;
        })
        .toSorted((a, b) => a.localeCompare(b));
}

test('underlines errors and warnings in AMPscript and SSJS, and not in browser scripts', async () => {
    const context = page();
    const editor = addEditor(
        context,
        '%%[ if @a == 1 then ]%%<p>%%=Lookupx("a")=%%</p>\n' +
            '<script runat="server">\nlet x = 1;\n</script>\n' +
            '<script>\nlet y = Lookupx("a");\n</script>',
    );
    const clean = addEditor(context, '<p>%%=Lowercase("A")=%%</p>');
    runExtension(context.window);
    assert.deepEqual(underlined(editor), [], 'checked after a pause');
    await checkPause();
    const line = '%%[ if @a == 1 then ]%%<p>%%=Lookupx("a")=%%</p>';
    assert.deepEqual(underlined(editor), ['error: let ', 'error: Lookupx', `warning: ${line}`]);
    assert.deepEqual(underlined(clean), []);

    editor.replaceRange('Lookup("a", "b", "c", 1)', { line: 0, ch: 29 }, { line: 0, ch: 41 });
    await checkPause();
    assert.deepEqual(underlined(editor), [
        'error: let ',
        'warning: %%[ if @a == 1 then ]%%<p>%%=Lookup("a", "b", "c", 1)=%%</p>',
    ]);
    editor.setOption('mode', 'htmlmixed');
    await checkPause();
    assert.deepEqual(underlined(editor), [], 'none once the editor is used for something else');
});

/**
 * Adds an editor inside the element Content Builder puts around what it edits, marked with the
 * type of that content.
 *
 * @param {object} context page from `page()`
 * @param {string} types the type that is edited and the types above it
 * @param {string} content editor content
 * @param {Element} [parent] where the element goes; the page if left out
 * @returns {{editor: object, around: Element}} the editor and the element around it
 */
function inTypedEditor(context, types, content, parent) {
    const { document } = context.window;
    const around = document.createElement('div');
    around.className = `cloud-editor ${types
        .split(' ')
        .map((type) => `editor-mode-${type}`)
        .join(' ')}`;
    (parent ?? document.body).append(around);
    const editor = addEditor(context, content);
    around.append(editor.getWrapperElement());
    return { editor, around };
}

test('a script for the browser is an error in an email and an email template, a warning in a content block, and fine in CloudPages', async () => {
    const context = page();
    const content =
        '<SCRIPT type="text/javascript">var a = 1;</SCRIPT>\n' +
        '<script runat="server">var b = 1;</script>\n' +
        '<script runat="server" language="ampscript">set @c = 1</script>\n' +
        '<script runat="SERVER" type="module">var d = 1;</script>\n' +
        '<script type="application/ld+json">{}</script>\n' +
        '<!-- <script>var e;</script> -->';
    const email = inTypedEditor(context, 'htmlemail message asset', content);
    const template = inTypedEditor(context, 'template asset', '<script>var a;</script>');
    const block = inTypedEditor(context, 'codesnippetblock block asset', '<script>var a;</script>');
    const landingPage = inTypedEditor(context, 'webpage asset', '<script>var a;</script>');
    const plain = addEditor(context, '<script>var a;</script>');
    // a block that is edited inside an email is part of the email; one inside a landing page is not flagged
    const inEmail = inTypedEditor(
        context,
        'htmlblock block asset',
        '<script>var a;</script>',
        email.around,
    );
    const inPage = inTypedEditor(
        context,
        'htmlblock block asset',
        '<script>var a;</script>',
        landingPage.around,
    );
    runExtension(context.window);
    await checkPause();
    // the opening tag of each script that does not run on the server, whatever its case and type
    assert.deepEqual(underlined(email.editor), [
        'error: <script type="application/ld+json">',
        'error: <SCRIPT type="text/javascript">',
    ]);
    assert.deepEqual(underlined(template.editor), ['error: <script>']);
    assert.deepEqual(underlined(block.editor), ['warning: <script>']);
    assert.deepEqual(underlined(inEmail.editor), ['error: <script>']);
    assert.deepEqual(underlined(landingPage.editor), []);
    assert.deepEqual(underlined(inPage.editor), []);
    assert.deepEqual(underlined(plain), []);

    // the box says what happens, names the rule with its page, and offers no fix
    rest(context, block.editor, '<scr');
    await hoverPause();
    const box = context.window.document.querySelector(HOVER);
    assert.match(box.textContent, /removes this <script> when you save the block/);
    assert.match(box.textContent, /the editor may still show the tag/);
    assert.match(box.textContent, /runat="server" is missing in the tag/);
    const rule = box.querySelector('.sfmc-problem-rule');
    assert.match(rule.textContent, /script-removed-on-save/);
    assert.equal(rule.href, 'https://sfmc.guide/engagement/code-persistence/');
    assert.equal(box.querySelector('.sfmc-fix'), null);
    rest(context, email.editor, '<SCR');
    await hoverPause();
    assert.match(
        [...context.window.document.querySelectorAll(HOVER)].at(-1).textContent,
        /emails and email templates keep no JavaScript for the browser/,
    );

    // what the page says about the content only later is taken up with the next check
    landingPage.around.classList.replace('editor-mode-webpage', 'editor-mode-message');
    landingPage.editor.replaceRange(' ', { line: 0, ch: 0 });
    await checkPause();
    assert.deepEqual(underlined(landingPage.editor), ['error: <script>']);
});

test('many problems in the AMPscript do not hide those in the SSJS', async () => {
    const context = page();
    // more unknown functions than the AMPscript check reports at most
    const calls = Array.from({ length: 150 }, (unused, index) => `set @a = Unknown${index}("x")`);
    const editor = addEditor(
        context,
        `<script runat="server">var a = [1].map(String);</script>\n%%[\n${calls.join('\n')}\n]%%`,
    );
    runExtension(context.window);
    await checkPause();
    const marks = underlined(editor);
    assert.ok(marks.filter((mark) => mark.startsWith('error: Unknown')).length >= 100);
    assert.ok(marks.includes('error: map'), 'the SSJS finding is still underlined');
});

test('resting the mouse on an underline says what is wrong, before the documentation', async () => {
    const context = page();
    const editor = addEditor(
        context,
        '%%[ set @a = Lookup("a") ]%%\n<script runat="server">let x;</script>',
    );
    runExtension(context.window);
    await checkPause();
    const { document } = context.window;
    rest(context, editor, 'set @a = Look');
    await hoverPause();
    const box = document.querySelector(HOVER);
    const problem = box.querySelector('.sfmc-problem');
    // after the extension's icon, which says under the mouse what the extension added
    const icon = box.firstChild;
    assert.equal(icon.className, 'sfmc-tooltip-icon');
    assert.equal(icon.getAttribute('role'), 'img');
    assert.equal(
        icon.title,
        'SFMC UX Tools: added this box, which explains the code under the mouse.',
    );
    assert.equal(icon.getAttribute('aria-label'), icon.title);
    assert.equal(icon.nextSibling, problem);
    assert.ok(problem.classList.contains('sfmc-problem-error'));
    assert.match(problem.textContent, /Lookup/);
    assert.match(problem.querySelector('a.sfmc-problem-rule').href, /^https:\/\//);
    assert.match(box.querySelector('pre').textContent, /^\(function\) Lookup\(/);

    rest(context, editor, '<script runat="server">l');
    await hoverPause();
    const other = document.querySelector(HOVER);
    assert.match(other.querySelector('.sfmc-problem').textContent, /not supported in SFMC SSJS/);
    assert.equal(other.querySelector('pre'), null, 'a problem alone is shown too');
});

const NOTICE = '.sfmc-notice';
const formatPause = () => new Promise((resolve) => setTimeout(resolve, 1000));

/**
 * Presses Shift-Alt-F the way CodeMirror would: through the key map the extension registered.
 *
 * @param {object} editor CodeMirror instance
 * @returns {unknown} what the key binding returned
 */
function pressFormat(editor) {
    const keyMap = editor.state.keyMaps.find((map) => 'Shift-Alt-F' in map);
    assert.ok(keyMap, 'Shift-Alt-F is bound');
    return keyMap['Shift-Alt-F'](editor);
}

test('Shift-Alt-F formats AMPscript, SSJS, HTML and CSS in one step that can be undone', async () => {
    const context = page();
    const messy =
        '<p>%%=Lookup("a","b","c",@d)=%%</p>\n%%[ set @a=1 if @a==1 then set @b = 2 endif ]%%\n' +
        '<style>a{color:red}</style>\n<script runat="server">\nvar a=Platform.Function.Lookup("a","b","c",1);if(a){Write(a)}\n</script>';
    const editor = addEditor(context, messy);
    editor.setCursor({ line: 0, ch: 2 });
    runExtension(context.window);
    assert.equal(pressFormat(editor), undefined);
    assert.equal(editor.getValue(), messy, 'formatting takes a moment');
    await formatPause();
    assert.equal(
        editor.getValue(),
        [
            "<p>%%= Lookup('a', 'b', 'c', @d) =%%</p>",
            '%%[',
            '    set @a = 1',
            '    if @a == 1 then',
            '        set @b = 2',
            '    endif',
            ']%%',
            '<style>',
            '    a {',
            '        color: red;',
            '    }',
            '</style>',
            '<script runat="server">',
            "    var a = Platform.Function.Lookup('a', 'b', 'c', 1);",
            '    if (a) {',
            '        Write(a);',
            '    }',
            '</script>',
        ].join('\n'),
    );
    assert.deepEqual({ ...editor.getCursor() }.line, 0);
    assert.equal(editor.getCursor().ch, 2, 'the cursor stays in front of what changed');
    editor.undo();
    assert.equal(editor.getValue(), messy);
    assert.equal(context.window.document.querySelector(NOTICE), null);
});

test('formatting leaves read-only editors, later edits and broken content alone', async () => {
    const context = page();
    const locked = addEditor(context, '%%[ set @a=1 ]%%');
    locked.setOption('readOnly', true);
    const edited = addEditor(context, '%%[ set @a=1 ]%%');
    // Prettier and the plugin put up with any content; an editor that hands out something else
    // than text stands in for a failure
    const broken = addEditor(context, '%%[ set @a=1 ]%%');
    const getValue = broken.getValue.bind(broken);
    broken.getValue = () => 5;
    runExtension(context.window);
    assert.equal(pressFormat(locked), context.CodeMirror.Pass);
    pressFormat(edited);
    edited.replaceRange('<p>x</p>', { line: 0, ch: 0 });
    pressFormat(broken);
    await formatPause();
    assert.equal(locked.getValue(), '%%[ set @a=1 ]%%');
    assert.equal(edited.getValue(), '<p>x</p>%%[ set @a=1 ]%%', 'what was typed meanwhile stays');
    assert.equal(getValue(), '%%[ set @a=1 ]%%');
    const notice = context.window.document.querySelector(NOTICE);
    assert.match(notice.textContent, /^Not formatted: /);
    // its icon says under the mouse what the extension added
    assert.equal(notice.firstChild.className, 'sfmc-tooltip-icon');
    assert.equal(
        notice.firstChild.title,
        'SFMC UX Tools: added this note, which says why the code was not formatted.',
    );
});

const FORMAT_BUTTON = '.sfmc-format-button';
const ON_SAVE = 'data-sfmc-ux-tools-format-on-save';

/**
 * Adds an editor inside the frame Marketing Cloud gives its code editor: a toolbar above it,
 * and a Save button elsewhere on the page.
 *
 * @param {object} context page from `page()`
 * @returns {{editor: object, toolbar: Element, saveButton: Element, saves: string[]}} the editor, its toolbar, the page's Save button and the content at each save the page got to see
 */
function inFrame(context) {
    const { document } = context.window;
    const frame = document.createElement('div');
    frame.className = 'et-codemirror';
    frame.innerHTML =
        '<div class="et-codemirror-toolbar"><ul><li class="toolbar-button"></li></ul></div>' +
        '<div class="et-codemirror-bin"></div>';
    document.body.append(frame);
    const editor = new context.CodeMirror(frame.querySelector('.et-codemirror-bin'), {
        value: '%%[ set @a=1 ]%%',
        mode: BASE_MODE,
    });
    const saveButton = document.createElement('span');
    saveButton.dataset.action = 'editor-save';
    // jsdom has no layout; what is "on show" is what has boxes
    saveButton.getClientRects = () => [{}];
    editor.getWrapperElement().getClientRects = () => [{}];
    document.body.append(saveButton);
    const saves = [];
    saveButton.addEventListener('click', () => {
        saves.push(editor.getValue());
    });
    return { editor, toolbar: frame.querySelector('ul'), saveButton, saves };
}

test('the format button sits in the editor toolbar, names its shortcut and formats', async () => {
    const context = page();
    const { editor, toolbar } = inFrame(context);
    const plain = addEditor(context, '%%[ set @a=1 ]%%');
    runExtension(context.window);
    const button = toolbar.querySelector(`li.toolbar-button > ${FORMAT_BUTTON}`);
    assert.equal(toolbar.querySelectorAll(FORMAT_BUTTON).length, 1);
    assert.equal(button.title, 'Format code (Shift+Alt+F)');
    assert.equal(button.getAttribute('aria-label'), button.title);
    assert.equal(button.type, 'button');
    button.click();
    await formatPause();
    assert.equal(editor.getValue(), '%%[\n    set @a = 1\n]%%');
    // without a toolbar the button floats in the corner of the editor
    const floating = plain.getWrapperElement().querySelector(FORMAT_BUTTON);
    assert.ok(floating.classList.contains('sfmc-format-floating'));
    floating.click();
    await formatPause();
    assert.equal(plain.getValue(), '%%[\n    set @a = 1\n]%%');
    const css = read('../dist/extension/editor-highlight.css');
    assert.ok(css.includes('.sfmc-format-button {'));
    // the button hands the focus back to the editor, whose blinking cursor would keep the test run alive
    context.window.close();
});

test('Ctrl-S and Cmd-S save through the Save button of the page, unformatted by default', async () => {
    const context = page();
    const { editor, saves } = inFrame(context);
    runExtension(context.window);
    const keyMap = editor.state.keyMaps.find((map) => 'Ctrl-S' in map);
    assert.equal(keyMap['Ctrl-S'](editor), undefined);
    assert.equal(keyMap['Cmd-S'](editor), undefined);
    assert.deepEqual(saves, ['%%[ set @a=1 ]%%', '%%[ set @a=1 ]%%']);
    await formatPause();
    assert.equal(editor.getValue(), '%%[ set @a=1 ]%%');

    const other = page();
    const lonely = addEditor(other, '%%[ set @a=1 ]%%');
    runExtension(other.window);
    const lonelyKeys = lonely.state.keyMaps.find((map) => 'Ctrl-S' in map);
    assert.equal(
        lonelyKeys['Ctrl-S'](lonely),
        other.CodeMirror.Pass,
        'no Save button: the key goes on',
    );
});

test('format on save: the save waits for the formatting, and happens exactly once', async () => {
    const context = page();
    const { editor, saveButton, saves } = inFrame(context);
    const { document } = context.window;
    const exit = document.createElement('a');
    exit.dataset.action = 'editor-save-exit';
    document.body.append(exit);
    const exits = [];
    exit.addEventListener('click', () => {
        exits.push(editor.getValue());
    });
    runExtension(context.window);
    document.documentElement.setAttribute(ON_SAVE, 'on');

    saveButton.click();
    assert.deepEqual(saves, [], 'held back until the code is formatted');
    await formatPause();
    assert.deepEqual(saves, ['%%[\n    set @a = 1\n]%%']);

    editor.setValue('%%[ set @b=2 ]%%');
    editor.state.keyMaps.find((map) => 'Ctrl-S' in map)['Ctrl-S'](editor);
    await formatPause();
    assert.deepEqual(saves.slice(1), ['%%[\n    set @b = 2\n]%%']);

    editor.setValue('%%[ set @c=3 ]%%');
    exit.click();
    await formatPause();
    assert.deepEqual(exits, ['%%[\n    set @c = 3\n]%%']);

    // more clicks while a save is held back do not become more saves
    editor.setValue('%%[ set @e=5 ]%%');
    saveButton.click();
    saveButton.click();
    exit.click();
    await formatPause();
    assert.deepEqual(saves.slice(2), ['%%[\n    set @e = 5\n]%%']);
    assert.equal(exits.length, 1);
    saves.pop();

    // a button the page has redrawn meanwhile is found again
    editor.setValue('%%[ set @f=6 ]%%');
    saveButton.click();
    const redrawn = saveButton.cloneNode(true);
    redrawn.getClientRects = () => [{}];
    let redrawnSaves = 0;
    redrawn.addEventListener('click', () => {
        redrawnSaves++;
    });
    saveButton.replaceWith(redrawn);
    await formatPause();
    assert.equal(redrawnSaves, 1);
    redrawn.replaceWith(saveButton);

    // editors of hidden views are neither formatted nor a reason to wait
    const hidden = addEditor(context, '%%[ set @h=1 ]%%');
    await pause();
    editor.setValue('%%[ set @g=7 ]%%');
    saveButton.click();
    await formatPause();
    assert.equal(hidden.getValue(), '%%[ set @h=1 ]%%');
    assert.equal(saves.pop(), '%%[\n    set @g = 7\n]%%');

    // switched off again, and editors that cannot be formatted, never hold a save back
    document.documentElement.setAttribute(ON_SAVE, 'off');
    editor.setValue('%%[ set @d=4 ]%%');
    saveButton.click();
    assert.equal(saves.at(-1), '%%[ set @d=4 ]%%');
    document.documentElement.setAttribute(ON_SAVE, 'on');
    editor.setOption('readOnly', true);
    saveButton.click();
    assert.equal(saves.length, 4);
    assert.equal(saves.at(-1), '%%[ set @d=4 ]%%');
});

test('format on save leaves an editor that was taken off the page alone, and formats it again once it is back', async () => {
    const context = page();
    const { editor, saveButton, saves } = inFrame(context);
    runExtension(context.window);
    context.window.document.documentElement.setAttribute(ON_SAVE, 'on');
    const wrapper = editor.getWrapperElement();
    const holder = wrapper.parentElement;

    // off the page: the save is not held back for it, and its content stays as it is
    wrapper.remove();
    saveButton.click();
    assert.deepEqual(saves, ['%%[ set @a=1 ]%%']);
    await formatPause();
    assert.equal(editor.getValue(), '%%[ set @a=1 ]%%');

    // back on the page: it is still one of the editors to format
    holder.append(wrapper);
    saveButton.click();
    await formatPause();
    assert.deepEqual(saves.slice(1), ['%%[\n    set @a = 1\n]%%']);
});

/**
 * Makes a page behave like Content Builder: it saves what it took over from the editor, takes a
 * change over only when told to, and says that it has through its jQuery.
 *
 * @param {object} context page from `page()`
 * @returns {{editor: object, saveButton: Element, saves: string[], takeOver: () => void}} the editor, the page's Save button, what the page saved at each save, and what makes the page take the content over
 */
function inContentBuilder(context) {
    const { window } = context;
    const { document } = window;
    const heard = [];
    window.jQuery = () => ({
        on: (name, handler) => {
            heard.push({ name, handler });
        },
    });
    const { editor, saveButton } = inFrame(context);
    const around = document.createElement('div');
    around.className = 'cb-editor';
    document.querySelector('.et-codemirror').replaceWith(around);
    around.append(editor.getWrapperElement().closest('.et-codemirror'));
    let model = editor.getValue();
    const saves = [];
    saveButton.addEventListener('click', () => {
        saves.push(model);
    });
    const takeOver = () => {
        model = editor.getValue();
        for (const { name, handler } of heard) {
            if (name === 'cloudeditor:change') {
                handler({ target: around });
            }
        }
    };
    return { editor, saveButton, saves, takeOver };
}

test('Content Builder saves what it took over from the editor: a save waits until it has taken over what the editor shows', async () => {
    const context = page();
    const { editor, saveButton, saves, takeOver } = inContentBuilder(context);
    runExtension(context.window);
    const { document } = context.window;
    const ctrlS = () => editor.state.keyMaps.find((map) => 'Ctrl-S' in map)['Ctrl-S'](editor);

    // format on save: the formatted code is saved, not the code from before
    document.documentElement.setAttribute(ON_SAVE, 'on');
    saveButton.click();
    await formatPause();
    assert.equal(editor.getValue(), '%%[\n    set @a = 1\n]%%');
    assert.deepEqual(saves, [], 'the page has not taken the formatted code over yet');
    takeOver();
    await pause();
    assert.deepEqual(saves, ['%%[\n    set @a = 1\n]%%']);

    // nothing to format and nothing the page has yet to take over: the save is not held up
    saveButton.click();
    await formatPause();
    assert.equal(saves.length, 2);

    // Ctrl-S right after typing, without format on save: not a save without the last words
    document.documentElement.setAttribute(ON_SAVE, 'off');
    editor.replaceRange('x', { line: 0, ch: 0 });
    assert.equal(ctrlS(), undefined);
    assert.equal(saves.length, 2, 'held back until the page has what was typed');
    takeOver();
    await pause();
    assert.equal(saves.at(-1), 'x%%[\n    set @a = 1\n]%%');
    assert.equal(saves.length, 3);
    // and at once where the page has everything
    ctrlS();
    assert.equal(saves.length, 4);

    // a page that stays silent does not lose the save, and is not waited for a second time
    editor.replaceRange('y', { line: 0, ch: 0 });
    ctrlS();
    await new Promise((resolve) => setTimeout(resolve, 3200));
    assert.equal(saves.length, 5);
    ctrlS();
    assert.equal(saves.length, 6);
});

test('the format-on-save setting reaches the page, off by default', async () => {
    const script = read('../src/editor-format-setting.js');
    const run = (stored) => {
        const { window } = new JSDOM('<!doctype html><body></body>', {
            runScripts: 'outside-only',
        });
        const listeners = [];
        window.chrome = {
            storage: {
                sync: { get: (defaults) => Promise.resolve({ ...defaults, ...stored }) },
                onChanged: {
                    addListener: (listener) => {
                        listeners.push(listener);
                    },
                },
            },
        };
        window.eval(script);
        return {
            value: () => window.document.documentElement.getAttribute(ON_SAVE),
            change: (newValue) => {
                for (const listener of listeners) {
                    listener({ editorFormatOnSave: { newValue } }, 'sync');
                }
            },
        };
    };
    const fresh = run({});
    const saved = run({ editorFormatOnSave: 'on' });
    assert.equal(fresh.value(), 'off');
    await pause();
    assert.equal(fresh.value(), 'off');
    assert.equal(saved.value(), 'on');
    saved.change('off');
    assert.equal(saved.value(), 'off');
    saved.change('anything');
    assert.equal(saved.value(), 'off');

    const options = new JSDOM(read('../src/options.html')).window.document;
    assert.deepEqual(
        [...options.querySelectorAll('input[name="editorFormatOnSave"]')].map(
            (input) => input.value,
        ),
        ['off', 'on'],
    );
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entry = manifest.content_scripts.find((item) =>
        item.js.includes('editor-format-setting.js'),
    );
    assert.equal(entry.world, undefined);
    assert.equal(entry.run_at, 'document_start');
});

const FIX = '.sfmc-fix';

test('quick fixes: the box of a problem offers them, and a click applies one in a single step', async () => {
    const context = page();
    const editor = addEditor(
        context,
        '<p>%%=v(@a)=%%</p>\n<script runat="server">\nvar a = [1].map(function (b) { return b; });\n</script>',
    );
    runExtension(context.window);
    await checkPause();
    const { document } = context.window;
    rest(context, editor, 'var a = [1].m');
    await hoverPause();
    const buttons = [...document.querySelectorAll(`${HOVER} .sfmc-problem ${FIX}`)];
    assert.ok(buttons.length > 0, 'the polyfill is on offer');
    assert.match(buttons[0].textContent, /polyfill/i);
    const before = editor.getValue();
    buttons[0].click();
    const after = editor.getValue();
    assert.equal(document.querySelector(HOVER), null, 'the box closes');
    assert.match(after, /Array\.prototype\.map = Array\.prototype\.map \|\|/);
    assert.ok(
        after.startsWith('<p>%%=v(@a)=%%</p>\n<script runat="server">'),
        'added inside the script, not at the top of the HTML',
    );
    assert.ok(after.includes('var a = [1].map(function (b) { return b; });'));
    editor.undo();
    assert.equal(editor.getValue(), before);
    context.window.close();
});

test('quick fixes: a polyfill for a one-line script stays inside the script, and stale fixes do nothing', async () => {
    const context = page();
    const content =
        '<script runat="server">Platform.Load("core", "1.1.5"); var a = [1].map(String);</script>';
    const editor = addEditor(context, content);
    runExtension(context.window);
    await checkPause();
    const { document } = context.window;
    rest(context, editor, 'var a = [1].m');
    await hoverPause();
    document.querySelector(`${HOVER} ${FIX}`).click();
    const fixed = editor.getValue();
    assert.match(fixed, /Array\.prototype\.map = Array\.prototype\.map \|\|/);
    assert.ok(fixed.startsWith('<script runat="server">'), fixed);
    assert.ok(
        fixed.endsWith('Platform.Load("core", "1.1.5"); var a = [1].map(String);</script>'),
        'the code itself is untouched',
    );

    // a box that is still open when the editor gets another document must not change that one
    editor.undo();
    rest(context, editor, 'var a = [1].m');
    await hoverPause();
    const stale = document.querySelector(`${HOVER} ${FIX}`);
    const other = context.CodeMirror.Doc('<p>another asset</p>', BASE_MODE);
    editor.swapDoc(other);
    assert.equal(document.querySelector(HOVER), null);
    stale.click();
    assert.equal(editor.getValue(), '<p>another asset</p>');
    context.window.close();
});

test('the content is only checked again after it changed', async () => {
    const context = page();
    const editor = addEditor(context, '%%[ set @a = Lookupx("a") ]%%');
    runExtension(context.window);
    await checkPause();
    const marks = [...editor.getAllMarks()];
    assert.equal(marks.length, 1);
    rest(context, editor, 'set @a = Look');
    await hoverPause();
    assert.equal(
        editor.getAllMarks()[0],
        marks[0],
        'resting the mouse leaves the underlines as they are',
    );
    editor.replaceRange(' ', { line: 0, ch: 3 });
    rest(context, editor, 'set @a = Look');
    await hoverPause();
    assert.notEqual(editor.getAllMarks()[0], marks[0]);
    assert.equal(editor.getAllMarks().length, 1);
});

test('quick fixes: Ctrl-. opens them at the cursor, for the text as it is now', async () => {
    const context = page();
    const editor = addEditor(context, '<script runat="server">\nvar a = 1;\n</script>');
    editor.charCoords = () => ({ left: 10, right: 20, top: 100, bottom: 115 });
    runExtension(context.window);
    await checkPause();
    const { document } = context.window;
    const keys = editor.state.keyMaps.find((map) => 'Ctrl-.' in map);
    assert.equal(typeof keys['Cmd-.'], 'function');
    editor.setCursor({ line: 1, ch: 3 });
    assert.equal(
        keys['Ctrl-.'](editor),
        context.CodeMirror.Pass,
        'nothing to fix: the key goes on',
    );
    assert.equal(document.querySelector(HOVER), null);

    // typed just now; the check that runs when typing pauses has not happened yet
    editor.replaceRange('var b = [1].map(String);\n', { line: 1, ch: 0 });
    editor.setCursor({ line: 1, ch: 14 });
    assert.equal(keys['Ctrl-.'](editor), undefined);
    const button = document.querySelector(`${HOVER} ${FIX}`);
    assert.ok(button);
    assert.equal(document.activeElement, button, 'ready for Enter');
    assert.equal(document.querySelector(`${HOVER} pre`), null, 'fixes only, no documentation');
    // Escape closes the box and is used up by that: nothing around the box gets the key
    let reached = 0;
    document.body.addEventListener('keydown', () => reached++);
    const escape = new context.window.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
    });
    button.dispatchEvent(escape);
    assert.equal(document.querySelector(HOVER), null);
    assert.equal(escape.defaultPrevented, true);
    assert.equal(reached, 0);

    editor.setOption('readOnly', true);
    assert.equal(keys['Ctrl-.'](editor), context.CodeMirror.Pass);
    // a read-only editor still explains the problem, but offers no fix
    rest(context, editor, 'var b = [1].m');
    await hoverPause();
    assert.ok(document.querySelector(`${HOVER} .sfmc-problem`));
    assert.equal(document.querySelector(`${HOVER} ${FIX}`), null);
    context.window.close();
});

const CTRL = { ctrlKey: true };

/**
 * Presses the mouse button on a character of an editor.
 *
 * @param {object} context page from `page()`
 * @param {object} editor CodeMirror instance
 * @param {string} before text that ends right before the character
 * @param {object} keys modifier keys that are held
 * @returns {boolean} false if the click was taken away from the editor
 */
function wasLeftToEditor(context, editor, before, keys) {
    const place = editor.posFromIndex(editor.getValue().indexOf(before) + before.length);
    editor.coordsChar = () => ({ line: place.line, ch: place.ch + 1, xRel: -1 });
    return editor.getWrapperElement().dispatchEvent(
        new context.window.MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            ...keys,
        }),
    );
}

test('Ctrl-click on the name of a function of the content goes to its declaration', () => {
    const context = page();
    const content =
        '<p>greet</p>\n<script runat="server">\nfunction greet(name) { return name; }\n' +
        'var a = greet("x");\nvar b = other.greet("y");\nvar c = Stringify(a);\n</script>\n' +
        '<script>\nvar d = greet("z");\n</script>';
    const editor = addEditor(context, content);
    editor.setCursor({ line: 0, ch: 0 });
    runExtension(context.window);
    const cursor = () => ({ line: editor.getCursor().line, ch: editor.getCursor().ch });

    assert.equal(
        wasLeftToEditor(context, editor, 'var a = gr', CTRL),
        false,
        'taken from the editor',
    );
    assert.deepEqual(cursor(), { line: 2, ch: 9 });

    editor.setCursor({ line: 0, ch: 0 });
    assert.equal(
        wasLeftToEditor(context, editor, 'var a = gr', {}),
        true,
        "a plain click is the editor's",
    );
    assert.equal(
        wasLeftToEditor(context, editor, 'var a = gr', { ctrlKey: true, shiftKey: true }),
        true,
    );
    assert.equal(
        wasLeftToEditor(context, editor, 'other.gr', CTRL),
        true,
        'a member of something else',
    );
    assert.equal(
        wasLeftToEditor(context, editor, 'var c = Stri', CTRL),
        true,
        'not declared in the content',
    );
    assert.equal(wasLeftToEditor(context, editor, 'var d = gr', CTRL), true, 'a browser script');
    assert.equal(wasLeftToEditor(context, editor, '<p>gr', CTRL), true, 'plain text');
    assert.deepEqual(cursor(), { line: 0, ch: 0 });
    context.window.close();
});

test('the completion popup comes alone: documentation is for hovering, not for completing', () => {
    const context = page();
    const editor = addEditor(context, '%%[ var @count\nset @a = Look| ]%%');
    runExtension(context.window);
    pressCtrlSpace(editor);
    assert.ok(hints(editor).length > 0);
    const { document } = context.window;
    assert.equal(document.querySelectorAll('.sfmc-tooltip').length, 0);
    editor.state.completionActive.widget.changeActive(1);
    assert.equal(document.querySelectorAll('.sfmc-tooltip').length, 0);
});

test('sets up editors that are opened later, each one only once', async () => {
    const context = page();
    runExtension(context.window);
    const late = addEditor(context, '%%[ set @a = Loo| ]%%');
    const other = addEditor(context, '%%[ set @a = Loo| ]%%', 'htmlmixed');
    await pause();
    context.window.eval(completionsScript);
    await pause();
    assert.equal(late.state.keyMaps.filter((map) => 'Ctrl-Space' in map).length, 1);
    assert.equal(other.state.keyMaps.length, 0, 'editors with other modes are left alone');
    pressCtrlSpace(late);
    assert.ok(hints(late).length > 0);
});

test('a failing language service leaves the editor usable and is reported once', () => {
    const context = page();
    const editor = addEditor(context, '%%[ set @a = Loo| ]%%');
    runExtension(context.window);
    const reports = [];
    context.window.console.debug = (...parameters) => {
        reports.push(parameters);
    };
    // the language service splits the text into lines first; a failure there stands in for any other
    const split = context.window.String.prototype.split;
    context.window.String.prototype.split = () => {
        throw new Error('broken');
    };
    try {
        assert.doesNotThrow(() => pressCtrlSpace(editor));
        assert.doesNotThrow(() => pressCtrlSpace(editor));
    } finally {
        context.window.String.prototype.split = split;
    }
    assert.deepEqual(hints(editor), []);
    assert.equal(context.window.document.querySelector(POPUP), null);
    assert.equal(reports.length, 1);
    assert.equal(editor.getValue(), '%%[ set @a = Loo ]%%');
    editor.replaceSelection('k');
    assert.equal(editor.getValue(), '%%[ set @a = Look ]%%');
    pressCtrlSpace(editor);
    assert.ok(hints(editor).length > 0, 'works again once the language service does');
});

test('does nothing if the page has no hint addon, and passes the key on', async () => {
    const context = page({ hasShowHint: false });
    const editor = addEditor(context, '%%[ set @a = Loo| ]%%');
    runExtension(context.window);
    assert.equal(pressCtrlSpace(editor), context.CodeMirror.Pass);
    type(context, editor, 'k');
    await pause();
    assert.equal(editor.state.completionActive, undefined);
    assert.equal(editor.getValue(), '%%[ set @a = Look ]%%');
    assert.ok(editor.getLineTokens(0).some((token) => token.type === 'sfmc-keyword'));
});

test('the colouring works with and without the completions script', () => {
    const context = page();
    const editor = addEditor(context, '%%[ set @a = 1 ]%%');
    context.window.eval(dataScript);
    context.window.eval(highlightScript);
    context.window.eval('document.querySelectorAll = () => { throw new Error("broken"); };');
    assert.doesNotThrow(() => context.window.eval(completionsScript));
    assert.ok(editor.getLineTokens(0).some((token) => token.type === 'sfmc-keyword'));
});

test('the built extension is complete and its manifest references only existing files', () => {
    const manifest = JSON.parse(read('../dist/extension/manifest.json'));
    assert.deepEqual(manifest, JSON.parse(read('../src/manifest.json')));
    const files = [
        ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css ?? [])]),
        ...Object.values(manifest.icons),
    ];
    assert.ok(files.includes('editor-language.js'));
    assert.ok(files.includes('editor-format.js'));
    // loaded by the extension itself, so no content script names them
    files.push(manifest.background.service_worker, 'editor-typescript.js');
    for (const file of files) {
        assert.ok(
            existsSync(new URL(`../dist/extension/${file}`, import.meta.url)),
            `${file} is missing`,
        );
    }
    assert.equal(highlightScript, read('../src/editor-highlight.js'));
    assert.ok(
        !existsSync(new URL('../dist/extension/editor-language', import.meta.url)),
        'the sources of the bundle are not copied',
    );
});

test('the language bundle is one classic script without eval or new Function', () => {
    assert.deepEqual(findDynamicCode(completionsScript), []);
    assert.doesNotMatch(completionsScript, /^\s*(?:import|export)\s/m);
    assert.match(completionsScript, /includes sfmc-language-lsp \d+\.\d+\.\d+/);
    assert.deepEqual(findDynamicCode(formatScript), []);
    assert.doesNotMatch(formatScript, /^\s*(?:import|export)\s/m);
    assert.match(formatScript, /includes prettier-plugin-sfmc \d+\.\d+\.\d+/);
    assert.deepEqual(findDynamicCode(typescriptScript), []);
    assert.doesNotMatch(typescriptScript, /^\s*(?:import|export)\s/m);
    assert.match(typescriptScript, /includes typescript 6\.0\.3\./);
    // the check itself recognises both, and is not fooled by text that merely mentions them
    assert.deepEqual(findDynamicCode('var a = "eval(1) new Function"; // eval(2)'), []);
    assert.equal(findDynamicCode('eval("1"); var f = new Function("return 1");').length, 2);
});

test('the popup has styles of its own', () => {
    const css = read('../dist/extension/editor-highlight.css');
    for (const selector of ['.CodeMirror-hints', '.CodeMirror-hint', '.CodeMirror-hint-active']) {
        assert.ok(css.includes(selector + ' {'), selector);
    }
    assert.match(css, /\.CodeMirror-hints \{[^}]*z-index: \d{4,}/);
    assert.ok(css.includes('.sfmc-hint-detail'));
});

// --- with the TypeScript script, which the extension loads on demand ---

const TYPESCRIPT = Symbol.for('sfmcUxTools.typescript');
const WITH_TYPESCRIPT = { hasTypescript: true };
const SSJS_OPEN = '<p>%%=v(@a)=%%</p>\n<script runat="server">\n';
const NEED_TYPESCRIPT = 'sfmc-ux-tools:need-typescript';

test('TypeScript: offers the members of a value and replaces only what is typed of the name', async () => {
    const context = page();
    const editor = addEditor(
        context,
        SSJS_OPEN + 'var de = DataExtension.Init("x");\nde.Rows.|\n</script>',
    );
    runExtension(context.window, WITH_TYPESCRIPT);
    const service = context.window[TYPESCRIPT];
    assert.deepEqual(Object.keys(service), [
        'update',
        'completions',
        'hover',
        'signatureHelp',
        'definition',
        'diagnostics',
        'memberCompletions',
        'isInSsjsRegion',
    ]);
    let asked = 0;
    const { completions } = service;
    service.completions = (position) => {
        asked++;
        return completions(position);
    };
    pressCtrlSpace(editor);
    const labels = hints(editor).map((hint) => hint.displayText);
    assert.deepEqual(labels, ['Add', 'Lookup', 'Remove', 'Retrieve', 'Update']);
    // the key binding asks first and the popup asks again; TypeScript answers once
    assert.equal(asked, 1);
    editor.state.completionActive.close();

    // typing more of the member's name narrows the same answer down
    pressCtrlSpace(editor);
    type(context, editor, 'A');
    type(context, editor, 'd');
    await pause();
    assert.equal(asked, 1, 'the members are the same while the text up to the dot is');
    const completion = editor.state.completionActive;
    assert.deepEqual(
        hints(editor).map((hint) => hint.displayText),
        ['Add'],
    );
    completion.pick(completion.data, 0);
    assert.equal(editor.getLine(3), 'de.Rows.Add');

    // no member starts like this, so the catalogue gets its turn, which knows nothing here either
    editor.replaceRange('de.Rows.Xyz', { line: 3, ch: 0 }, { line: 3, ch: 11 });
    assert.equal(pressCtrlSpace(editor), context.CodeMirror.Pass);
    assert.equal(asked, 1);

    // other text in front of the dot is another question
    editor.replaceRange('var de = DataExtension.Init("y");', { line: 2, ch: 0 }, { line: 2 });
    editor.replaceRange('de.Rows.', { line: 3, ch: 0 }, { line: 3 });
    editor.setCursor({ line: 3, ch: 8 });
    pressCtrlSpace(editor);
    assert.equal(asked, 2);
    assert.equal(hints(editor).length, 5);
    editor.state.completionActive.close();

    // nothing is known about the members of this value, so nothing is offered, as before
    editor.replaceRange('unknownThing.', { line: 3, ch: 0 }, { line: 3 });
    editor.setCursor({ line: 3, ch: 13 });
    assert.equal(pressCtrlSpace(editor), context.CodeMirror.Pass);
    context.window.close();
});

test('TypeScript: members that the catalogue knows keep its description and brackets', () => {
    const typed = inSsjs(page(), 'var a = Platform.Function.Loo|', WITH_TYPESCRIPT);
    const { document } = typed.editor.getWrapperElement().ownerDocument.defaultView;
    assert.deepEqual(typed.labels, ['Lookup', 'LookupOrderedRows', 'LookupRows']);
    const entry = document.querySelector(POPUP).firstChild;
    assert.match(entry.querySelector('.sfmc-hint-detail').textContent, /^deName, returnField/);
    typed.pick('Lookup');
    assert.equal(typed.editor.getLine(2), 'var a = Platform.Function.Lookup(');

    // names that are not members stay with the catalogue
    const top = inSsjs(page(), 'var a = looku|', WITH_TYPESCRIPT);
    assert.ok(top.labels.includes('Platform.Function.Lookup'), top.labels.join(' | '));
    top.pick('Platform.Function.LookupRows');
    assert.equal(top.editor.getLine(2), 'var a = Platform.Function.LookupRows(');
    document.defaultView.close();
    top.editor.getWrapperElement().ownerDocument.defaultView.close();
});

test('TypeScript: a constructor is only inserted as a call where the content has "new"', () => {
    const bare = inSsjs(page(), 'var r = Script.Util.Http|', WITH_TYPESCRIPT);
    assert.deepEqual(bare.labels, ['HttpGet', 'HttpRequest']);
    bare.pick('HttpRequest');
    assert.equal(bare.editor.getLine(2), 'var r = Script.Util.HttpRequest');

    const created = inSsjs(page(), 'var r = new Script.Util.Http|', WITH_TYPESCRIPT);
    created.pick('HttpRequest');
    assert.equal(created.editor.getLine(2), 'var r = new Script.Util.HttpRequest(');
    bare.editor.getWrapperElement().ownerDocument.defaultView.close();
    created.editor.getWrapperElement().ownerDocument.defaultView.close();
});

test('TypeScript: hover shows the type of what the content calls, also for its own names', async () => {
    const context = page();
    const editor = addEditor(
        context,
        SSJS_OPEN + 'var de = DataExtension.Init("x");\nvar rows = de.Rows;\n</script>',
    );
    runExtension(context.window, WITH_TYPESCRIPT);
    rest(context, editor, 'var de = DataExtension.In');
    await hoverPause();
    const { document } = context.window;
    assert.match(
        document.querySelector(`${HOVER} pre`).textContent,
        /DataExtension\.Init\(key: string\): DataExtensionInstance/,
    );
    // the catalogue knows nothing about a variable
    rest(context, editor, 'var ro');
    await hoverPause();
    assert.match(document.querySelector(`${HOVER} pre`).textContent, /var rows: DataExtensionRows/);
    context.window.close();
});

test('TypeScript: parameter help marks the parameter being typed, also of a method of a value', async () => {
    const context = page();
    const editor = addEditor(
        context,
        SSJS_OPEN +
            'var a = Platform.Function.Lookup("a", |\nvar de = DataExtension.Init("x");\n' +
            'de.Rows.Lookup(["a"], \n</script>',
    );
    editor.hasFocus = () => true;
    editor.cursorCoords = () => ({ left: 10, right: 10, top: 100, bottom: 115 });
    runExtension(context.window, WITH_TYPESCRIPT);
    context.CodeMirror.signal(editor, 'cursorActivity', editor);
    await pause();
    const box = () => context.window.document.querySelector(SIGNATURE);
    assert.match(box().querySelector('pre').textContent, /^Lookup\(deName: string, returnField/);
    assert.equal(box().querySelector('strong').textContent, 'returnField: string');
    // without TypeScript there is no help for a method of something that is not a global
    editor.setCursor({ line: 4, ch: 'de.Rows.Lookup(["a"], '.length });
    await pause();
    const label = box().querySelector('pre').textContent;
    const marked = box().querySelector('strong').textContent;
    assert.ok(marked.length > 0 && label.indexOf(marked) > label.indexOf(','), label);
    context.window.close();
});

test('TypeScript: Ctrl-click on a variable goes to where it is declared', () => {
    const context = page();
    const editor = addEditor(
        context,
        '<p>total</p>\n<script runat="server">\nvar total = 1;\nfunction greet(name) { return name; }\n' +
            'var b = total + 1;\nvar c = Stringify(greet(b));\n</script>\n' +
            '<script>\nvar d = total;\n</script>',
    );
    editor.setCursor({ line: 0, ch: 0 });
    runExtension(context.window, WITH_TYPESCRIPT);
    const cursor = () => ({ line: editor.getCursor().line, ch: editor.getCursor().ch });

    assert.equal(wasLeftToEditor(context, editor, 'var b = to', CTRL), false);
    assert.deepEqual(cursor(), { line: 2, ch: 4 });
    assert.equal(wasLeftToEditor(context, editor, 'Stringify(gr', CTRL), false, 'functions too');
    assert.deepEqual(cursor(), { line: 3, ch: 9 });

    editor.setCursor({ line: 0, ch: 0 });
    assert.equal(
        wasLeftToEditor(context, editor, 'var c = Stri', CTRL),
        true,
        'declared by Marketing Cloud, not in the content',
    );
    assert.equal(wasLeftToEditor(context, editor, 'var d = to', CTRL), true, 'a browser script');
    assert.equal(wasLeftToEditor(context, editor, '<p>to', CTRL), true, 'plain text');
    assert.deepEqual(cursor(), { line: 0, ch: 0 });
    context.window.close();
});

/**
 * Lists where an editor is underlined.
 *
 * @param {object} editor CodeMirror instance
 * @returns {string[]} "line:from-to" of each underline, in document order
 */
function underlinedRanges(editor) {
    return [...editor.getAllMarks()]
        .filter((mark) => mark.className?.includes('sfmc-diagnostic'))
        .map((mark) => mark.find())
        .map(({ from, to }) => `${from.line}:${from.ch}-${to.ch}`)
        .toSorted((a, b) => a.localeCompare(b));
}

test('TypeScript: type errors are underlined in SSJS, once, and not in AMPscript or browser scripts', async () => {
    const context = page();
    const editor = addEditor(
        context,
        '<p>Hello de.Rowz</p>\n%%[ set @text = "a"\nset @b = de.Rowz ]%%\n' +
            '<div><script runat="server">\nPlatform.Load("core", "1.1.5");\n' +
            '  var de = DataExtension.Init("x");\n  de.Rowz.Add({});\nlet x = 1;\n</script></div>\n' +
            '<script>\nvar text = "a";\ntext.nothing();\nde.Rowz.Add({});\n</script>',
    );
    runExtension(context.window);
    await checkPause();
    assert.deepEqual(underlined(editor), ['error: let '], 'what is found without TypeScript');

    // the script arrives after the first check: the content is checked again without a change,
    // once the script has started
    context.window.eval(typescriptScript);
    const service = context.window[TYPESCRIPT];
    let asked = 0;
    const { diagnostics } = service;
    service.diagnostics = () => {
        asked++;
        // what is reported a second time for the same place is shown once
        return [...diagnostics(), ...diagnostics()];
    };
    assert.deepEqual(underlined(editor), ['error: let ']);
    await pause();
    assert.equal(asked, 1);
    assert.deepEqual(underlined(editor), ['error: let ', 'error: Rowz']);
    // "Rowz" in the server script, line 6, and "let " in line 7; nothing in lines 0 to 2 and 9 to 13
    assert.deepEqual(underlinedRanges(editor), ['6:5-9', '7:0-4']);
    rest(context, editor, '  de.Ro');
    await hoverPause();
    const { document } = context.window;
    const problem = document.querySelector(`${HOVER} .sfmc-problem`);
    assert.match(problem.textContent, /Property 'Rowz' does not exist on type/);
    assert.equal(asked, 1, 'the box shows what was found, it does not ask TypeScript');

    // after a change the box checks at once, but TypeScript is only asked once typing has paused
    editor.replaceRange('  de.Rows.Add({});', { line: 6, ch: 0 }, { line: 6 });
    rest(context, editor, 'let');
    await hoverPause();
    assert.match(document.querySelector(`${HOVER} .sfmc-problem`).textContent, /not supported/);
    assert.equal(asked, 1);
    await checkPause();
    assert.equal(asked, 2);
    assert.deepEqual(underlinedRanges(editor), ['7:0-4']);

    // a document without a server script is not shown to TypeScript at all
    editor.setValue('<p>%%=Lowercase("A")=%%</p>\n<script>\ntext.nothing();\n</script>');
    await checkPause();
    assert.equal(asked, 2);
    assert.deepEqual(underlinedRanges(editor), []);
    context.window.close();
});

test('TypeScript: a second copy of the script keeps the first one and says nothing', () => {
    const { window } = page();
    let ready = 0;
    window.document.addEventListener('sfmc-ux-tools:typescript-ready', () => ready++);
    window.eval(typescriptScript);
    const service = window[TYPESCRIPT];
    assert.equal(ready, 1);
    window.eval(typescriptScript);
    assert.equal(window[TYPESCRIPT], service);
    assert.equal(ready, 1);
});

const failing = () => {
    throw new Error('broken');
};

test('TypeScript: without the script, or with one that fails, everything works as before', async () => {
    const context = page();
    const editor = addEditor(
        context,
        SSJS_OPEN +
            'var a = Platform.Function.Loo|\nvar b = Platform.Function.Lookup("a", "b", "c", 1);\n' +
            'function greet(name) { return name; }\ngreet(b);\n</script>',
    );
    runExtension(context.window);
    assert.equal(context.window[TYPESCRIPT], undefined);
    pressCtrlSpace(editor);
    const labels = hints(editor).map((hint) => hint.displayText);
    assert.ok(labels.includes('Platform.Function.Lookup'), labels.join(' | '));
    editor.state.completionActive.close();

    context.window[TYPESCRIPT] = {
        update: () => {},
        completions: failing,
        hover: failing,
        signatureHelp: failing,
        definition: failing,
        diagnostics: failing,
        memberCompletions: failing,
        isInSsjsRegion: failing,
    };
    pressCtrlSpace(editor);
    assert.deepEqual(
        hints(editor).map((hint) => hint.displayText),
        labels,
    );
    editor.state.completionActive.close();
    rest(context, editor, 'var b = Platform.Function.Look');
    await hoverPause();
    assert.match(
        context.window.document.querySelector(`${HOVER} pre`).textContent,
        /^\(function\) Platform\.Function\.Lookup\(/,
    );
    assert.equal(wasLeftToEditor(context, editor, '\ngr', CTRL), false);
    assert.equal(editor.getCursor().line, 4);
    await checkPause();
    assert.deepEqual(underlined(editor), [], 'the usual checks still ran');
    context.window.close();
});

test('TypeScript: the frame asks for the script once, when its first editor is set up', async () => {
    const context = page();
    let asked = 0;
    context.window.document.addEventListener(NEED_TYPESCRIPT, () => asked++);
    runExtension(context.window);
    await pause();
    assert.equal(asked, 0, 'a frame without an editor has no use for it');
    addEditor(context, '<p>plain</p>', 'htmlmixed');
    await pause();
    assert.equal(asked, 0, 'an editor for something else neither');
    addEditor(context, '%%[ set @a = 1 ]%%');
    await pause();
    assert.equal(asked, 1);
    addEditor(context, '%%[ set @b = 2 ]%%');
    await pause();
    assert.equal(asked, 1);

    // a frame that has the script already does not ask
    const loaded = page();
    loaded.window.document.addEventListener(NEED_TYPESCRIPT, () => asked++);
    addEditor(loaded, '%%[ set @a = 1 ]%%');
    loaded.window.eval(typescriptScript);
    runExtension(loaded.window);
    assert.equal(asked, 1);
});

test('TypeScript: from the editor to the loaded script, through the loader and the background script', async () => {
    const context = page();
    const { window } = context;
    const injections = [];
    const listeners = [];
    const sender = {
        id: 'this-extension',
        tab: { id: 7 },
        frameId: 3,
        documentId: 'A1',
        url: 'https://content-builder.s50.marketingcloudapps.com/',
    };
    let isReachable = false;
    const chrome = {
        runtime: {
            id: sender.id,
            onMessage: {
                addListener: (listener) => {
                    listeners.push(listener);
                },
            },
            // the loader's side: Chrome adds who sent the message and hands the answer back
            sendMessage: (message) => {
                const { promise, resolve } = Promise.withResolvers();
                if (listeners.every((listener) => listener(message, sender, resolve) !== true)) {
                    resolve();
                }
                return promise;
            },
        },
        scripting: {
            executeScript: (injection) => {
                injections.push(structuredClone(injection));
                if (!isReachable) {
                    return Promise.reject(new Error('Frame with ID 3 is showing error page'));
                }
                window.eval(read(`../dist/extension/${injection.files[0]}`));
                return Promise.resolve([]);
            },
        },
    };
    vm.runInNewContext(read('../dist/extension/background.js'), { chrome });
    window.chrome = chrome;
    window.eval(read('../dist/extension/editor-typescript-loader.js'));
    runExtension(window);
    assert.equal(window[TYPESCRIPT], undefined);
    const editor = addEditor(
        context,
        SSJS_OPEN + 'var de = DataExtension.Init("x");\nde.Rows.|\n</script>',
    );
    await pause();
    const injection = {
        target: { tabId: 7, documentIds: ['A1'] },
        files: ['editor-typescript.js'],
        world: 'MAIN',
    };
    assert.deepEqual(injections, [injection]);
    assert.equal(window[TYPESCRIPT], undefined, 'the script could not be loaded');
    assert.equal(pressCtrlSpace(editor), context.CodeMirror.Pass, 'as without TypeScript');

    // the next editor that is set up asks again
    isReachable = true;
    addEditor(context, '%%[ set @a = 1 ]%%');
    await pause();
    assert.deepEqual(injections, [injection, injection]);
    addEditor(context, '%%[ set @b = 2 ]%%');
    await pause();
    assert.equal(injections.length, 2, 'not once it is there');
    pressCtrlSpace(editor);
    assert.ok(
        hints(editor)
            .map((hint) => hint.displayText)
            .includes('Retrieve'),
    );
    window.close();
});
