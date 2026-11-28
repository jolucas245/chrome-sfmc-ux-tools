/*
 * SFMC UX Tools — formats the content of Marketing Cloud's code editor.
 *
 * Source of the formatting script. `npm run build` bundles it together with Prettier and
 * prettier-plugin-sfmc into one classic script, which takes this file's place in dist/extension.
 * It is a file of its own so that a failure in here can never break the other features.
 */
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import * as html from 'prettier/plugins/html';
import * as postcss from 'prettier/plugins/postcss';
import * as sfmc from 'prettier-plugin-sfmc';
import { format } from 'prettier/standalone';
import {
    IS_NEXT,
    editorsOnPage,
    fileKind,
    isInMode,
    report,
    watchEditors,
} from './editor-language/editors.js';
import { watchAceFormat } from './editor-language/ace/format.js';
import { coveringDialog, createTooltipIcon } from './editor-language/tooltip.js';

// the settings the SFMC Language Service extension for VS Code formats with
const OPTIONS = {
    useTabs: false,
    tabWidth: 4,
    printWidth: 100,
    singleQuote: true,
    trailingComma: 'none',
    // the name makes Prettier read the content as HTML with AMPscript and SSJS
    filepath: 'content.html',
    // the plugin hands HTML, CSS and JavaScript on to these
    plugins: [html, babel, estree, postcss, sfmc],
};
// CloudPages' code resources are files of their own kind; these names make Prettier read them so
const KIND_FILES = new Map([
    ['javascript', 'content.js'],
    ['css', 'content.css'],
    ['json', 'content.json'],
]);
// kinds of code resources that no bundled formatter reads; as HTML they would be mangled
const UNFORMATTED_KINDS = new Set(['xml', 'text']);
// one server-side script, from its opening to its closing tag
const SERVER_SCRIPT = /<script\b[^>]*\brunat\s*=\s*["']?server\b[^>]*>[\s\S]*?<\/script\s*>/gi;
// AMPscript or a server-side script somewhere in the content
const SERVER_CODE = /%%\[|%%=|<script\b[^>]*\brunat\s*=\s*["']?server\b/i;
const MIXED_MESSAGE =
    'this file mixes its own code with AMPscript or server-side script, which no formatter reads together';
const NOTICE_TIME = 6000;
// the isolated script editor-format-setting.js writes the user's choice to this attribute
const ON_SAVE_ATTRIBUTE = 'data-sfmc-ux-tools-format-on-save';
// Marketing Cloud's buttons that save the content; the attribute is the same in every language
const SAVE_BUTTONS = '[data-action="editor-save"], [data-action="editor-save-exit"]';
const SAVE_BUTTON = '[data-action="editor-save"]';
// where Marketing Cloud's editor keeps its own buttons
const TOOLBAR = '.et-codemirror-toolbar ul';
const EDITOR_FRAME = '.et-codemirror';
// an editor the extension draws itself, in its panel Transactional Messages, stands in an element
// with this attribute, which says whether the editor is one to format: the one of a form is, the
// one that only shows a message is not
const OWN_EDITOR = 'data-sfmc-ux-tools-format';
const OWN_EDITORS = '[data-sfmc-ux-tools-format]';
const OWN_FORMATTED = 'on';
// the extension's own button that sends the form such an editor stands in
const OWN_SAVE_BUTTON = '[data-sfmc-ux-tools-format-save]';
// time for the page to take note of the formatted content before it saves, where the page does
// not say when it has
const SETTLE_TIME = 300;
// Content Builder saves what it took over from its editor, not what the editor shows, and takes
// a change over only a moment after it was made. It says that it has with this event of its
// jQuery, at this element around the editor
const TAKEN_EVENT = 'cloudeditor:change';
const TAKING_EDITOR = '.cb-editor';
// a save never waits longer than this for the page to take the content over
const TAKE_TIME_LIMIT = 3000;
// a save never waits longer than this for the formatting
const FORMAT_TIME_LIMIT = 5000;
const IS_MAC = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '');
const SHORTCUT = IS_MAC ? '⇧⌥F' : 'Shift+Alt+F';
const busy = new WeakSet();
// Marketing Cloud's own editors that were set up to be formatted, and the editors of the
// extension's own forms that were. None is ever taken out of either: one that leaves the page and
// comes back is still one of them, and one that is gone for good is not kept alive by being in
// here
const editors = new WeakSet();
const ownEditors = new WeakSet();
const state = { isSaving: false, isPending: false, isListening: false };
// the editors whose content the page has yet to take over, each with what waits for that
const untaken = new WeakMap();

/**
 * Tells the user why the content was not formatted, in a box at the top of the editor that
 * goes away by itself.
 *
 * @param {Element} wrapper the editor's element
 * @param {unknown} ex what Prettier objected to
 */
function notify(wrapper, ex) {
    const notice = wrapper.ownerDocument.createElement('div');
    notice.className = 'sfmc-tooltip sfmc-notice';
    // the first line says what is wrong and where; the rest repeats the code
    notice.append(
        createTooltipIcon(wrapper.ownerDocument, 'sfmc-notice'),
        `Not formatted: ${String(ex?.message ?? ex).split('\n', 1)[0]}`,
    );
    const { top, right } = wrapper.getBoundingClientRect();
    notice.style.top = `${Math.round(top) + 4}px`;
    notice.style.right = `${Math.round(wrapper.ownerDocument.defaultView.innerWidth - right) + 20}px`;
    // a dialog that is open covers everything that is not inside of it
    (coveringDialog(wrapper) ?? wrapper.ownerDocument.body).append(notice);
    setTimeout(() => notice.remove(), NOTICE_TIME);
}

/**
 * Finds the part in which two texts differ.
 *
 * @param {string} before current content
 * @param {string} after new content
 * @returns {{from: number, to: number, text: string}} the part of the current content to replace, by its offsets, and what to put there
 */
function changedPart(before, after) {
    let start = 0;
    while (start < before.length && before[start] === after[start]) {
        start++;
    }
    let end = 0;
    while (
        end < before.length - start &&
        end < after.length - start &&
        before.at(-1 - end) === after.at(-1 - end)
    ) {
        end++;
    }
    return { from: start, to: before.length - end, text: after.slice(start, after.length - end) };
}

/**
 * Replaces a part of an editor's content in one step that can be undone; the cursor and the
 * view stay where they are.
 *
 * @param {object} cm CodeMirror instance
 * @param {{from: number, to: number, text: string}} change the part to replace and what to put there
 */
function replace(cm, { from, to, text }) {
    const cursor = cm.getCursor();
    const { left, top } = cm.getScrollInfo();
    cm.operation(() => {
        cm.replaceRange(text, cm.posFromIndex(from), cm.posFromIndex(to), '+format');
        cm.setCursor(cursor);
        cm.scrollTo(left, top);
    });
}

/**
 * Formats the content of an editor of any kind, touching only the part that differs.
 *
 * @param {object} key the editor; while it is being formatted, it is not formatted again
 * @param {Element} element the editor's element, where the user is told about a failure
 * @param {() => string} read gives the editor's content
 * @param {(change: {from: number, to: number, text: string}, before: string) => void} write replaces a part of the content that was read
 * @param {string} [filepath] a file name that tells Prettier what the content is; content of Content Builder if left out
 */
async function formatContent(key, element, read, write, filepath = OPTIONS.filepath) {
    if (busy.has(key)) {
        return;
    }
    busy.add(key);
    try {
        const before = read();
        const after = await format(before, { ...OPTIONS, filepath });
        // what was typed in the meantime is never overwritten
        if (after !== before && read() === before) {
            write(changedPart(before, after), before);
        }
    } catch (ex) {
        try {
            notify(element, ex);
        } catch (ex_) {
            report(ex_);
        }
    } finally {
        busy.delete(key);
    }
}

/**
 * Formats the content of an editor.
 *
 * @param {object} cm CodeMirror instance
 * @returns {Promise.<void>} settled when the editor has its formatted content, or was told why not
 */
async function formatEditor(cm) {
    const text = cm.getValue();
    const file = KIND_FILES.get(fileKind());
    // a code resource that is nothing but server-side scripts, as for an answer in JSON, is read
    // like the content of Content Builder: its own kind is only what the scripts write
    const isContent =
        !file || (SERVER_CODE.test(text) && text.replaceAll(SERVER_SCRIPT, '').trim() === '');
    if (!isContent && SERVER_CODE.test(text)) {
        // the formatters for JavaScript, CSS and JSON do not know AMPscript or server-side
        // scripts and would rearrange them as if they were part of the file
        try {
            notify(cm.getWrapperElement(), new Error(MIXED_MESSAGE));
        } catch (ex) {
            report(ex);
        }
        return;
    }
    await formatContent(
        cm,
        cm.getWrapperElement(),
        () => cm.getValue(),
        (change) => replace(cm, change),
        isContent ? undefined : file,
    );
}

/**
 * Reads what an editor that the extension drew itself says about being formatted.
 *
 * @param {object} cm CodeMirror instance
 * @returns {string | null} what it says; null for an editor of Marketing Cloud
 */
function ownMark(cm) {
    return cm.getWrapperElement().closest(OWN_EDITORS)?.getAttribute(OWN_EDITOR) ?? null;
}

/**
 * Tells whether an editor is one whose content may be formatted right now.
 *
 * @param {object} cm CodeMirror instance
 * @returns {boolean} true for an AMPscript editor on the page that can be edited, whose kind of file there is a formatter for and that, if the extension drew it itself, is one to format
 */
function canFormat(cm) {
    return (
        isInMode(cm) &&
        !cm.isReadOnly() &&
        cm.getWrapperElement().isConnected &&
        !UNFORMATTED_KINDS.has(fileKind()) &&
        (ownMark(cm) ?? OWN_FORMATTED) === OWN_FORMATTED
    );
}

/**
 * Creates a "format code" button.
 *
 * @param {Document} document document of the editor
 * @param {() => void} onClick what a click does
 * @returns {HTMLButtonElement} the button, not yet on the page
 */
function createButton(document, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sfmc-format-button';
    button.textContent = '{ }';
    button.title = `Format code (${SHORTCUT})`;
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', onClick);
    return button;
}

/**
 * Adds the "format code" button for an editor: next to Marketing Cloud's own editor buttons
 * where there are any, in the corner of the editor otherwise.
 *
 * @param {object} cm CodeMirror instance
 */
function addButton(cm) {
    const wrapper = cm.getWrapperElement();
    const document = wrapper.ownerDocument;
    const button = createButton(document, () => {
        if (canFormat(cm)) {
            formatEditor(cm);
        }
        cm.focus();
    });
    const toolbar = wrapper.closest(EDITOR_FRAME)?.querySelector(TOOLBAR);
    if (toolbar) {
        const item = document.createElement('li');
        item.className = 'toolbar-button sfmc-format-item';
        item.append(button);
        toolbar.append(item);
    } else {
        button.classList.add('sfmc-format-floating');
        wrapper.append(button);
    }
}

/**
 * Tells whether an element is on show, as opposed to being part of a hidden view.
 *
 * @param {Element} element element of the page
 * @returns {boolean} true if it takes up room on the page
 */
function isOnShow(element) {
    return element.getClientRects().length > 0;
}

/**
 * Finds a button of Marketing Cloud that is on show.
 *
 * @param {string} [selector] which button; the Save button if left out
 * @returns {Element | undefined} the button
 */
function saveButton(selector = SAVE_BUTTON) {
    return [...document.querySelectorAll(selector)].find((button) => isOnShow(button));
}

/**
 * Tells whether the page says when it has taken over the content of an editor.
 *
 * @param {object} cm CodeMirror instance
 * @returns {boolean} true for an editor of Content Builder on a page that is listened to
 */
function isAnnounced(cm) {
    return state.isListening && Boolean(cm.getWrapperElement().closest(TAKING_EDITOR));
}

/**
 * Notes that the page has taken over the content of the editors inside an element, and lets
 * go on what waited for that.
 *
 * @param {Element} element the element the page said it about
 */
function noteTaken(element) {
    for (const cm of editorsOnPage()) {
        if (!element.contains?.(cm.getWrapperElement())) {
            continue;
        }
        const waiting = untaken.get(cm) ?? [];
        untaken.delete(cm);
        for (const goOn of waiting) {
            goOn();
        }
    }
}

/**
 * Starts to keep track of whether the page has taken over what an editor shows: a change makes
 * the content one the page has yet to take over, the page's own event makes it taken over.
 *
 * @param {object} cm CodeMirror instance
 */
function watchTaking(cm) {
    const { jQuery } = globalThis;
    if (typeof jQuery === 'function' && !state.isListening) {
        // the page tells it through its jQuery only; no event of the browser comes with it
        jQuery(document).on(TAKEN_EVENT, (event) => {
            try {
                noteTaken(event.target);
            } catch (ex) {
                report(ex);
            }
        });
        state.isListening = true;
    }
    cm.on('change', () => {
        if (!untaken.has(cm) && isAnnounced(cm)) {
            untaken.set(cm, new Set());
        }
    });
}

/**
 * Waits until the page has taken over what an editor shows. An editor the page stays silent
 * about is not waited for again.
 *
 * @param {object} cm CodeMirror instance
 * @returns {Promise.<void>} settled at once if there is nothing to wait for
 */
async function taken(cm) {
    const waiting = untaken.get(cm);
    if (!waiting) {
        return;
    }
    const { promise, resolve } = Promise.withResolvers();
    waiting.add(resolve);
    const timer = setTimeout(() => {
        // whatever else waits for the same takeover has waited long enough as well
        if (untaken.get(cm) === waiting) {
            untaken.delete(cm);
        }
        for (const goOn of waiting) {
            goOn();
        }
    }, TAKE_TIME_LIMIT);
    await promise;
    clearTimeout(timer);
}

/**
 * Formats an editor of Marketing Cloud for a save, and waits until the page has what the editor
 * shows then.
 *
 * @param {object} cm CodeMirror instance
 * @returns {Promise.<boolean>} true if the page said that it has the content; false where it does not say such things
 */
async function formatForSave(cm) {
    await formatEditor(cm);
    if (!isAnnounced(cm)) {
        return false;
    }
    await taken(cm);
    return true;
}

/**
 * Formats the editors of the page and then lets the save go ahead that was held back for it.
 * Whatever happens to the formatting, the save is never lost: it does not wait for a formatter
 * that takes too long, and if the page has redrawn its button meanwhile, the new one is clicked.
 *
 * @param {(() => Promise.<boolean | void>)[]} formats each formats one editor, and gives true if it has also waited for the page to take the content over
 * @param {() => void} clickAgain clicks the save button that was held back
 */
async function formatThenSave(formats, clickAgain) {
    try {
        const haveTaken = await Promise.race([
            Promise.all(formats.map((formatOne) => formatOne())),
            new Promise((resolve) => setTimeout(resolve, FORMAT_TIME_LIMIT)),
        ]);
        if (!haveTaken?.every((hasTaken) => hasTaken === true)) {
            await new Promise((resolve) => setTimeout(resolve, SETTLE_TIME));
        }
    } catch (ex) {
        report(ex);
    }
    state.isPending = false;
    state.isSaving = true;
    try {
        clickAgain();
    } finally {
        state.isSaving = false;
    }
}

/**
 * Handles a click on the page: with "format on save" switched on, a click on one of Marketing
 * Cloud's buttons that save or take the content over is held back until the editors are
 * formatted.
 *
 * @param {MouseEvent} event the click
 * @param {string} selector which buttons are meant
 * @param {(button: Element) => (() => Promise.<boolean | void>)[]} formatsFor what formats the editors the button is about, one each; none lets the click through
 * @param {(button: Element) => void} clickAgain clicks the button once the editors are formatted
 */
function formatBeforeClick(event, selector, formatsFor, clickAgain) {
    try {
        if (
            state.isSaving ||
            document.documentElement.getAttribute(ON_SAVE_ATTRIBUTE) !== 'on' ||
            !(event.target instanceof Element)
        ) {
            return;
        }
        const button = event.target.closest(selector);
        if (!button) {
            return;
        }
        // a save is being held back already; this click belongs to it and must not become a second save
        if (state.isPending) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        const formats = formatsFor(button);
        if (!formats.length) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        state.isPending = true;
        formatThenSave(formats, () => clickAgain(button));
    } catch (ex) {
        report(ex);
    }
}

/**
 * Holds a click on one of Content Builder's save buttons back until its editors are formatted.
 *
 * @param {MouseEvent} event the click
 */
function onClick(event) {
    formatBeforeClick(
        event,
        SAVE_BUTTONS,
        // only what the user sees is saved now; editors of hidden views are left alone. Looked up
        // on the page at the click, so an editor that was away and is back counts
        () =>
            [...editorsOnPage()]
                .filter(
                    (cm) => editors.has(cm) && canFormat(cm) && isOnShow(cm.getWrapperElement()),
                )
                .map((cm) => () => formatForSave(cm)),
        (button) => {
            const selector = `[data-action="${button.dataset.action}"]`;
            // "Save and Exit" sits in a menu that has closed again by now, so a hidden one will do
            const current = button.isConnected
                ? button
                : (saveButton(selector) ?? document.querySelector(selector));
            current?.click();
        },
    );
}

/**
 * Holds a click on the button that sends one of the extension's own forms back until the editors
 * of that form are formatted. A form that was left meanwhile, or whose button is switched off, is
 * not sent.
 *
 * @param {MouseEvent} event the click
 */
function onOwnClick(event) {
    formatBeforeClick(
        event,
        OWN_SAVE_BUTTON,
        (button) => {
            const form = button.closest('form');
            // looked up on the page at the click, so an editor that was away and is back counts
            return [...editorsOnPage()]
                .filter(
                    (cm) =>
                        ownEditors.has(cm) &&
                        canFormat(cm) &&
                        form?.contains(cm.getWrapperElement()),
                )
                .map((cm) => () => formatEditor(cm));
        },
        (button) => {
            if (button.isConnected && !button.disabled) {
                button.click();
            }
        },
    );
}

/**
 * Saves the content the way a click on Marketing Cloud's Save button does, once the page has
 * taken over what was typed last: the key is pressed right after typing, and a save that does
 * not wait would be one without the last words.
 *
 * @param {object} cm CodeMirror instance
 * @returns {unknown} CodeMirror's sign to go on with the key if there is no Save button
 */
function save(cm) {
    const button = saveButton();
    if (!button) {
        return cm.constructor.Pass;
    }
    if (!untaken.has(cm)) {
        button.click();
        return;
    }
    (async () => {
        try {
            await taken(cm);
            // the page may have redrawn its button meanwhile
            (button.isConnected ? button : saveButton())?.click();
        } catch (ex) {
            report(ex);
        }
    })();
    return;
}

/**
 * Formats an editor's content on Shift-Alt-F, as VS Code does; the key goes on to the editor
 * where there is nothing to format.
 *
 * @param {object} cm CodeMirror instance
 * @returns {unknown} CodeMirror's sign to go on with the key, or nothing
 */
function formatOnKey(cm) {
    if (!canFormat(cm)) {
        return cm.constructor.Pass;
    }
    formatEditor(cm);
    return;
}

/**
 * Sets up formatting for one editor: the button, Shift-Alt-F as in VS Code, and Ctrl-S or
 * Cmd-S for saving, which Marketing Cloud's editor does not have. An editor that the extension
 * drew itself keeps its own keys for saving, and gets nothing unless it is one to format.
 *
 * @param {object} cm CodeMirror instance
 */
function registerFormat(cm) {
    const own = ownMark(cm);
    if (own !== null) {
        if (own !== OWN_FORMATTED) {
            return;
        }
        ownEditors.add(cm);
        cm.addKeyMap({ 'Shift-Alt-F': formatOnKey });
        addButton(cm);
        return;
    }
    editors.add(cm);
    watchTaking(cm);
    cm.addKeyMap({ 'Shift-Alt-F': formatOnKey, 'Ctrl-S': save, 'Cmd-S': save });
    addButton(cm);
}

/**
 * Sets up formatting for one editor of Marketing Cloud Next's content editor, which only gets
 * the key: its page has buttons of its own, and formatting when saving is not offered there.
 *
 * @param {object} cm CodeMirror instance
 */
function registerFormatKey(cm) {
    cm.addKeyMap({ 'Shift-Alt-F': formatOnKey });
}

if (IS_NEXT) {
    watchEditors('format', [registerFormatKey]);
} else {
    // in the capture phase, so that the page has not acted on the click yet
    document.addEventListener('click', onClick, { capture: true });
    document.addEventListener('click', onOwnClick, { capture: true });
    watchEditors('format', [registerFormat]);
    // Automation Studio's script activity has another editor, Ace, which is formatted in the same way
    watchAceFormat({ formatContent, createButton, formatBeforeClick, isOnShow });
}
