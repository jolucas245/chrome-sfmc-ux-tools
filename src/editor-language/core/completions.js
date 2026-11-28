/*
 * SFMC UX Tools — completions for a place in a document, without an editor. The suggestions come
 * from sfmc-language-lsp.
 */
import { sfmcLanguageService } from 'sfmc-language-lsp';
import {
    AMPSCRIPT,
    BROWSER_KINDS,
    DOCUMENT_URI,
    IS_NEXT,
    JAVASCRIPT,
    SETTINGS,
    SSJS,
    isInHandlebars,
    languageAt,
    scriptsOnly,
    ssjsOnly,
} from '../shared.js';
import { lineAt, offsetAt } from './text.js';
import { askTypescript } from '../typescript.js';

const DETAIL_LENGTH = 60;
// the typed start of an AMPscript name, including the @ or @@ of a variable
const WORD_BEFORE_CURSOR = /@{0,2}\w*$/;
// what starts a Handlebars helper that has a block, as in "{{#if"
const BLOCK_SIGN = '#';
// the typed start of an SSJS name with the objects it belongs to, like "Platform.Function.Loo"
const CHAIN_BEFORE_CURSOR = /(?:[\w$]+\.)*[\w$]*$/;
// the typed start of a plain JavaScript name
const NAME_BEFORE_CURSOR = /[\w$]*$/;
const QUIET_STYLES = new Map([
    [AMPSCRIPT, /\bsfmc-(?:string|comment)\b/],
    [SSJS, /\b(?:string|comment)\b/],
    [JAVASCRIPT, /\b(?:string|comment)\b/],
]);
// what may end the typed text for the popup to open by itself; a dot only continues a name in SSJS
const TYPED_END = new Map([
    [AMPSCRIPT, /[\w@]$/],
    [SSJS, /[\w$.]$/],
    [JAVASCRIPT, /[\w$]$/],
]);
// comments and strings, whose words are no names
const JAVASCRIPT_TEXT =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
// a name that is not the member of something
const JAVASCRIPT_NAME = /(?<![\w$.])[A-Za-z_$][\w$]*/g;
// the words every version of JavaScript has, SSJS included
const KEYWORDS = [
    'break',
    'case',
    'catch',
    'continue',
    'default',
    'delete',
    'do',
    'else',
    'false',
    'finally',
    'for',
    'function',
    'if',
    'in',
    'instanceof',
    'new',
    'null',
    'return',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'undefined',
    'var',
    'void',
    'while',
    'with',
];
// what only the browser understands; SSJS rejects these
const BROWSER_KEYWORDS = [
    'async',
    'await',
    'class',
    'const',
    'export',
    'extends',
    'import',
    'let',
    'of',
    'static',
    'super',
    'yield',
];
const BROWSER_GLOBALS = [
    'Array',
    'Boolean',
    'Date',
    'Error',
    'JSON',
    'Map',
    'Math',
    'Number',
    'Object',
    'Promise',
    'RegExp',
    'Set',
    'String',
    'Symbol',
    'clearInterval',
    'clearTimeout',
    'console',
    'decodeURIComponent',
    'document',
    'encodeURIComponent',
    'fetch',
    'isNaN',
    'localStorage',
    'location',
    'navigator',
    'parseFloat',
    'parseInt',
    'sessionStorage',
    'setInterval',
    'setTimeout',
    'window',
];
// snippet syntax of the language service: $1, ${1} or ${1:name}
const PLACEHOLDER = /\$(?:\d+|\{\d+(?::[^}]*)?\})/;
// a named placeholder of a snippet, which is how the language service lists a function's parameters
const PARAMETER = /\$\{\d+:([^}]*)\}/g;
const KIND_FUNCTION = 3;
// method, function, constructor and class: described by category and parameters
const CALLABLE_KINDS = new Set([2, KIND_FUNCTION, 4, 7]);
const KIND_NAMES = { 3: 'function', 6: 'variable', 14: 'keyword' };
// how a name is described that only leads on to its members, like "Platform.Function"
const OBJECT_DETAIL = 'object';
// a member access on a dotted name, with what is typed of the member: "de.Rows.Ad"
const RECEIVER_CHAIN = /((?:[\w$]+\s*\.\s*)*[\w$]+)\s*\.\s*[\w$]*$/;
// a member access on any expression, with what is typed of the member
const MEMBER_BEFORE_CURSOR = /\.([\w$]*)$/;
// how members are described that the catalogue does not know
const MEMBER_KIND_NAMES = { 2: 'method', 3: 'function', 5: 'field', 6: 'variable', 10: 'property' };
// the members TypeScript found last, and the document up to their dot, which they belong to
const lastMembers = { upToDot: undefined, items: null };

/**
 * Gives the description the language service has for an item, or the kind of the item.
 *
 * @param {object} item completion item of the language service
 * @returns {string} description, may be empty
 */
function describe(item) {
    return String(item.detail ?? KIND_NAMES[item.kind] ?? '');
}

/**
 * Describes something that can be called by its category and the names of its parameters. The
 * language service writes the category as "(Category) Name"; the name is left out, as the entry
 * starts with it.
 *
 * @param {object} item completion item of a function, method or class
 * @returns {string} for example "Data Extension · dataObject, returnColumn"
 */
function signature(item) {
    const detail = describe(item);
    const category = detail.startsWith('(') ? detail.slice(1, detail.indexOf(')')) : '';
    const parameters = String(item.insertText ?? '')
        .matchAll(PARAMETER)
        .map((match) => match[1])
        .toArray()
        .join(', ');
    // without a snippet, the description may be the call itself, like "Math.floor(x)"
    const call = detail.startsWith(item.label + '(') ? detail.slice(item.label.length) : '';
    return [category, parameters || call].filter(Boolean).join(' · ');
}

/**
 * Converts a completion item of the language service into a suggestion.
 *
 * @param {object} item completion item of the language service
 * @param {string} text what picking the item inserts
 * @returns {{label: string, text: string, detail: string, item: object}} suggestion
 */
function toSuggestion(item, text) {
    const full = CALLABLE_KINDS.has(item.kind) ? signature(item) : describe(item);
    const detail = full.length > DETAIL_LENGTH ? full.slice(0, DETAIL_LENGTH - 1) + '…' : full;
    return { label: item.label, text, detail, item };
}

/**
 * Cuts a snippet of the language service where its first placeholder would start, which is
 * where the cursor belongs.
 *
 * @param {object} item completion item of the language service
 * @returns {string} text to insert
 */
function untilPlaceholder(item) {
    const text = item.insertText ?? item.label;
    const end = text.search(PLACEHOLDER);
    return end === -1 ? text : text.slice(0, end);
}

/**
 * Collects the names used in the scripts of some kinds, without the one that is being typed.
 *
 * @param {string} text whole document
 * @param {string[]} kinds kinds of scripts to read, as the language service names them
 * @param {number} from where the typed name starts
 * @param {number} to where the typed name ends
 * @returns {Set.<string>} names in the order of their first use
 */
function namesIn(text, kinds, from, to) {
    const others = text.slice(0, from) + ' '.repeat(to - from) + text.slice(to);
    const code = scriptsOnly(others, kinds).replaceAll(JAVASCRIPT_TEXT, ' ');
    return new Set(code.match(JAVASCRIPT_NAME));
}

/**
 * Plain JavaScript suggestions for a name that is being typed: the names the scripts of the
 * same kind use, the language's own words and, in the browser, its usual globals. Nothing is
 * known about the members of a value, so nothing is offered after a dot.
 *
 * @param {string} text whole document
 * @param {{line: number, character: number}} position where the cursor is
 * @param {string} line text of the line of the cursor
 * @param {number} offset place of the cursor in the document
 * @param {boolean} isBrowser true for a script of the browser, false for SSJS
 * @returns {{list: object[], typed: string}} suggestions and the typed text they replace
 */
function javascriptHints(text, position, line, offset, isBrowser) {
    const before = line.slice(0, position.character);
    const typed = NAME_BEFORE_CURSOR.exec(before)[0];
    if (before.slice(0, before.length - typed.length).endsWith('.')) {
        return { list: [], typed };
    }
    const to = offset + /^[\w$]*/.exec(line.slice(position.character))[0].length;
    const from = offset - typed.length;
    const kinds = isBrowser ? BROWSER_KINDS : [SSJS];
    const words = new Map();
    for (const name of namesIn(text, kinds, from, to)) {
        words.set(name, 'in this content');
    }
    const globals = isBrowser ? BROWSER_GLOBALS : [];
    for (const name of globals) {
        words.set(name, 'global');
    }
    const keywords = isBrowser ? [...KEYWORDS, ...BROWSER_KEYWORDS] : KEYWORDS;
    for (const name of keywords) {
        words.set(name, 'keyword');
    }
    const needle = typed.toLowerCase();
    const list = words
        .entries()
        .filter(([name]) => name.toLowerCase().startsWith(needle))
        .map(([name, detail]) => ({ label: name, text: name, detail }))
        .toArray();
    return { list, typed };
}

/**
 * AMPscript suggestions at the cursor, and in Marketing Cloud Next those for Handlebars inside
 * `{{ }}`: those that start with the word typed so far. A function
 * is inserted as its name with the opening bracket.
 *
 * @param {string} text whole document
 * @param {{line: number, character: number}} position where the cursor is
 * @param {string} line text of the line of the cursor
 * @returns {{list: object[], typed: string}} suggestions and the typed text they replace
 */
function ampscriptHints(text, position, line) {
    const before = line.slice(0, position.character);
    const word = WORD_BEFORE_CURSOR.exec(before)[0];
    const start = before.slice(0, before.length - word.length);
    const isHandlebars = IS_NEXT && isInHandlebars(before);
    // "{{#i": the sign belongs to what is typed, and only helpers with a block fit
    const isBlock = isHandlebars && start.endsWith(BLOCK_SIGN);
    const needle = word.toLowerCase();
    const list = sfmcLanguageService
        .getCompletions(
            { text, languageId: AMPSCRIPT, uri: DOCUMENT_URI },
            { line: position.line, character: position.character },
            SETTINGS,
        )
        .filter(
            (item) =>
                item.label.toLowerCase().startsWith(needle) &&
                (!isBlock || String(item.insertText ?? '').startsWith(BLOCK_SIGN)),
        )
        .map((item) => toSuggestion(item, insertion(item)));
    return { list, typed: isBlock ? BLOCK_SIGN + word : word };
}

/**
 * Tells what picking a suggestion of the language service inserts. A function is called with a
 * bracket, so its name and the bracket are inserted; a Handlebars helper is followed by a blank,
 * and anything else is inserted up to where its first placeholder would start.
 *
 * @param {object} item completion item of the language service
 * @returns {string} text to insert
 */
function insertion(item) {
    const text = item.insertText;
    // a function without a snippet is still one
    const isCall =
        text === undefined ? item.kind === KIND_FUNCTION : text.startsWith(item.label + '(');
    return isCall ? item.label + '(' : untilPlaceholder(item);
}

/**
 * SSJS suggestions at the cursor. The names of the language service carry their objects, like
 * "Platform.Function.Lookup"; they fit if they start with what was typed, objects included and
 * in any spelling, or if a single typed word starts the name itself, so that "Look" finds the
 * entry above. Of the names that start like the typed text, only the next object is offered.
 *
 * @param {string} text whole document
 * @param {{line: number, character: number}} position where the cursor is
 * @param {string} line text of the line of the cursor
 * @returns {{list: object[], typed: string}} suggestions and the typed text they replace
 */
function ssjsHints(text, position, line) {
    const before = line.slice(0, position.character);
    const typed = CHAIN_BEFORE_CURSOR.exec(before)[0];
    const start = before.slice(0, before.length - typed.length);
    // a member of something that is not a plain name, like the result of a call: nothing is known about it
    if (start.endsWith('.')) {
        return { list: [], typed };
    }
    const needle = typed.toLowerCase();
    const isWord = needle !== '' && !needle.includes('.');
    const hasNew = /\bnew\s+$/.test(start);
    // by name: what continues the typed text, one object at a time
    const first = new Map();
    const second = [];
    const items = sfmcLanguageService.getCompletions(
        { text: ssjsOnly(text), languageId: SSJS, uri: DOCUMENT_URI },
        { line: position.line, character: position.character },
        SETTINGS,
    );
    for (const item of items) {
        const insert = untilPlaceholder(item);
        const suggestion = toSuggestion(item, hasNew ? insert.replace(/^new\s+/, '') : insert);
        if (item.label.toLowerCase().startsWith(needle)) {
            // "plat" is completed to "Platform" and "Platform." to "Platform.Function", not
            // to every function of Platform at once; the spelling of the catalogue replaces
            // the typed one
            const dot = item.label.indexOf('.', needle.length);
            if (dot === -1) {
                first.set(item.label, suggestion);
            } else if (!first.has(item.label.slice(0, dot))) {
                const name = item.label.slice(0, dot);
                first.set(name, { label: name, text: name, detail: OBJECT_DETAIL });
            }
        } else if (
            isWord &&
            String(item.filterText ?? '')
                .toLowerCase()
                .split(' ')
                .some((word) => word.startsWith(needle))
        ) {
            second.push(suggestion);
        }
    }
    return { list: [...first.values(), ...second], typed };
}

/**
 * Finds the dotted name in front of the last dot before the cursor, which is what the catalogue
 * knows members of.
 *
 * @param {string} before the cursor's line up to the cursor
 * @returns {{receiver: string, hasNew: boolean}} the name, empty if the dot follows something else, and whether `new` precedes it
 */
function memberReceiver(before) {
    const match = RECEIVER_CHAIN.exec(before);
    const start = match ? before.slice(0, match.index) : '';
    // "a().b." and "a[0].b.": the name is a member of a value, not one the catalogue describes
    return !match || /[.)\]]\s*$/.test(start)
        ? { receiver: '', hasNew: false }
        : { receiver: match[1], hasNew: /\bnew\s+$/.test(start) };
}

/**
 * Asks TypeScript for the members of the value in front of the cursor's dot. The catalogue
 * describes those it knows. The popup asks twice when it opens and again for every character
 * typed of the member's name, none of which changes the members, so the last answer is kept for
 * as long as the document up to the dot stays the same.
 *
 * @param {string} text whole document
 * @param {{line: number, character: number}} position where the cursor is
 * @param {string} before the cursor's line up to the cursor
 * @param {string} upToDot the document up to and including the dot
 * @returns {object[] | null} completion items named by the member alone; null if TypeScript is not there or knows no members
 */
function typescriptMembers(text, position, before, upToDot) {
    if (lastMembers.upToDot === upToDot) {
        return lastMembers.items;
    }
    return askTypescript(text, (service) => {
        const place = { line: position.line, character: position.character };
        const info = service.completions(place);
        const items = service.memberCompletions({
            typescriptItems: info.items,
            isMemberAccess: info.isMemberCompletion,
            catalogueItems: sfmcLanguageService.getCompletions(
                { text: ssjsOnly(text), languageId: SSJS, uri: DOCUMENT_URI },
                place,
                SETTINGS,
            ),
            ...memberReceiver(before),
        });
        Object.assign(lastMembers, { upToDot, items });
        return items;
    });
}

/**
 * SSJS suggestions after a dot, for which TypeScript knows the members of the value in front of
 * it: those that start with what is typed of the member's name, which is all that is replaced.
 *
 * @param {string} text whole document
 * @param {{line: number, character: number}} position where the cursor is
 * @param {string} line text of the line of the cursor
 * @param {number} offset place of the cursor in the document
 * @returns {{list: object[], typed: string} | null} suggestions and the typed text they replace; null where today's suggestions apply
 */
function memberHints(text, position, line, offset) {
    const before = line.slice(0, position.character);
    const member = MEMBER_BEFORE_CURSOR.exec(before);
    if (!member) {
        return null;
    }
    const typed = member[1];
    const items = typescriptMembers(text, position, before, text.slice(0, offset - typed.length));
    if (!items) {
        return null;
    }
    const needle = typed.toLowerCase();
    const list = items
        .filter((item) => item.label.toLowerCase().startsWith(needle))
        .map((item) =>
            toSuggestion(
                { ...item, detail: item.detail ?? MEMBER_KIND_NAMES[item.kind] },
                untilPlaceholder(item),
            ),
        );
    // no member starts like this: today's suggestions get their turn
    return list.length ? { list, typed } : null;
}

/**
 * Collects the suggestions of a language at the cursor. In SSJS, the plain JavaScript names
 * follow those of Marketing Cloud.
 *
 * @param {string} language language at the cursor
 * @param {string} text whole document
 * @param {{line: number, character: number}} position where the cursor is
 * @param {string} line text of the line of the cursor
 * @param {number} offset place of the cursor in the document
 * @returns {{list: object[], typed: string}} suggestions and the typed text they replace
 */
function hintsFor(language, text, position, line, offset) {
    if (language === JAVASCRIPT) {
        return javascriptHints(text, position, line, offset, true);
    }
    if (language !== SSJS) {
        return ampscriptHints(text, position, line);
    }
    const members = memberHints(text, position, line, offset);
    if (members) {
        return members;
    }
    const found = ssjsHints(text, position, line);
    if (found.typed.includes('.')) {
        return found;
    }
    const known = new Set(found.list.map((entry) => entry.label));
    const plain = javascriptHints(text, position, line, offset, false).list.filter(
        (entry) => !known.has(entry.label),
    );
    return { list: [...found.list, ...plain], typed: found.typed };
}

/**
 * Collects what fits at a place of a document, in the language of that place.
 *
 * @param {string} text whole document, its lines ending with a line feed
 * @param {{line: number, character: number}} position where the cursor is
 * @returns {{items: {label: string, text: string, detail: string, item?: object}[], from: {line: number, character: number}, to: {line: number, character: number}} | null} the suggestions, each with its name, what picking it inserts, a short description and, if it has one, the completion item of the language service, and the range they replace; null if there are none
 */
export function completionsAt(text, position) {
    const line = lineAt(text, position.line);
    const offset = offsetAt(text, position);
    const found = hintsFor(languageAt(text, offset), text, position, line, offset);
    // a name that is being typed is offered as itself; picking it would change nothing
    const items = found.list.filter((entry) => entry.text !== found.typed);
    // with the cursor inside a word, the rest of the word is replaced as well
    const end = position.character + /^[\w$]*/.exec(line.slice(position.character))[0].length;
    if (line[end] === '(') {
        for (const entry of items) {
            const bracket = entry.text.indexOf('(');
            entry.text = bracket === -1 ? entry.text : entry.text.slice(0, bracket);
        }
    }
    // the same for the blank after a Handlebars helper: one that is there is not doubled
    const isHandlebars = IS_NEXT && isInHandlebars(line.slice(0, position.character));
    if (isHandlebars && line[end] === ' ') {
        for (const entry of items) {
            entry.text = entry.text.endsWith(' ') ? entry.text.slice(0, -1) : entry.text;
        }
    }
    if (!items.length) {
        return null;
    }
    return {
        items,
        from: { line: position.line, character: position.character - found.typed.length },
        to: { line: position.line, character: end },
    };
}

/**
 * Tells whether suggestions may open by themselves after typing: the text before the cursor ends
 * like a name of the language there, outside of strings and comments.
 *
 * @param {string} text whole document, its lines ending with a line feed
 * @param {{line: number, character: number}} position where the cursor is
 * @param {string} tokenStyle how the editor styles the code at the cursor, may be empty
 * @returns {boolean} true if a name is being typed
 */
export function isTypingName(text, position, tokenStyle) {
    const before = lineAt(text, position.line).slice(0, position.character);
    const language = languageAt(text, offsetAt(text, position));
    return (
        Boolean(TYPED_END.get(language)?.test(before)) &&
        !QUIET_STYLES.get(language).test(tokenStyle)
    );
}
