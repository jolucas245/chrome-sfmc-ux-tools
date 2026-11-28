/*
 * SFMC UX Tools — what the language features of the code editor have in common.
 */
import { DEFAULT_SETTINGS, extractScriptBodies, getScriptRegions } from 'sfmc-language-lsp';

import { IS_NEXT, JAVASCRIPT_FILE, fileKind } from './editors.js';

export { IS_NEXT, isInMode, nearbyElement, report } from './editors.js';

// what the language service is told about the page, decided once per page: Marketing Cloud Next
// has Handlebars and only part of AMPscript; Marketing Cloud Engagement is the service's default
export const SETTINGS = IS_NEXT
    ? { ...DEFAULT_SETTINGS, targetPlatform: 'next' }
    : DEFAULT_SETTINGS;

// an opening or closing script tag
const SCRIPT_TAG = /<\/?script\b[^>]*>/gi;

export const AMPSCRIPT = 'ampscript';
export const SSJS = 'ssjs';
export const JAVASCRIPT = 'javascript';
// the language service has no name for a whole file; like VS Code's "sfmc" documents it is read as AMPscript
export const DOCUMENT_URI = 'inmemory://editor';
export const BROWSER_KINDS = ['browser-classic', 'browser-module'];
// an opening delimiter and what closes it; inside one, AMPscript wins over a browser script around it
// the last two are those of Marketing Cloud Next, which the language server gives way to as well
const AMPSCRIPT_DELIMITERS = [
    ['%%[', ']%%'],
    ['%%=', '=%%'],
    ['{{', '}}'],
    ['{!$', '}'],
];

/**
 * Tells whether a text ends inside a Handlebars expression.
 *
 * @param {string} before text up to a place, such as a line up to the cursor
 * @returns {boolean} true after an opening `{{` that is not closed before the place
 */
export function isInHandlebars(before) {
    return before.lastIndexOf('{{') > before.lastIndexOf('}}');
}

/**
 * Tells which language a place in the document belongs to, the way the language server of the
 * VS Code extension routes its requests: the body of a server-side script is SSJS; the body of
 * any other script is the browser's JavaScript, unless an AMPscript block is open there;
 * everything else is AMPscript, which includes the HTML around it.
 *
 * @param {string} text whole document
 * @param {number} offset place in the document
 * @returns {string} AMPSCRIPT, SSJS or JAVASCRIPT
 */
export function languageAt(text, offset) {
    const region = getScriptRegions(text).find(
        (item) => offset >= item.bodyStart && offset <= item.bodyEnd,
    );
    if (region?.kind === SSJS) {
        return SSJS;
    }
    // a JavaScript file is one browser script as a whole, without a script tag around it
    const isScriptFile = !region && fileKind() === JAVASCRIPT_FILE;
    if (!isScriptFile && (!region || !BROWSER_KINDS.includes(region.kind))) {
        return AMPSCRIPT;
    }
    const before = text.slice(0, offset);
    // the delimiters of Marketing Cloud Next are plain JavaScript in a file, as in "[{{a: 1}}]"
    const delimiters = isScriptFile ? AMPSCRIPT_DELIMITERS.slice(0, 2) : AMPSCRIPT_DELIMITERS;
    const isInBlock = delimiters.some(
        ([open, close]) => before.lastIndexOf(open) > before.lastIndexOf(close),
    );
    return isInBlock ? AMPSCRIPT : JAVASCRIPT;
}

/**
 * Blanks everything but the scripts of some kinds; lines and columns stay as they are.
 *
 * @param {string} text whole document
 * @param {string[]} kinds kinds of scripts to keep, as the language service names them
 * @returns {string} text of the same length that only contains those scripts
 */
export function scriptsOnly(text, kinds) {
    const isScriptFile =
        fileKind() === JAVASCRIPT_FILE && kinds.some((kind) => BROWSER_KINDS.includes(kind));
    if (!isScriptFile) {
        return extractScriptBodies(text, kinds).text;
    }
    // the whole file is the browser's, except for the server-side scripts in it and their tags
    const server = extractScriptBodies(text, [SSJS]).text;
    const tags = text.replaceAll(SCRIPT_TAG, (tag) => ' '.repeat(tag.length));
    let browser = '';
    let start = 0;
    // every run of server-side code is blanked; the text keeps its length
    for (const run of server.matchAll(/\S+/g)) {
        browser += tags.slice(start, run.index) + ' '.repeat(run[0].length);
        start = run.index + run[0].length;
    }
    return browser + tags.slice(start);
}

/**
 * Blanks everything but the server-side scripts, so that the SSJS half of the language service
 * sees the same lines and columns as the editor.
 *
 * @param {string} text whole document
 * @returns {string} text of the same length that only contains the SSJS
 */
export function ssjsOnly(text) {
    return scriptsOnly(text, [SSJS]);
}
