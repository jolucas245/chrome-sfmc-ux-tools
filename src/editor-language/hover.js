/*
 * SFMC UX Tools — the box for a place in the code editor: what is wrong there, how to fix it,
 * and its documentation. It opens where the mouse rests, and at the cursor on Ctrl-. (Cmd-.).
 */
import { IS_NEXT, isInMode, nearbyElement, report } from './shared.js';
import { applyFix, fixesFor } from './quickfix.js';
import { checkNow, diagnosticsAt } from './diagnostics.js';
import { colour } from './colour.js';
import { createTooltip } from './tooltip.js';
import { hoverAt as findHover, isAmpscriptAt, isHandlebarsAt } from './core/lookup.js';
import { renderMarkdown } from './markdown.js';

export const SHOW_DELAY = 350;
// time to move the mouse from the code onto the box
export const HIDE_DELAY = 250;
// the rule of the language service for an AMPscript function that Marketing Cloud Next lacks
const UNSUPPORTED_IN_NEXT = 'sfmc/amp-no-mcn-unsupported';
// Marketing Cloud Next's own explanation of a place in the code, and the attribute the stylesheet
// hides it by while the mouse is on AMPscript, which the extension explains itself
const PAGE_TOOLTIP = 'es_block_builder-codeview-tooltip';
const PAGE_TOOLTIP_MUTED = 'data-sfmc-ux-tools-muted';

/**
 * Asks the language service what it knows about a place in the document.
 *
 * @param {object} cm CodeMirror instance
 * @param {{line: number, ch: number}} place line and column of a character
 * @returns {object | null} hover of the language service, or null if it has nothing to say
 */
function hoverAt(cm, place) {
    return findHover(cm.getValue(), { line: place.line, character: place.ch });
}

/**
 * Finds the character under the mouse.
 *
 * @param {object} cm CodeMirror instance
 * @param {{clientX: number, clientY: number}} point where the mouse is
 * @returns {{line: number, ch: number} | null} the character, or null beside the text
 */
export function characterAt(cm, point) {
    const found = cm.coordsChar({ left: point.clientX, top: point.clientY }, 'window');
    if (found.outside) {
        return null;
    }
    // the nearest gap between two characters is reported; the mouse is on the character before it
    // when it is left of that gap
    const ch = found.xRel < 0 ? found.ch - 1 : found.ch;
    return ch < 0 ? null : { line: found.line, ch };
}

/**
 * Lists what is wrong at a place, each problem with the fixes the language service offers. The
 * content is checked first, so that problems and fixes belong to the text as it is now.
 *
 * @param {object} cm CodeMirror instance
 * @param {{line: number, ch: number}} place line and column of a character
 * @returns {object[]} problems from `diagnosticsAt`, each with its `fixes`
 */
function problemsAt(cm, place) {
    checkNow(cm);
    const text = cm.getValue();
    const canFix = !cm.isReadOnly();
    return diagnosticsAt(cm, place).map(({ diagnostic, ...problem }) => {
        try {
            return { ...problem, fixes: canFix ? fixesFor(text, diagnostic) : [] };
        } catch (ex) {
            report(ex);
            return { ...problem, fixes: [] };
        }
    });
}

/**
 * Builds the content of the box: first what is wrong at the place and how to fix it, then the
 * documentation of the place.
 *
 * @param {Document} document document of the editor
 * @param {object[]} problems errors and warnings at the place, each with its `fixes`
 * @param {string | undefined} markdown documentation of the language service
 * @param {(fix: object) => void} onFix called with the fix the user chose
 * @param {(code: string, language: string) => Node | null} colourCode colours a code block of the documentation the way the editor does
 * @returns {DocumentFragment} what to show
 */
export function renderBox(document, problems, markdown, onFix, colourCode) {
    const result = document.createDocumentFragment();
    for (const { severity, message, code, address, fixes } of problems) {
        const element = document.createElement('p');
        element.className = `sfmc-problem sfmc-problem-${severity}`;
        element.textContent = message;
        if (code) {
            const rule = document.createElement(address.startsWith('https://') ? 'a' : 'span');
            rule.className = 'sfmc-problem-rule';
            rule.textContent = code;
            if (rule.tagName === 'A') {
                rule.href = address;
                rule.target = '_blank';
                rule.rel = 'noopener noreferrer';
            }
            element.append(' ', rule);
        }
        for (const fix of fixes) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sfmc-fix';
            button.textContent = fix.title;
            button.addEventListener('click', () => onFix(fix));
            element.append(button);
        }
        result.append(element);
    }
    if (markdown) {
        result.append(renderMarkdown(document, markdown, colourCode));
    }
    return result;
}

/**
 * Sets up the box for one editor.
 *
 * @param {object} cm CodeMirror instance
 * @returns {() => void} takes the box away
 */
export function registerHover(cm) {
    const wrapper = cm.getWrapperElement();
    const tooltip = createTooltip(wrapper.ownerDocument, 'sfmc-hover', wrapper);
    const timers = { show: undefined, hide: undefined };
    let shown = '';
    // the content the fixes on show were worked out for
    let fixedText = '';
    // Marketing Cloud Next's own explanation: it explains fewer AMPscript functions and each in
    // one sentence, so it is hidden while the mouse is on AMPscript, and on Handlebars wherever
    // the extension has something to say
    const pageTooltip = IS_NEXT ? nearbyElement(wrapper, PAGE_TOOLTIP) : null;

    /**
     * Hides the page's own explanation, or lets it show again.
     *
     * @param {boolean} isMuted true to hide it
     */
    function mute(isMuted) {
        try {
            pageTooltip?.()?.toggleAttribute(PAGE_TOOLTIP_MUTED, isMuted);
        } catch (ex) {
            report(ex);
        }
    }

    // the place that was asked about last, and whether the extension explains it
    const ours = { key: '', is: false };
    /**
     * Tells whether the extension explains a place in place of the page: all of AMPscript, and
     * of Handlebars what it knows, such as a helper, or objects to. A field of a contact, which
     * only the page knows, is left to the page.
     *
     * @param {{line: number, ch: number}} place line and column of a character
     * @returns {boolean} true if the page's own explanation is hidden there
     */
    function isOurs(place) {
        // asked on every move of the mouse: the answer for a place holds until the content changes
        const key = `${cm.changeGeneration()}:${place.line}:${place.ch}`;
        if (ours.key !== key) {
            const position = { line: place.line, character: place.ch };
            const text = cm.getValue();
            ours.key = key;
            ours.is = isAmpscriptAt(text, position)
                ? true
                : isHandlebarsAt(text, position) &&
                  (Boolean(hoverAt(cm, place)?.contents?.value) ||
                      problemsAt(cm, place).length > 0);
        }
        return ours.is;
    }

    const hide = () => {
        clearTimeout(timers.show);
        clearTimeout(timers.hide);
        shown = '';
        tooltip.hide();
    };
    const hideSoon = () => {
        clearTimeout(timers.show);
        clearTimeout(timers.hide);
        timers.hide = setTimeout(hide, HIDE_DELAY);
    };
    const fix = (chosen) => {
        try {
            hide();
            // a fix only fits the content it was worked out for, in an editor that can be edited
            if (!cm.isReadOnly() && cm.getValue() === fixedText) {
                applyFix(cm, chosen);
            }
            cm.focus();
        } catch (ex) {
            report(ex);
        }
    };
    /**
     * Shows the box for a place, or takes it away if there is nothing to say about the place.
     *
     * @param {{line: number, ch: number} | null} place line and column of a character
     * @param {boolean} [isForFixes] true to only show it if there is something to fix
     * @returns {boolean} true if the box is shown
     */
    function didShowAt(place, isForFixes = false) {
        const isUsable = place && isInMode(cm) && wrapper.isConnected;
        const problems = isUsable ? problemsAt(cm, place) : [];
        // what Marketing Cloud Next cannot run is only said to be so, not explained
        const isUnsupported = IS_NEXT && problems.some(({ code }) => code === UNSUPPORTED_IN_NEXT);
        const hover = !isUsable || isForFixes || isUnsupported ? null : hoverAt(cm, place);
        const markdown = hover?.contents?.value;
        const hasContent = isForFixes
            ? problems.some((problem) => problem.fixes.length > 0)
            : markdown || problems.length > 0;
        if (!hasContent) {
            hide();
            return false;
        }
        const start = hover?.range?.start;
        const anchor = start ? { line: start.line, ch: start.character } : place;
        const key = JSON.stringify([anchor, problems, markdown]);
        if (key !== shown || !tooltip.isShown()) {
            shown = key;
            fixedText = cm.getValue();
            tooltip.show(
                renderBox(wrapper.ownerDocument, problems, markdown, fix, (code, language) =>
                    colour(cm, code, language),
                ),
                cm.charCoords(anchor, 'window'),
            );
        }
        return true;
    }
    const showAtCursor = () => {
        try {
            const cursor = cm.getCursor();
            // the cursor stands between two characters; a problem may end right before it
            const places = [cursor, { line: cursor.line, ch: cursor.ch - 1 }].filter(
                (place) => place.ch >= 0,
            );
            if (cm.isReadOnly() || places.every((place) => !didShowAt(place, true))) {
                return cm.constructor.Pass;
            }
            tooltip.element.querySelector('.sfmc-fix')?.focus();
        } catch (ex) {
            report(ex);
        }
        return;
    };

    wrapper.addEventListener('mousemove', (event) => {
        clearTimeout(timers.show);
        clearTimeout(timers.hide);
        // not while something is dragged or selected with the mouse
        if (event.buttons) {
            return;
        }
        const point = { clientX: event.clientX, clientY: event.clientY };
        if (pageTooltip) {
            // at once, before the page shows its explanation
            try {
                const place = characterAt(cm, point);
                mute(Boolean(place) && isOurs(place));
            } catch (ex) {
                report(ex);
            }
        }
        timers.show = setTimeout(() => {
            try {
                didShowAt(characterAt(cm, point));
            } catch (ex) {
                report(ex);
            }
        }, SHOW_DELAY);
    });
    wrapper.addEventListener('mouseleave', () => {
        hideSoon();
        // the mouse may be on its way into the box, which stands for the page's explanation
        if (!tooltip.isShown()) {
            mute(false);
        }
    });
    wrapper.addEventListener('mousedown', hide);
    tooltip.element.addEventListener('mouseenter', () => clearTimeout(timers.hide));
    tooltip.element.addEventListener('mouseleave', () => {
        hideSoon();
        mute(false);
    });
    // with the keyboard in the box: Escape closes it and hands the focus back
    tooltip.element.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
            return;
        }

        // the key is used up: a dialog around the editor stays open
        event.preventDefault();
        event.stopPropagation();
        hide();
        cm.focus();
    });
    cm.on('keydown', hide);
    cm.on('scroll', hide);
    cm.on('change', hide);
    cm.on('swapDoc', hide);
    // the key of VS Code for quick fixes; it goes on to the editor where there is nothing to fix
    cm.addKeyMap({ 'Ctrl-.': showAtCursor, 'Cmd-.': showAtCursor });
    return () => {
        hide();
        mute(false);
    };
}
