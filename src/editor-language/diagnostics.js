/*
 * SFMC UX Tools — errors and warnings: what the language service objects to is underlined in
 * the code editor, and resting the mouse on it says why.
 */
import { isInMode, report } from './shared.js';
import { ERROR, WARNING, check, checkTypes, removedScripts } from './core/diagnostics.js';
import { READY_EVENT, hasTypescript } from './typescript.js';

export const CHECK_DELAY = 500;
// severities of the language service, most serious first
export const SEVERITY_NAMES = { 1: 'error', 2: 'warning', 3: 'info', 4: 'info' };
const found = new WeakMap();
// what each editor's content was when it was last checked
const checked = new WeakMap();
// what TypeScript found in each editor, and the content it was found in
const typed = new WeakMap();
const state = { isWaitingForTypescript: false };
// Content Builder marks the element around its editor with the type of what is edited, and with
// each type above that one: "editor-mode-htmlemail editor-mode-message editor-mode-asset"
const TYPED_EDITOR = '.cloud-editor';
// the types whose content loses its scripts for the browser when it is saved, and how serious
// that is: an email is never shown with them, a block may have been meant for a CloudPage
const SCRIPT_LOSERS = [
    ['editor-mode-message', ERROR],
    ['editor-mode-template', ERROR],
    ['editor-mode-block', WARNING],
];

/**
 * Tells how serious a script for the browser is in what an editor shows.
 *
 * @param {object} cm CodeMirror instance
 * @returns {number} ERROR or WARNING where Marketing Cloud removes such a script on save; 0 where it keeps it, as in CloudPages, and where the page does not say what is edited
 */
function scriptLoss(cm) {
    // the outermost one says what is saved: a block that is edited inside an email is part of
    // the email, one inside a landing page part of the page
    let outer = null;
    let inner = cm.getWrapperElement().closest(TYPED_EDITOR);
    while (inner) {
        outer = inner;
        inner = inner.parentElement?.closest(TYPED_EDITOR) ?? null;
    }
    const loser = SCRIPT_LOSERS.find(([name]) => outer?.classList.contains(name));
    return loser ? loser[1] : 0;
}

/**
 * Converts a place of the language service into one of CodeMirror.
 *
 * @param {{line: number, character: number}} position place of the language service
 * @returns {{line: number, ch: number}} place of CodeMirror
 */
function toPlace(position) {
    return { line: position.line, ch: position.character };
}

/**
 * Checks an editor's content and underlines what was found. TypeScript's check takes long enough
 * to be felt, so it only runs when asked for, which is once typing has paused; otherwise what it
 * found last is kept as long as it belongs to the content as it is.
 *
 * @param {object} cm CodeMirror instance
 * @param {boolean} isWithTypes true to ask TypeScript as well
 */
function update(cm, isWithTypes) {
    try {
        const now = {
            doc: cm.getDoc(),
            generation: cm.changeGeneration(),
            isInMode: isInMode(cm),
            scriptLoss: scriptLoss(cm),
        };
        const isSame = (last) =>
            last?.doc === now.doc &&
            last.generation === now.generation &&
            last.isInMode === now.isInMode &&
            last.scriptLoss === now.scriptLoss;
        const types = typed.get(cm);
        const isTypesCurrent = isSame(types) && types.hasTypescript === hasTypescript();
        // nothing to do for content that was checked already: the same document, unchanged, in the
        // same mode, and with or without TypeScript as before
        if (isSame(checked.get(cm)) && (isTypesCurrent || !isWithTypes)) {
            return;
        }
        checked.set(cm, now);
        const list = [];
        if (now.isInMode) {
            const text = cm.getValue();
            const known = check(text);
            let further = isSame(types) ? types.list : [];
            if (isWithTypes && !isTypesCurrent) {
                further = checkTypes(text, known);
            }
            // each check limits what it reports by itself; a limit over all of them together
            // would let the many findings of one language hide those of the other
            list.push(...known, ...further);
            if (now.scriptLoss) {
                list.push(...removedScripts(text, now.scriptLoss));
            }
            if (isWithTypes) {
                typed.set(cm, { ...now, hasTypescript: hasTypescript(), list: further });
            }
        } else if (isWithTypes) {
            typed.set(cm, { ...now, hasTypescript: hasTypescript(), list: [] });
        }
        cm.operation(() => {
            const old = found.get(cm) ?? [];
            for (const { mark } of old) {
                mark.clear();
            }
            const entries = list.map((diagnostic) => {
                const from = toPlace(diagnostic.range.start);
                let to = toPlace(diagnostic.range.end);
                // something has to carry the underline
                if (from.line === to.line && from.ch === to.ch) {
                    // the character after the place, or the one before it at the end of a line
                    if (to.ch < cm.getLine(to.line).length) {
                        to = { line: to.line, ch: to.ch + 1 };
                    } else {
                        from.ch = Math.max(0, from.ch - 1);
                    }
                }
                const severity = SEVERITY_NAMES[diagnostic.severity] ?? SEVERITY_NAMES[1];
                const mark = cm.markText(from, to, {
                    className: `sfmc-diagnostic sfmc-diagnostic-${severity}`,
                });
                return { mark, diagnostic, severity };
            });
            found.set(cm, entries);
        });
    } catch (ex) {
        report(ex);
    }
}

/**
 * Checks an editor's content at once, for those who need what is found to fit the text as it
 * is now, without waiting for typing to pause. TypeScript is not asked: what it found is shown
 * while it fits the content, and found again once typing has paused.
 *
 * @param {object} cm CodeMirror instance
 */
export function checkNow(cm) {
    update(cm, false);
}

/**
 * Lists what was found at a character of an editor.
 *
 * @param {object} cm CodeMirror instance
 * @param {{line: number, ch: number}} place line and column of the character
 * @returns {{severity: string, message: string, code: string, address: string, diagnostic: object}[]} what to tell about that place, each with the diagnostic of the language service it comes from
 */
export function diagnosticsAt(cm, place) {
    const result = [];
    const entries = found.get(cm) ?? [];
    for (const { mark, diagnostic, severity } of entries) {
        const range = mark.find();
        if (
            range &&
            cm.indexFromPos(range.from) <= cm.indexFromPos(place) &&
            cm.indexFromPos(place) < cm.indexFromPos(range.to)
        ) {
            result.push({
                severity,
                message: String(diagnostic.message),
                code: String(diagnostic.code ?? ''),
                address: String(diagnostic.codeDescription?.href ?? ''),
                diagnostic,
            });
        }
    }
    return result;
}

/**
 * Checks the editors of the page again once the TypeScript script has arrived, which may be
 * after their first check.
 */
function recheckWithTypescript() {
    if (state.isWaitingForTypescript || hasTypescript()) {
        return;
    }
    state.isWaitingForTypescript = true;
    document.addEventListener(
        READY_EVENT,
        () => {
            // later, not while the TypeScript script that says so is still starting
            setTimeout(() => {
                try {
                    for (const { CodeMirror: cm } of document.querySelectorAll('.CodeMirror')) {
                        // only those that were checked here before
                        if (cm && checked.has(cm)) {
                            update(cm, true);
                        }
                    }
                } catch (ex) {
                    report(ex);
                }
            }, 0);
        },
        { once: true },
    );
}

/**
 * Sets up errors and warnings for one editor: checked now and whenever typing pauses.
 *
 * @param {object} cm CodeMirror instance
 */
export function registerDiagnostics(cm) {
    recheckWithTypescript();
    let timer;
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => update(cm, true), CHECK_DELAY);
    };
    cm.on('change', schedule);
    // a change of the mode may make this an editor for something else
    cm.on('optionChange', schedule);
    // another document in the same editor is other content
    cm.on('swapDoc', schedule);
    schedule();
}
