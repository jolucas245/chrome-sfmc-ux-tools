/*
 * SFMC UX Tools — a warning for HTML tags that are typed into Content Builder's rich text
 * editor, the "Content" tab of a free form block and a text block. That editor, a CKEditor 4,
 * stores what is typed as text: "<script>" becomes "&lt;script&gt;", is shown as written and
 * never runs. The save reports success all the same.
 *
 * The typed tags are underlined and a note above the editor says what happens to them. Nothing
 * is written to the content, and no key or save is held back.
 */
import { CHECK_DELAY } from './diagnostics.js';
import { report, watchPage } from './editors.js';
import { createIcon } from './tooltip.js';

// what looks like an opening or closing tag: "<b>", "</script>", "<div class="x">", "<br/>";
// not "a < b", "<3" or "<a@b.c>"
const TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi;
// AMPscript blocks, in which a "<" compares and is none of a tag
const AMPSCRIPT_BLOCKS = [
    ['%%[', ']%%'],
    ['%%=', '=%%'],
];
// elements whose text is no text of the content
const UNREAD = 'script, style, textarea';
const WYSIWYG = 'wysiwyg';
// CKEditor calls its listeners in the order of their priority; the extension's come after the
// editor's own
const LATE = 999;
const HIGHLIGHT = 'sfmc-typed-tag';
// the editor's document is one of its own, which the extension's stylesheet does not reach; the
// colour is the warning colour of the light theme, as the content is shown on white
const HIGHLIGHT_STYLE = `::highlight(${HIGHLIGHT}) { text-decoration: underline wavy #bf8803; background-color: #bf880333; }`;
const NOTICE_CLASS = 'sfmc-rich-text-notice';
const ICON_CLASS = 'sfmc-rich-text-icon';
const ICON_SAYS = 'SFMC UX Tools: added this note, which warns about HTML tags typed as text.';
const PAGE = 'https://sfmc.guide/engagement/code-persistence/';
const PAGE_SAYS = 'What Marketing Cloud keeps where';
// how much of a long tag the note quotes
const QUOTE_LENGTH = 40;
const marker = Symbol.for('sfmcUxTools.richText');
// what is underlined for each editor: the ranges and the highlight they are part of
const underlined = new WeakMap();
// the note of each editor, and whether it has something to say
const notices = new WeakMap();
// the documents that have the style of the underline
const styled = new WeakSet();

/**
 * Finds what looks like an HTML tag in a text.
 *
 * @param {string} text text as it was typed
 * @returns {{start: number, end: number}[]} where each one starts and ends; none for what stands in an AMPscript block
 */
export function typedTags(text) {
    const result = [];
    for (const match of text.matchAll(TAG)) {
        const before = text.slice(0, match.index);
        const isInAmpscript = AMPSCRIPT_BLOCKS.some(
            ([open, close]) => before.lastIndexOf(open) > before.lastIndexOf(close),
        );
        if (!isInAmpscript) {
            result.push({ start: match.index, end: match.index + match[0].length });
        }
    }
    return result;
}

/**
 * Lists the text of an element the way a reader sees it: text nodes that touch are one text, as
 * the editor splits what is typed into several of them at will.
 *
 * @param {Element} editable element whose content is edited
 * @returns {Text[][]} the text nodes of each text
 */
function texts(editable) {
    const document = editable.ownerDocument;
    const walker = document.createTreeWalker(editable, document.defaultView.NodeFilter.SHOW_TEXT);
    const result = [];
    let last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest(UNREAD)) {
            continue;
        }
        if (last && node.previousSibling === last) {
            result.at(-1).push(node);
        } else {
            result.push([node]);
        }
        last = node;
    }
    return result;
}

/**
 * Creates the range of a part of a text that is spread over text nodes.
 *
 * @param {Text[]} nodes the text nodes of the text, in their order
 * @param {number} start where the part starts in the text
 * @param {number} end where it ends, after its last character
 * @returns {Range} the range
 */
function rangeOf(nodes, start, end) {
    const range = nodes[0].ownerDocument.createRange();
    let offset = 0;
    let isStarted = false;
    for (const node of nodes) {
        const next = offset + node.length;
        if (!isStarted && start < next) {
            range.setStart(node, start - offset);
            isStarted = true;
        }
        if (isStarted && end <= next) {
            range.setEnd(node, end - offset);
            return range;
        }
        offset = next;
    }
    return range;
}

/**
 * Finds the typed tags of an element.
 *
 * @param {Element} editable element whose content is edited
 * @returns {Range[]} one range per tag
 */
function tagRanges(editable) {
    const result = [];
    for (const nodes of texts(editable)) {
        const text = nodes.map((node) => node.data).join('');
        for (const { start, end } of typedTags(text)) {
            result.push(rangeOf(nodes, start, end));
        }
    }
    return result;
}

/**
 * Underlines the typed tags of an editor, and nothing else of it any more. An underline is a
 * highlight of the browser: it adds no element and changes nothing of the content.
 *
 * @param {object} editor CKEditor instance
 * @param {Range[]} ranges what to underline
 */
function underline(editor, ranges) {
    const old = underlined.get(editor);
    const oldRanges = old?.ranges ?? [];
    for (const range of oldRanges) {
        old.highlight.delete(range);
    }
    underlined.delete(editor);
    const document = ranges[0]?.startContainer.ownerDocument;
    const view = document?.defaultView;
    const highlights = view?.CSS?.highlights;
    if (
        !highlights ||
        typeof view.Highlight !== 'function' ||
        typeof view.CSSStyleSheet?.prototype.replaceSync !== 'function' ||
        !document.adoptedStyleSheets
    ) {
        return;
    }
    if (!styled.has(document)) {
        // a stylesheet without an element: nothing of it can get into what the editor saves
        const sheet = new view.CSSStyleSheet();
        sheet.replaceSync(HIGHLIGHT_STYLE);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        styled.add(document);
    }
    // one highlight per document, which editors that share a document share as well
    let highlight = highlights.get(HIGHLIGHT);
    if (!highlight) {
        highlight = new view.Highlight();
        highlights.set(HIGHLIGHT, highlight);
    }
    for (const range of ranges) {
        highlight.add(range);
    }
    underlined.set(editor, { ranges, highlight });
}

/**
 * Words the note for the typed tags of an editor.
 *
 * @param {Range[]} ranges the typed tags, at least one
 * @returns {string} what the note says
 */
function wording(ranges) {
    const first = ranges[0].toString();
    const quoted = first.length > QUOTE_LENGTH ? `${first.slice(0, QUOTE_LENGTH)}…` : first;
    const others = ranges.length - 1;
    const subject =
        others === 0
            ? `“${quoted}” looks like an HTML tag. Typed here, it is`
            : `“${quoted}” and ${others} more look like HTML tags. Typed here, they are`;
    return `${subject} saved as plain text and shown to readers as written; code typed this way does not run. HTML and code belong in the HTML Editor tab of the block.`;
}

/**
 * Puts the note of an editor right before the editor, if it has something to say and is not
 * there: the page may redraw what is around its editor.
 *
 * @param {object} editor CKEditor instance
 */
function place(editor) {
    const notice = notices.get(editor);
    const container = editor.container?.$;
    if (notice?.isWanted && container?.isConnected && notice.element.nextSibling !== container) {
        container.before(notice.element);
    }
}

/**
 * Shows the note of an editor, or takes it off the page.
 *
 * @param {object} editor CKEditor instance
 * @param {Range[]} ranges the typed tags; none takes the note away
 */
function tell(editor, ranges) {
    let notice = notices.get(editor);
    if (ranges.length === 0) {
        if (notice) {
            notice.isWanted = false;
            notice.element.remove();
        }
        return;
    }
    const document = editor.container?.$?.ownerDocument;
    if (!document) {
        return;
    }
    if (!notice) {
        const element = document.createElement('div');
        element.className = NOTICE_CLASS;
        element.setAttribute('role', 'status');
        const text = document.createElement('span');
        const link = document.createElement('a');
        link.href = PAGE;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = PAGE_SAYS;
        element.append(createIcon(document, ICON_CLASS, ICON_SAYS), text, ' ', link);
        notice = { element, text, isWanted: false };
        notices.set(editor, notice);
    }
    const says = wording(ranges);
    // the note stands in the page that is watched: it only changes when it says something else
    if (notice.text.textContent !== says) {
        notice.text.textContent = says;
    }
    notice.isWanted = true;
    place(editor);
}

/**
 * Looks at what an editor shows and marks the typed tags in it. In its source view, and while
 * it has no content to edit yet, nothing is marked.
 *
 * @param {object} editor CKEditor instance
 */
function check(editor) {
    const editable = editor.mode === WYSIWYG ? editor.editable?.()?.$ : null;
    const ranges = editable ? tagRanges(editable) : [];
    // the note first: it is what has to be there, whatever the browser makes of the underline
    tell(editor, ranges);
    underline(editor, ranges);
}

/**
 * Sets the warning up for one editor: checked now, when it gets its content or another view,
 * and whenever typing pauses.
 *
 * @param {object} editor CKEditor instance
 */
function setUp(editor) {
    let timer;
    const now = () => {
        try {
            check(editor);
        } catch (ex) {
            report(ex);
        }
    };
    const soon = () => {
        clearTimeout(timer);
        timer = setTimeout(now, CHECK_DELAY);
    };
    const gone = () => {
        clearTimeout(timer);
        try {
            underline(editor, []);
            tell(editor, []);
        } catch (ex) {
            report(ex);
        }
    };
    // the editor does not catch what a listener throws, and takes a returned false as "stop":
    // each of these catches for itself and returns nothing
    for (const [name, act] of [
        ['contentDom', now],
        ['mode', now],
        ['change', soon],
        ['destroy', gone],
    ]) {
        editor.on(
            name,
            () => {
                act();
            },
            null,
            null,
            LATE,
        );
    }
    now();
}

/**
 * Sets the warning up for every rich text editor of the page, now and whenever one is added.
 */
export function watchRichText() {
    watchPage(() => {
        const editors = Object.values(globalThis.CKEDITOR?.instances ?? {});
        for (const editor of editors) {
            if (typeof editor?.on !== 'function') {
                continue;
            }
            if (editor[marker] === true) {
                place(editor);
                continue;
            }
            editor[marker] = true;
            setUp(editor);
        }
    });
}
