/*
 * SFMC UX Tools — errors and warnings of a document, without an editor.
 */
import {
    getScriptRegions,
    sfmcLanguageService,
    validateMixedDocumentSsjs,
} from 'sfmc-language-lsp';
import { AMPSCRIPT, DOCUMENT_URI, SETTINGS, SSJS } from '../shared.js';
import { askTypescript } from '../typescript.js';
import { offsetAt, positionAt } from './text.js';

// severities of the language service
export const ERROR = 1;
export const WARNING = 2;
export const SCRIPT_REMOVED = 'sfmc/script-removed-on-save';
const SCRIPT_REMOVED_PAGE = 'https://sfmc.guide/engagement/code-persistence/';
const SERVER = 'server';
// what is said about a script for the browser, by how sure its loss is where the content is used
// said in both: what the editor shows afterwards, and the attribute that may just be missing
const SCRIPT_REMOVED_AFTER =
    'After the save the editor may still show the tag although the stored content no longer has it; open the content again to see what was stored.';
const SCRIPT_REMOVED_FORGOTTEN =
    'If this is meant to be server-side JavaScript, runat="server" is missing in the tag: with it, the script is kept. AMPscript is kept as well.';
const SCRIPT_REMOVED_MESSAGES = {
    [ERROR]: `Marketing Cloud removes this <script> when you save, the tag and what is in it, without telling you: emails and email templates keep no JavaScript for the browser. ${SCRIPT_REMOVED_AFTER} ${SCRIPT_REMOVED_FORGOTTEN}`,
    [WARNING]: `Marketing Cloud removes this <script> when you save the block, the tag and what is in it, without telling you. JavaScript for the browser is only kept in CloudPages: put it into the landing page or a code resource there. ${SCRIPT_REMOVED_AFTER} ${SCRIPT_REMOVED_FORGOTTEN}`,
};

/**
 * Collects what the language service objects to in a document: its AMPscript, in Marketing
 * Cloud Next its Handlebars as well, and the SSJS of its server-side scripts. What is inside a
 * browser script is not looked at.
 *
 * @param {string} text whole document
 * @returns {object[]} diagnostics of the language service
 */
export function check(text) {
    const list = sfmcLanguageService.validate(
        { text, languageId: AMPSCRIPT, uri: DOCUMENT_URI },
        SETTINGS,
    );
    if (hasSsjs(text)) {
        list.push(...validateMixedDocumentSsjs(text, SETTINGS));
    }
    return list;
}

/**
 * Lists the scripts of a document that Marketing Cloud cuts out when it saves the content of an
 * email, an email template or a content block: every script that does not run on the server.
 *
 * @param {string} text whole document
 * @param {number} severity how serious that is where the document is used: ERROR or WARNING
 * @returns {object[]} one diagnostic per such script, on its opening tag
 */
export function removedScripts(text, severity) {
    return getScriptRegions(text)
        .filter(
            (region) =>
                region.kind !== AMPSCRIPT &&
                String(region.attributes?.runat ?? '')
                    .trim()
                    .toLowerCase() !== SERVER,
        )
        .map((region) => ({
            range: {
                start: positionAt(text, region.tagStart),
                end: positionAt(text, region.tagEnd),
            },
            severity,
            source: 'sfmc-ux-tools',
            code: SCRIPT_REMOVED,
            codeDescription: { href: SCRIPT_REMOVED_PAGE },
            message: SCRIPT_REMOVED_MESSAGES[severity],
        }));
}

/**
 * Tells whether a document has a server-side script.
 *
 * @param {string} text whole document
 * @returns {boolean} true if there is SSJS to check
 */
function hasSsjs(text) {
    return getScriptRegions(text).some((region) => region.kind === SSJS);
}

/**
 * Names the place of a diagnostic, to find the ones that are about the same piece of code.
 *
 * @param {object} diagnostic diagnostic of the language service
 * @returns {string} equal for diagnostics with the same range
 */
function key(diagnostic) {
    const { range } = diagnostic;
    return JSON.stringify([range.start, range.end]);
}

/**
 * Collects what TypeScript objects to in the server-side scripts of a document, like type errors
 * and unknown members. As in the VS Code extension, only what lies inside such a script counts.
 *
 * @param {string} text whole document, its lines ending with a line feed
 * @param {object[]} known diagnostics of the language service; what TypeScript says about the same piece of code is left out, as the language service says it with a remedy
 * @returns {object[]} further diagnostics; empty without the TypeScript script or without SSJS
 */
export function checkTypes(text, known) {
    if (!hasSsjs(text)) {
        return [];
    }
    const seen = new Set(known.map((diagnostic) => key(diagnostic)));
    const list =
        askTypescript(text, (service) =>
            service
                .diagnostics()
                .filter((diagnostic) =>
                    service.isInSsjsRegion(text, offsetAt(text, diagnostic.range.start)),
                ),
        ) ?? [];
    return list.filter((diagnostic) => {
        const isNew = !seen.has(key(diagnostic));
        seen.add(key(diagnostic));
        return isNew;
    });
}
