import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

// these tests run the built extension in a page like Marketing Cloud Next's content editor;
// "npm test" builds it first (pretest)
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
const languageScript = read('../dist/extension/editor-language.js');
const formatScript = read('../dist/extension/editor-format.js');
const NEXT_URL = 'https://example.lightning.force.com/cmsAuthor/contentEditor.app?id=1';
const ENGAGEMENT_URL = 'https://content-builder.s1.marketingcloudapps.com/';
const NEXT_MODE = 'ampscript-handlebars';
const HOVER = '.sfmc-hover';
const SIGNATURE = '.sfmc-signature';
// the features that are set up for an editor, by a key each of them binds
const KEYS = {
    hover: 'Ctrl-.',
    signature: 'Esc',
    format: 'Shift-Alt-F',
    completions: 'Ctrl-Space',
};
// longer than the page is looked at for its CodeMirror, and for editors that are known
const libraryPause = () => new Promise((resolve) => setTimeout(resolve, 1200));
// longer than a scan of the page is put off
const scanPause = () => new Promise((resolve) => setTimeout(resolve, 150));
const hoverPause = () => new Promise((resolve) => setTimeout(resolve, 450));
const checkPause = () => new Promise((resolve) => setTimeout(resolve, 650));

// the pages of a test; each keeps looking for CodeMirror until it is closed
const pages = [];
afterEach(() => {
    for (const window of pages.splice(0)) {
        window.close();
    }
});

/**
 * Creates a page without CodeMirror, as Marketing Cloud Next's content editor is until the user
 * opens a code editor.
 *
 * @param {string} [url] address of the page
 * @returns {object} the page's window
 */
function page(url = NEXT_URL) {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        url,
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    // jsdom has no layout; CodeMirror only needs these to exist
    window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    window.Range.prototype.getClientRects = () => [];
    pages.push(window);
    return window;
}

/**
 * Loads CodeMirror 5 into a page the way Marketing Cloud Next does: as a global, with an
 * "ampscript-handlebars" mode (here plain HTML), its own Ctrl-Space and the hint addon.
 *
 * @param {object} window page window
 */
function loadLibrary(window) {
    window.eval(codeMirrorSource);
    for (const source of htmlModeSources) {
        window.eval(source);
    }
    window.eval(showHintSource);
    window.CodeMirror.defineMode(NEXT_MODE, (config) =>
        window.CodeMirror.getMode(config, 'htmlmixed'),
    );
}

/**
 * Adds a component with a shadow tree to the page, like the Lightning components the content
 * editor is made of.
 *
 * @param {Node} parent where to add it
 * @returns {ShadowRoot} its shadow tree
 */
function addComponent(parent) {
    const host = parent.ownerDocument.createElement('div');
    parent.append(host);
    return host.attachShadow({ mode: 'open' });
}

/**
 * Adds an editor to a place of the page.
 *
 * @param {object} window page window
 * @param {Node} parent where to add it
 * @param {string} value editor content
 * @param {string} [mode] mode option
 * @returns {object} CodeMirror instance
 */
function addEditor(window, parent, value, mode = NEXT_MODE) {
    const editor = new window.CodeMirror(parent, {
        value,
        mode,
        extraKeys: { 'Ctrl-Space': 'autocomplete' },
    });
    editor.charCoords = () => ({ left: 10, right: 20, top: 100, bottom: 115 });
    editor.cursorCoords = () => ({ left: 10, right: 10, top: 100, bottom: 115 });
    return editor;
}

/**
 * Runs the extension's scripts in the page, in the order of the manifest.
 *
 * @param {object} window page window
 */
function runExtension(window) {
    window.eval(languageScript);
    window.eval(formatScript);
}

/**
 * Lists the key maps of an editor that bind a key.
 *
 * @param {object} editor CodeMirror instance
 * @param {string} key name of the key, as CodeMirror writes it
 * @returns {object[]} key maps
 */
function bound(editor, key) {
    return editor.state.keyMaps.filter((map) => Object.hasOwn(map, key));
}

/**
 * Lists the features that are set up for an editor.
 *
 * @param {object} editor CodeMirror instance
 * @returns {string[]} names from `KEYS`
 */
function features(editor) {
    return Object.entries(KEYS)
        .filter(([, key]) => bound(editor, key).length > 0)
        .map(([name]) => name);
}

/**
 * Creates a page of the content editor with one editor in a nested shadow tree and the
 * extension running.
 *
 * @param {string} value editor content
 * @returns {Promise.<{window: object, editor: object}>} the page and its editor, set up
 */
async function withEditor(value) {
    const window = page();
    loadLibrary(window);
    const editor = addEditor(window, addComponent(addComponent(window.document.body)), value);
    runExtension(window);
    await scanPause();
    return { window, editor };
}

/**
 * Rests the mouse on a character of an editor. jsdom has no layout, so the editor is told
 * which character that is.
 *
 * @param {object} window page window
 * @param {object} editor CodeMirror instance
 * @param {string} before text that ends right before the character
 */
async function rest(window, editor, before) {
    const place = editor.posFromIndex(editor.getValue().indexOf(before) + before.length);
    editor.coordsChar = () => ({ line: place.line, ch: place.ch + 1, xRel: -1 });
    editor.getWrapperElement().dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
    await hoverPause();
}

/**
 * Lists what is underlined in an editor.
 *
 * @param {object} editor CodeMirror instance
 * @returns {string[]} kind of underline and underlined text, sorted
 */
function underlined(editor) {
    return [...editor.getAllMarks()]
        .filter((mark) => mark.className?.includes('sfmc-diagnostic'))
        .map((mark) => {
            const { from, to } = mark.find();
            return `${mark.className.split('sfmc-diagnostic-', 2)[1]}: ${editor.getRange(from, to)}`;
        })
        .toSorted((a, b) => a.localeCompare(b));
}

const NEXT_FEATURES = ['hover', 'signature', 'format', 'completions'];
const POPUP = '.CodeMirror-hints';
// the page's own suggestions for AMPscript and its own explanation of a place in the code
const PAGE_PICKER = 'es_block_builder-content-resource-picker';
const PAGE_TOOLTIP = 'es_block_builder-codeview-tooltip';
const PAGE_TOOLTIP_SHOWN = 'is-visible';
// longer than typing has to pause for the suggestions, and than the popup takes to follow a change
const typingPause = () => new Promise((resolve) => setTimeout(resolve, 200));

/**
 * Creates a page of the content editor like `withEditor`, with stand-ins for the page's own
 * suggestions and explanation in the shadow trees around the editor.
 *
 * @param {string} value editor content
 * @param {{hasTooltip?: boolean}} [options] whether the page has its own explanation
 * @returns {Promise.<{window: object, editor: object, picker: HTMLElement, tooltip: HTMLElement | null}>} the page, its editor and the stand-ins
 */
async function withPageParts(value, { hasTooltip = true } = {}) {
    const window = page();
    loadLibrary(window);
    const { document } = window;
    const codeView = addComponent(document.body);
    const editor = addEditor(window, addComponent(codeView), value);
    // next to the component of the editor
    const picker = document.createElement(PAGE_PICKER);
    picker.isOpen = false;
    codeView.append(picker);
    // inside another component
    const tooltip = hasTooltip ? document.createElement(PAGE_TOOLTIP) : null;
    if (tooltip) {
        addComponent(codeView).append(tooltip);
    }
    assert.equal(document.querySelector(`${PAGE_PICKER}, ${PAGE_TOOLTIP}`), null, 'out of sight');
    runExtension(window);
    await scanPause();
    return { window, editor, picker, tooltip };
}

/**
 * Puts the cursor behind a text of the editor's content.
 *
 * @param {object} editor CodeMirror instance
 * @param {string} before text that ends where the cursor goes
 */
function cursorBehind(editor, before) {
    editor.setCursor(editor.posFromIndex(editor.getValue().indexOf(before) + before.length));
}

/**
 * Presses Ctrl-Space the way CodeMirror would: the extension's key map first, and the page's own
 * binding if that passes the key on.
 *
 * @param {object} window page window
 * @param {object} editor CodeMirror instance
 * @returns {string} "extension" or "page", whoever took the key
 */
function pressCtrlSpace(window, editor) {
    const [keys] = bound(editor, KEYS.completions);
    return keys[KEYS.completions](editor) === window.CodeMirror.Pass ? 'page' : 'extension';
}

/**
 * Types text at the cursor and tells the editor's listeners about it, like real input does.
 *
 * @param {object} window page window
 * @param {object} editor CodeMirror instance
 * @param {string} text typed text
 */
function type(window, editor, text) {
    editor.replaceSelection(text, 'end', '+input');
    window.CodeMirror.signal(editor, 'inputRead', editor, { origin: '+input', text: [text] });
}

/**
 * Lists the names of the suggestions that are on offer.
 *
 * @param {object} editor CodeMirror instance
 * @returns {string[]} names; empty if no popup is open
 */
function offered(editor) {
    return (editor.state.completionActive?.data?.list ?? []).map((entry) => entry.displayText);
}

test('Next: editors in shadow trees are found once the page loads CodeMirror, however late', async () => {
    const window = page();
    runExtension(window);
    await libraryPause();
    assert.equal(window.CodeMirror, undefined, 'nothing is loaded for the page');

    // the user opens a code editor: the page loads CodeMirror and creates an editor at once,
    // before the extension has seen the library
    loadLibrary(window);
    const first = addEditor(window, addComponent(addComponent(window.document.body)), '<p></p>');
    assert.equal(window.document.querySelectorAll('.CodeMirror').length, 0, 'out of sight');
    assert.deepEqual(features(first), []);
    await libraryPause();
    assert.deepEqual(features(first), NEXT_FEATURES, 'found by a walk through the shadow trees');

    // from then on, CodeMirror tells about every editor it creates
    const second = addEditor(window, addComponent(window.document.body), '<p></p>');
    await scanPause();
    assert.deepEqual(features(second), NEXT_FEATURES, 'found through the init hook');
    // nothing is set up twice
    await libraryPause();
    assert.equal(bound(first, KEYS.format).length, 1);
    assert.equal(bound(second, KEYS.hover).length, 1);
});

test('Next: an editor is set up when it gets the mode, and one that is added to the page later too', async () => {
    const window = page();
    loadLibrary(window);
    runExtension(window);
    const plain = addEditor(window, addComponent(window.document.body), '<p></p>', 'htmlmixed');
    // created off the page and added later, as in a panel that is built before it is shown
    const holder = window.document.createElement('div');
    const late = addEditor(window, holder.attachShadow({ mode: 'open' }), '<p></p>');
    await scanPause();
    assert.deepEqual(features(plain), [], 'not an editor for AMPscript');
    assert.deepEqual(features(late), [], 'not on the page');

    plain.setOption('mode', NEXT_MODE);
    await scanPause();
    assert.deepEqual(features(plain), NEXT_FEATURES);

    window.document.body.append(holder);
    await libraryPause();
    assert.deepEqual(features(late), NEXT_FEATURES);

    // an editor that leaves the page loses the box it shows
    await rest(window, late, '<');
    late.setValue('%%=Lowercase("A")=%%');
    await rest(window, late, '%%=Lower');
    assert.ok(window.document.querySelector(HOVER));
    holder.remove();
    await libraryPause();
    assert.equal(window.document.querySelector(HOVER), null);
});

test('Next: no save key, no button and nothing of TypeScript are added', async () => {
    const { window, editor } = await withEditor('%%[ set @a = Loo ]%%');
    let wasAsked = false;
    window.document.addEventListener('sfmc-ux-tools:need-typescript', () => {
        wasAsked = true;
    });
    const other = addEditor(window, addComponent(window.document.body), '<p></p>');
    await scanPause();
    for (const cm of [editor, other]) {
        assert.deepEqual(features(cm), NEXT_FEATURES);
        assert.ok(cm.state.keyMaps.every((map) => !('Ctrl-S' in map || 'Cmd-S' in map)));
        assert.equal(cm.getWrapperElement().querySelector('.sfmc-format-button'), null);
    }
    assert.equal(wasAsked, false);
    // the page's own Ctrl-Space stays where it is
    assert.equal(editor.getOption('extraKeys')['Ctrl-Space'], 'autocomplete');
});

test('Next: Ctrl-Space and typing suggest the AMPscript that Marketing Cloud Next has, in a list of the extension', async () => {
    const { window, editor } = await withPageParts(
        '%%[ set @a = M ]%%\n%%[ set @b = HTTP ]%%\n%%= =%%',
    );
    const { document } = window;
    cursorBehind(editor, 'set @a = M');
    assert.equal(pressCtrlSpace(window, editor), 'extension');
    // MD5 came with API version 68
    assert.ok(offered(editor).includes('MD5'), offered(editor).join(' '));
    assert.ok(offered(editor).includes('Multiply'));
    const list = document.querySelector(POPUP);
    assert.equal(list.parentNode, document.body);
    assert.ok(list.classList.contains('sfmc-hints'), 'marked as the list of the extension');
    assert.ok(list.querySelector(':scope > .CodeMirror-hint .sfmc-hint-detail'));
    // its icon says under the mouse what the extension added; it stands after the entries,
    // which the list finds by their place
    const icons = list.querySelectorAll('.sfmc-hints-icon');
    assert.equal(icons.length, 1);
    assert.equal(icons[0], list.lastChild);
    assert.equal(icons[0].getAttribute('role'), 'img');
    assert.equal(
        icons[0].title,
        'SFMC UX Tools: added this list of suggestions for AMPscript and Handlebars.',
    );
    assert.equal(icons[0].getAttribute('aria-label'), icons[0].title);
    // the keyboard moves through the list, and a pick inserts the function
    const { widget } = editor.state.completionActive;
    widget.changeActive(offered(editor).indexOf('MD5'));
    assert.match(list.querySelector('.CodeMirror-hint-active').textContent, /^MD5/);
    widget.pick();
    assert.equal(editor.getLine(0), '%%[ set @a = MD5( ]%%');

    // what only Marketing Cloud Engagement has is not offered
    cursorBehind(editor, 'set @b = HTTP');
    pressCtrlSpace(window, editor);
    assert.ok(
        offered(editor).every((name) => !/^HTTP/i.test(name)),
        offered(editor).join(' '),
    );
    editor.state.completionActive?.close();

    // while typing, also in an inline expression
    cursorBehind(editor, '%%=');
    type(window, editor, 'L');
    type(window, editor, 'o');
    assert.equal(document.querySelector(POPUP), null, 'waits until typing pauses');
    await typingPause();
    assert.ok(offered(editor).includes('Lookup'), offered(editor).join(' '));
    assert.ok(offered(editor).includes('Lowercase'));
    assert.ok(offered(editor).includes('LookupOrderedRows'));
    assert.ok(!offered(editor).includes('LookupOrderedRowsCS'), 'not in Marketing Cloud Next');
    assert.ok(document.querySelector(`${POPUP}.sfmc-hints`));
});

test('Next: inside {{ }} the Handlebars helpers are suggested, a block helper with its sign, and nothing where no helper goes', async () => {
    const { window, editor, picker } = await withPageParts(
        '<p>{{upp}}</p>\n<p>{{#i}}</p>\n<p>{{i}}</p>\n<p>{{/i}} {{> i}} {{! i}}</p>',
    );
    const { document } = window;
    cursorBehind(editor, '{{upp');
    assert.equal(pressCtrlSpace(window, editor), 'extension');
    assert.ok(offered(editor).includes('uppercase'), offered(editor).join(' '));
    // helpers only, no AMPscript function
    assert.ok(!offered(editor).includes('Uppercase'));
    assert.ok(document.querySelector(`${POPUP}.sfmc-hints`));
    // a helper is followed by a blank, never by a bracket
    const { widget } = editor.state.completionActive;
    widget.changeActive(offered(editor).indexOf('uppercase'));
    widget.pick();
    assert.equal(editor.getLine(0), '<p>{{uppercase }}</p>');

    // after the sign of a block, only helpers that have one; the sign is not doubled
    cursorBehind(editor, '{{#i');
    assert.equal(pressCtrlSpace(window, editor), 'extension');
    assert.deepEqual([...offered(editor)], ['if', 'impressionRegion']);
    const block = editor.state.completionActive.widget;
    block.changeActive(0);
    block.pick();
    assert.equal(editor.getLine(1), '<p>{{#if }}</p>');
    // without the sign, the block helper brings it along, next to the plain helpers
    cursorBehind(editor, '{{i');
    assert.equal(pressCtrlSpace(window, editor), 'extension');
    assert.ok(offered(editor).includes('iif'), offered(editor).join(' '));
    const plain = editor.state.completionActive.widget;
    plain.changeActive(offered(editor).indexOf('if'));
    plain.pick();
    assert.equal(editor.getLine(2), '<p>{{#if }}</p>');

    // the end of a block, a partial and a comment take no helper
    for (const place of ['{{/i', '{{> i', '{{! i']) {
        cursorBehind(editor, place);
        assert.equal(pressCtrlSpace(window, editor), 'page', place);
        assert.equal(document.querySelector(POPUP), null, place);
    }

    // while typing, and not while the page shows its own suggestions
    cursorBehind(editor, '{{uppercase ');
    editor.replaceRange('{{pro', { line: 0, ch: 0 }, { line: 0, ch: 0 });
    cursorBehind(editor, '{{pro');
    type(window, editor, 'p');
    await typingPause();
    assert.ok(offered(editor).includes('propercase'), offered(editor).join(' '));
    editor.state.completionActive?.close();
    picker.isOpen = true;
    assert.equal(pressCtrlSpace(window, editor), 'page');
    assert.equal(document.querySelector(POPUP), null);
});

test('Next: scripts and the suggestions of the page itself are left to the page', async () => {
    const { window, editor, picker } = await withPageParts(
        '<p>{{upp}} {{#if\n a}}</p>\n%%[ set @a = Lo ]%%\n<script>var a = 1; a</script>',
    );
    const { document } = window;
    const places = ['<script>var a = 1; a'];
    for (const place of places) {
        cursorBehind(editor, place);
        assert.equal(pressCtrlSpace(window, editor), 'page', place);
        type(window, editor, 'p');
        await typingPause();
        assert.equal(document.querySelector(POPUP), null, place);
    }

    // AMPscript: not while the page shows its own suggestions
    cursorBehind(editor, 'set @a = Lo');
    picker.isOpen = true;
    assert.equal(pressCtrlSpace(window, editor), 'page');
    type(window, editor, 'o');
    await typingPause();
    assert.equal(document.querySelector(POPUP), null);
    assert.equal(editor.getLine(2), '%%[ set @a = Loo ]%%');

    // the list of the extension goes away when the page opens its own
    picker.isOpen = false;
    assert.equal(pressCtrlSpace(window, editor), 'extension');
    assert.ok(document.querySelector(`${POPUP}.sfmc-hints`));
    picker.isOpen = true;
    type(window, editor, 'k');
    await typingPause();
    assert.equal(document.querySelector(POPUP), null);
    editor.state.completionActive?.close();

    // a page that cannot be asked is taken to show its own
    Object.defineProperty(picker, 'isOpen', {
        /**
         *
         */
        get() {
            throw new Error('broken');
        },
    });
    assert.equal(pressCtrlSpace(window, editor), 'page');
    assert.equal(document.querySelector(POPUP), null);
});

test('Next: without suggestions of the page itself, AMPscript is suggested all the same', async () => {
    const { window, editor } = await withEditor('%%[ set @a = Loo ]%%');
    cursorBehind(editor, 'Loo');
    assert.equal(pressCtrlSpace(window, editor), 'extension');
    assert.ok(offered(editor).includes('Lookup'));
});

test('Next: the lists of suggestions of the page itself keep their look, and only the list of the extension is styled', async () => {
    const { window } = await withEditor('<p></p>');
    assert.equal(Object.hasOwn(window.document.documentElement.dataset, 'sfmcUxToolsNext'), true);
    const css = read('../src/editor-highlight.css');
    // every rule for the list: by the class of the extension's list, or only where this is not
    // Marketing Cloud Next
    const selectors = css
        .matchAll(/^([^\n{}/*]*\.CodeMirror-hint[^\n{]*?)(?:,| \{)$/gm)
        .map((match) => match[1])
        .toArray();
    assert.deepEqual(selectors, [
        '.CodeMirror-hints.sfmc-hints',
        'html:not([data-sfmc-ux-tools-next]) .CodeMirror-hints',
        '.CodeMirror-hints.sfmc-hints .CodeMirror-hint',
        'html:not([data-sfmc-ux-tools-next]) .CodeMirror-hint',
        '.CodeMirror-hints.sfmc-hints li.CodeMirror-hint-active',
        'html:not([data-sfmc-ux-tools-next]) li.CodeMirror-hint-active',
        'html[data-sfmc-ux-tools-next] .CodeMirror-hints.sfmc-hints',
        'html[data-sfmc-ux-tools-next] .CodeMirror-hints.sfmc-hints > .sfmc-hints-icon',
        '.CodeMirror-hint .sfmc-hint-detail',
    ]);
    // the list of the extension has its icon, which the page may load: the list is wider by a
    // column for it, so that it never lies on an entry, and the icon itself is in that column
    assert.match(
        css,
        /html\[data-sfmc-ux-tools-next\] \.CodeMirror-hints\.sfmc-hints \{[^}]*padding-right: calc\(16px \+ 4px \+ 6px\);/,
    );
    assert.doesNotMatch(css, /\.sfmc-hints::before/);
    assert.match(
        css,
        /\.sfmc-hints > \.sfmc-hints-icon \{[^}]*position: absolute;\s+top: 3px;\s+right: 4px;[^}]*url\('chrome-extension:\/\/__MSG_@@extension_id__\/icons\/icon16\.png'\)/,
    );
});

test('Next: where the extension explains, the explanation of the page itself is hidden: on AMPscript, and on what it knows of Handlebars', async () => {
    const { window, editor, tooltip } = await withPageParts(
        '%%=Uppercase(@a)=%%\n%%[ set @b = HTTPGet("a") ]%%\n<p>{{uppercase myOwnField}} {{nope a}}</p>',
    );
    await checkPause();
    const { document } = window;
    const isMuted = () => Object.hasOwn(tooltip.dataset, 'sfmcUxToolsMuted');
    assert.equal(isMuted(), false);

    // AMPscript: ours is shown, also while the page would show its own
    tooltip.classList.add(PAGE_TOOLTIP_SHOWN);
    await rest(window, editor, '%%=Upper');
    assert.equal(isMuted(), true);
    assert.match(document.querySelector(`${HOVER} pre`).textContent, /^\(function\) Uppercase\(/);
    // what Marketing Cloud Next lacks is said without the documentation, and the page stays hidden
    await rest(window, editor, 'set @b = HTTP');
    assert.equal(isMuted(), true);
    assert.ok(document.querySelector(`${HOVER} .sfmc-problem-error`));
    assert.equal(document.querySelector(`${HOVER} pre`), null);

    // a Handlebars helper: ours is shown as well, and the page's is hidden
    await rest(window, editor, '{{upper');
    assert.equal(isMuted(), true);
    assert.match(document.querySelector(`${HOVER} pre`).textContent, /^\(helper\) uppercase\(/);
    // a field that only the page knows: the page explains, the extension does not
    await rest(window, editor, '{{uppercase myOwn');
    assert.equal(isMuted(), false);
    assert.equal(document.querySelector(HOVER), null);
    // what the extension objects to is said by the extension
    await rest(window, editor, '{{nop');
    assert.equal(isMuted(), true);
    assert.ok(document.querySelector(`${HOVER} .sfmc-problem`));

    // back on AMPscript, then off the editor: the page may explain again
    await rest(window, editor, '%%=Upper');
    assert.equal(isMuted(), true);
    const box = document.querySelector(HOVER);
    // on the way into the box the page's explanation stays hidden
    editor.getWrapperElement().dispatchEvent(new window.MouseEvent('mouseleave'));
    assert.equal(isMuted(), true);
    box.dispatchEvent(new window.MouseEvent('mouseleave'));
    assert.equal(isMuted(), false);

    // the stylesheet hides what is marked
    assert.match(
        read('../src/editor-highlight.css'),
        /es_block_builder-codeview-tooltip\[data-sfmc-ux-tools-muted\] \{\s+display: none !important;/,
    );
});

test('Next: an explanation that the page replaces is hidden as well, and without one on the page nothing breaks', async () => {
    const { window, editor, tooltip } = await withPageParts('%%=Uppercase(@a)=%%');
    const { document } = window;
    await rest(window, editor, '%%=Upper');
    assert.equal(Object.hasOwn(tooltip.dataset, 'sfmcUxToolsMuted'), true);

    const replacement = document.createElement(PAGE_TOOLTIP);
    tooltip.replaceWith(replacement);
    await rest(window, editor, '%%=Uppe');
    assert.equal(Object.hasOwn(replacement.dataset, 'sfmcUxToolsMuted'), true);
    assert.ok(document.querySelector(`${HOVER} pre`));

    const bare = await withPageParts('%%=Uppercase(@a)=%%', { hasTooltip: false });
    await rest(bare.window, bare.editor, '%%=Upper');
    assert.match(
        bare.window.document.querySelector(`${HOVER} pre`).textContent,
        /^\(function\) Uppercase\(/,
    );
});

test('Next: AMPscript and Handlebars are checked for Marketing Cloud Next, and what it lacks is only said to be unsupported', async () => {
    const content =
        '<p>{{uppercas name}} {{base64Encode name}}</p>\n%%[ set @a = HTTPGet("https://example.com") ]%%\n%%=Uppercase(@a)=%%';
    const { window, editor } = await withEditor(content);
    await checkPause();
    // a helper that Marketing Cloud Next does not have is underlined, one that it has is not
    assert.deepEqual(underlined(editor), ['error: HTTPGet', 'warning: {{uppercas name}}']);

    const { document } = window;
    await rest(window, editor, 'set @a = HTTP');
    const box = document.querySelector(HOVER);
    assert.match(
        box.querySelector('.sfmc-problem-error').textContent,
        /'HTTPGet' is not supported in Marketing Cloud Next/,
    );
    assert.match(box.querySelector('.sfmc-problem-rule').textContent, /amp-no-mcn-unsupported/);
    // the error alone, without the documentation of a function that cannot be used
    assert.equal(box.querySelector('pre'), null);
    assert.equal(box.parentNode, document.body);

    // a function that Marketing Cloud Next has is explained
    await rest(window, editor, '%%=Upper');
    assert.match(document.querySelector(`${HOVER} pre`).textContent, /^\(function\) Uppercase\(/);
    assert.equal(document.querySelector(`${HOVER} .sfmc-problem`), null);
});

test('Next: a Handlebars helper is explained as a helper, a misspelt one can be fixed, and its parameters are shown', async () => {
    const { window, editor } = await withEditor(
        '<p>{{uppercase name}} {{base64Encode name}}</p>\n<p>{{add 1 2}}</p>\n<p>{{properCase name}}</p>',
    );
    await checkPause();
    const { document } = window;
    await rest(window, editor, '{{upper');
    assert.match(document.querySelector(`${HOVER} pre`).textContent, /^\(helper\) uppercase\(/);
    // the helper, not the AMPscript function of the same name
    await rest(window, editor, '{{base64');
    assert.match(document.querySelector(`${HOVER} pre`).textContent, /^\(helper\) base64Encode\(/);

    // Marketing Cloud Next tells helpers apart by their case: the box says so and offers the fix
    assert.deepEqual(underlined(editor), ['warning: {{properCase name}}']);
    await rest(window, editor, '{{proper');
    const box = document.querySelector(HOVER);
    assert.match(box.querySelector('.sfmc-problem-rule').textContent, /hbs-helper-name-case/);
    box.querySelector('.sfmc-fix').click();
    assert.equal(editor.getLine(2), '<p>{{propercase name}}</p>');

    editor.hasFocus = () => true;
    editor.setCursor({ line: 1, ch: 11 });
    await scanPause();
    await scanPause();
    const help = document.querySelector(SIGNATURE);
    assert.match(help.querySelector('pre').textContent, /^\(helper\) add\(value1: number/);
    assert.equal(help.querySelector('strong').textContent, 'value2: number');
});

test('Next: a field with the name of a helper is left to the page, and no helper is suggested where a field goes', async () => {
    const { window, editor, tooltip } = await withPageParts(
        '<p>{{uppercase add}} {{Contact.length}}</p>\n<p>{{uppercase na}}</p>',
    );
    await checkPause();
    const { document } = window;
    assert.deepEqual(underlined(editor), []);
    // "add" and "length" are helpers, but not where a field stands
    for (const place of ['{{uppercase a', '{{Contact.len']) {
        await rest(window, editor, place);
        assert.equal(Object.hasOwn(tooltip.dataset, 'sfmcUxToolsMuted'), false, place);
        assert.equal(document.querySelector(HOVER), null, place);
    }
    await rest(window, editor, '{{upper');
    assert.match(document.querySelector(`${HOVER} pre`).textContent, /^\(helper\) uppercase\(/);

    cursorBehind(editor, '{{uppercase na');
    assert.equal(pressCtrlSpace(window, editor), 'page');
    assert.equal(document.querySelector(POPUP), null);
});

test('Next: a Handlebars block that is closed wrongly or not at all is underlined at its name, next to the other mistakes', async () => {
    const wrong = await withEditor('<p>{{#if a}}x{{/each}}</p>\n<p>{{properCase a}}</p>');
    await checkPause();
    assert.deepEqual(underlined(wrong.editor), ['error: each', 'warning: {{properCase a}}']);
    await rest(wrong.window, wrong.editor, '{{/ea');
    assert.match(
        wrong.window.document.querySelector(`${HOVER} .sfmc-problem`).textContent,
        /\{\{\/each\}\} does not close \{\{#if\}\}/,
    );

    const open = await withEditor('<p>{{nope a}}</p>\n<p>{{#if b}}</p>');
    await checkPause();
    assert.deepEqual(underlined(open.editor), ['error: if', 'warning: {{nope a}}']);

    const unfinished = await withEditor('<p>fine</p>\n<p>{{upp');
    await checkPause();
    assert.deepEqual(underlined(unfinished.editor), ['error: {{']);
});

test('Next: server-side JavaScript is said to be unsupported, and nothing else is said about it', async () => {
    const { window, editor } = await withEditor(
        '<script runat="server">\nvar a = Platform.Function.Lookup("a", "b", "c", 1);\n</script>',
    );
    await checkPause();
    const { document } = window;
    await rest(window, editor, 'Platform.Function.Look');
    const box = document.querySelector(HOVER);
    assert.match(box.textContent, /SSJS is not supported in Marketing Cloud Next/);
    assert.equal(box.querySelector('pre'), null, 'no documentation of SSJS');
});

test('Engagement: the same content is checked for Marketing Cloud Engagement, and nothing changes there', async () => {
    const window = page(ENGAGEMENT_URL);
    loadLibrary(window);
    const content =
        '<p>{{uppercas name}}</p>\n%%[ set @a = HTTPGet("https://example.com") ]%%\n<p>{{add 1 2}}</p>';
    const hidden = addEditor(window, addComponent(window.document.body), content);
    // the mode of Marketing Cloud Next is accepted wherever it is found
    const editor = addEditor(window, window.document.body, content);
    runExtension(window);
    await libraryPause();
    assert.deepEqual(
        features(hidden),
        [],
        'shadow trees are only searched in Marketing Cloud Next',
    );
    assert.deepEqual(features(editor), NEXT_FEATURES);
    assert.ok(editor.state.keyMaps.some((map) => 'Ctrl-S' in map));
    assert.ok(editor.getWrapperElement().querySelector('.sfmc-format-button'));
    assert.deepEqual(underlined(editor), [], 'no check for Marketing Cloud Next');
    assert.equal(Object.hasOwn(window.document.documentElement.dataset, 'sfmcUxToolsNext'), false);

    const { document } = window;
    await rest(window, editor, '{{add');
    // the AMPscript function of that name, not the Handlebars helper
    assert.match(document.querySelector(`${HOVER} pre`).textContent, /^\(function\) Add\(/);
    editor.hasFocus = () => true;
    editor.setCursor({ line: 2, ch: 11 });
    await scanPause();
    await scanPause();
    assert.equal(document.querySelector(SIGNATURE), null);
});

test('Next: Shift-Alt-F formats HTML, AMPscript and Handlebars in one step that can be undone', async () => {
    const { window, editor } = await withEditor(
        '<div>{{#if x}}<p>Hello {{  uppercase   name }}</p>{{else}}<p>Bye</p>{{/if}}</div>\n' +
            '%%[ set @a = Lowercase("A") ]%%\n<p>{{formatDate d "MMMM d,  yyyy"}} {!$Contact.Name}</p>',
    );
    const [keys] = bound(editor, KEYS.format);
    assert.equal(keys[KEYS.format](editor), undefined);
    await scanPause();
    await scanPause();
    assert.equal(
        editor.getValue(),
        '<div>\n' +
            '    {{#if x}}\n' +
            '    <p>Hello {{uppercase name}}</p>\n' +
            '    {{else}}\n' +
            '    <p>Bye</p>\n' +
            '    {{/if}}\n' +
            '</div>\n' +
            '%%[\n' +
            "    set @a = Lowercase('A')\n" +
            ']%%\n' +
            '<p>{{formatDate d "MMMM d,  yyyy"}} {!$Contact.Name}</p>',
    );
    editor.undo();
    assert.match(editor.getValue(), /^<div>\{\{#if x\}\}<p>Hello \{\{ {2}uppercase/);

    editor.setOption('readOnly', true);
    assert.equal(keys[KEYS.format](editor), window.CodeMirror.Pass);
});

test('the manifest runs the language and formatting scripts in the content editor of Marketing Cloud Next, and nothing else', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entries = manifest.content_scripts.filter((entry) =>
        entry.matches.some((match) => match.includes('force.com')),
    );
    assert.deepEqual(entries, [
        {
            matches: ['https://*.lightning.force.com/cmsAuthor/contentEditor.app*'],
            js: ['editor-language.js', 'editor-format.js'],
            css: ['editor-highlight.css'],
            world: 'MAIN',
            all_frames: true,
            run_at: 'document_idle',
        },
    ]);
    // content scripts need no host permission; the page loads one file of the extension, the icon
    // that marks its boxes
    assert.deepEqual(manifest.host_permissions, ['https://*.marketingcloudapps.com/*']);
    assert.deepEqual(
        manifest.web_accessible_resources
            .filter((entry) => entry.matches.some((match) => match.includes('force.com')))
            .map((entry) => entry.resources),
        [['icons/icon16.png']],
    );
});

test('Next: no helper after the sign that trims blanks, no doubled blank, and a "#" outside {{ }} is left alone', async () => {
    const { window, editor } = await withPageParts(
        '<p>{{~/i}} {{~> i}}</p>\n<p>{{upp name}}</p>\n<a href="#i">x</a>\n<p>{{ #i}} {{#if a}}{{up}}{{/if}}</p>',
    );
    const { document } = window;
    for (const place of ['{{~/i', '{{~> i']) {
        cursorBehind(editor, place);
        assert.equal(pressCtrlSpace(window, editor), 'page', place);
        assert.equal(document.querySelector(POPUP), null, place);
    }
    // a blank that is there already is not doubled
    cursorBehind(editor, '{{upp');
    assert.equal(pressCtrlSpace(window, editor), 'extension');
    const first = editor.state.completionActive.widget;
    first.changeActive(offered(editor).indexOf('uppercase'));
    first.pick();
    assert.equal(editor.getLine(1), '<p>{{uppercase name}}</p>');
    // the "#" of an address is no block: nothing of the extension replaces it
    cursorBehind(editor, 'href="#i');
    pressCtrlSpace(window, editor);
    editor.state.completionActive?.close();
    assert.equal(editor.getLine(2), '<a href="#i">x</a>');
    // a blank before the sign, and an expression after a block that is open
    cursorBehind(editor, '{{ #i');
    assert.equal(pressCtrlSpace(window, editor), 'extension');
    assert.deepEqual([...offered(editor)], ['if', 'impressionRegion']);
    editor.state.completionActive.close();
    cursorBehind(editor, '{{#if a}}{{up');
    assert.equal(pressCtrlSpace(window, editor), 'extension');
    assert.ok(offered(editor).includes('uppercase'), offered(editor).join(' '));
});

test('Engagement: inside {{ }} an AMPscript function is still inserted with its bracket', async () => {
    const window = page(ENGAGEMENT_URL);
    loadLibrary(window);
    const editor = addEditor(window, window.document.body, '<p>{{Upp}}</p>');
    runExtension(window);
    await libraryPause();
    cursorBehind(editor, '{{Upp');
    pressCtrlSpace(window, editor);
    const { widget } = editor.state.completionActive;
    widget.changeActive(offered(editor).indexOf('Uppercase'));
    widget.pick();
    assert.equal(editor.getLine(0), '<p>{{Uppercase(}}</p>');
});
