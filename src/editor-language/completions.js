/*
 * SFMC UX Tools — completions for Marketing Cloud's code editor.
 *
 * The suggestions come from sfmc-language-lsp; this file connects it to CodeMirror 5's hint popup.
 */
import { AMPSCRIPT, IS_NEXT, isInMode, languageAt, nearbyElement, report } from './shared.js';
import { completionsAt, isTypingName } from './core/completions.js';
import { coveringDialog, createIcon } from './tooltip.js';

const TRIGGER_DELAY = 100;
const TRIGGER_CHARACTER = /[\w@.$]$/;
// marks the list as the extension's; Marketing Cloud Next shows lists of its own
const LIST_CLASS = 'sfmc-hints';
// the extension's icon in the corner of that list, and what it says under the mouse
const ICON_CLASS = 'sfmc-hints-icon';
const ICON_SAYS = 'SFMC UX Tools: added this list of suggestions for AMPscript and Handlebars.';
// Marketing Cloud Next's own suggestions; its `isOpen` tells whether they are on show
const PAGE_PICKER = 'es_block_builder-content-resource-picker';
const timers = new WeakMap();
// per editor, what finds the page's own suggestions
const pickers = new WeakMap();

/**
 * Tells whether a place is left to Marketing Cloud Next's own suggestions: while they are on
 * show, and in everything but AMPscript and Handlebars, which is the scripts of the browser.
 *
 * @param {object} cm CodeMirror instance
 * @param {{line: number, ch: number}} cursor where the cursor is
 * @returns {boolean} true if the extension suggests nothing there
 */
function isLeftToPage(cm, cursor) {
    if (!pickers.has(cm)) {
        pickers.set(cm, nearbyElement(cm.getWrapperElement(), PAGE_PICKER));
    }
    if (pickers.get(cm)()?.isOpen) {
        return true;
    }
    const before = cm.getValue().slice(0, cm.indexFromPos(cursor));
    return languageAt(before, before.length) !== AMPSCRIPT;
}

/**
 * Draws one entry of the popup: the name, followed by a short muted description.
 *
 * @param {HTMLElement} element list entry to fill
 * @param {string} label name of the suggestion
 * @param {string} detail description, may be empty
 */
function render(element, label, detail) {
    try {
        const list = element.parentNode;
        list?.classList.add(LIST_CLASS);
        if (IS_NEXT && list) {
            // after the entry that was added last: the hint addon finds its entries by their
            // place in the list, counted from the first
            list.append(
                list.querySelector(`:scope > .${ICON_CLASS}`) ??
                    createIcon(element.ownerDocument, ICON_CLASS, ICON_SAYS),
            );
        }
        element.textContent = label;
        if (detail) {
            const note = element.ownerDocument.createElement('span');
            note.className = 'sfmc-hint-detail';
            note.textContent = detail;
            element.append(note);
        }
    } catch (ex) {
        report(ex);
    }
}

/**
 * CodeMirror hint function: asks the language service what fits at the cursor. The hint addon
 * asks again whenever the content or the cursor changes and closes the popup on an empty answer,
 * so the popup also goes away once Marketing Cloud Next shows its own suggestions.
 *
 * @param {object} cm CodeMirror instance
 * @returns {object | null} hints and the range they replace, or null if there are none
 */
function hint(cm) {
    try {
        const cursor = cm.getCursor();
        if (IS_NEXT && isLeftToPage(cm, cursor)) {
            return null;
        }
        const found = completionsAt(cm.getValue(), { line: cursor.line, character: cursor.ch });
        if (!found) {
            return null;
        }
        const data = {
            list: found.items.map(({ label, text, detail, item }) => ({
                text,
                displayText: label,
                render: (element) => render(element, label, detail),
                ...(item && { item }),
            })),
            from: { line: found.from.line, ch: found.from.character },
            to: { line: found.to.line, ch: found.to.character },
        };
        return data;
    } catch (ex) {
        report(ex);
        return null;
    }
}

/**
 * Opens the popup, if the page's CodeMirror has the hint addon, the editor can be edited and
 * there is something to suggest at the cursor.
 *
 * @param {object} cm CodeMirror instance
 * @returns {boolean} true if the hint addon was asked to show the suggestions
 */
function didShow(cm) {
    try {
        const showHint = cm.constructor.showHint;
        if (
            typeof showHint !== 'function' ||
            !isInMode(cm) ||
            cm.isReadOnly() ||
            cm.somethingSelected() ||
            // asked first, because the hint addon stays active after an empty answer
            !hint(cm)
        ) {
            return false;
        }
        showHint(cm, hint, {
            completeSingle: false,
            // a dialog that is open covers everything that is not inside of it; without one
            // the list goes to the end of the page, as the hint addon has it
            container: coveringDialog(cm.getWrapperElement()),
        });
        return true;
    } catch (ex) {
        report(ex);
        return false;
    }
}

/**
 * Opens the popup after typing has paused, unless one is open already or the cursor is in a
 * string or comment.
 *
 * @param {object} cm CodeMirror instance
 */
function showAfterTyping(cm) {
    try {
        const cursor = cm.getCursor();
        if (
            cm.state.completionActive ||
            !isTypingName(
                cm.getValue(),
                { line: cursor.line, character: cursor.ch },
                cm.getTokenTypeAt(cursor) ?? '',
            )
        ) {
            return;
        }
    } catch (ex) {
        report(ex);
        return;
    }
    didShow(cm);
}

/**
 * Handles typed input: schedules the popup after a character that can be part of a name.
 *
 * @param {object} cm CodeMirror instance
 * @param {object} change the change CodeMirror reports
 */
function onInputRead(cm, change) {
    clearTimeout(timers.get(cm));
    if (change?.origin === 'paste' || !TRIGGER_CHARACTER.test(change?.text?.at(-1) ?? '')) {
        return;
    }
    timers.set(
        cm,
        setTimeout(() => showAfterTyping(cm), TRIGGER_DELAY),
    );
}

/**
 * Sets up completions for one editor: Ctrl-Space, and the popup while typing.
 *
 * @param {object} cm CodeMirror instance
 */
export function registerCompletions(cm) {
    // the key goes on to the editor's own handling whenever there is nothing for us to do
    cm.addKeyMap({
        'Ctrl-Space': (editor) => (didShow(editor) ? undefined : editor.constructor.Pass),
    });
    cm.on('inputRead', onInputRead);
}
