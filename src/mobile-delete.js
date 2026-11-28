/*
 * SFMC UX Tools — content script for the frames of MobileConnect and MobilePush.
 *
 * Neither app lets a message be deleted from its list, and MobileConnect lets none be deleted at
 * all; Marketing Cloud's API can. This adds a "Delete" button to the details page of a
 * MobileConnect message, and to both lists a checkbox in front of the name of each row, and a
 * button "Delete selected (n)". Both apps find the cells of their lists by their place, so no cell
 * or column is added: the checkbox is in the app's own first cell, in room made on its left.
 *
 * Deleting cannot be undone, and some messages must not be deleted here, so:
 * - nothing is sent before the click in the script's own dialog, which names each message;
 * - every chosen message is read again and judged from that answer, never from its row;
 * - whatever the judgement needs and cannot read, or reads in another shape than expected,
 *   refuses the message;
 * - right before its delete request, a message is read and judged once more;
 * - the only request that changes anything is DELETE of the message itself, for ids the user chose.
 * What Marketing Cloud answers is shown as text only.
 *
 * In MobilePush, a message that is refused says where to go on: one that belongs to a
 * transactional push message has a link that opens the extension's panel on that message, and
 * one that a journey made has a link that looks for the journey. The journeys are read by the
 * Marketing Cloud page, because this frame may not read them, and only after that click. A
 * journey-made message that no journey version uses any more may be deleted.
 */
(() => {
    'use strict';

    // said wherever this script adds something, so that nobody takes it for Marketing Cloud's own
    const MADE_BY = 'SFMC UX Tools';
    const NAME = 'sfmc-ux-tools-mobile-delete';
    const MARK = 'data-sfmc-ux-tools-mobile-delete';
    // what the script added, by that mark, and the rows of a list
    const DETAILS_BUTTON = '[data-sfmc-ux-tools-mobile-delete="details"]';
    const SELECTED_BUTTON = '[data-sfmc-ux-tools-mobile-delete="selected"]';
    const ROW_BOX = 'input[data-sfmc-ux-tools-mobile-delete="row"]';
    const ROWS = ':scope tbody tr';
    // the room on the left of the app's own first cell of a row, which holds the row's checkbox:
    // an element of the script in that cell, and the classes that make the room in the cell and
    // in the first cell of the table's header
    const GUTTER = 'span[data-sfmc-ux-tools-mobile-delete="gutter"]';
    const GUTTER_CELL = `${NAME}-gutter-cell`;
    const GUTTER_HEAD = `${NAME}-gutter-head`;
    const HEAD_ROWS = ':scope > thead > tr';
    // where the extension lists the transactional messages, and deletes them safely
    const PANEL = 'Mobile Studio → Transactional Messages';
    // the largest page the API hands out of the definitions
    const LARGEST_PAGE = 100;
    // pages of definitions that are read at most; a list that is longer is taken as not read
    const MOST_PAGES = 100;
    // details that are read at the same time, to leave Marketing Cloud's server to the app
    const DETAILS_AT_ONCE = 4;
    // how the API says that a listed transactional definition is not there: seen for an SMS
    // definition whose mobile message was deleted, which is listed for good but cannot be read
    const NOT_FOUND = 404;
    const ORPHANED = '30003';
    // sendMethod of an SMS message that a journey made, and sendInitiator of such a push message
    const SMS_JOURNEY = 'INTERACTION';
    const PUSH_JOURNEY = 3;
    // sendInitiator of a push message that the API triggers, and the status of an active one,
    // whoever starts it
    const PUSH_API = 1;
    const PUSH_ACTIVE = 2;
    // messageType of a push message that is a plain notification ("Outbound"), the only kind
    // for which it was seen how a journey names its message
    const PUSH_OUTBOUND = 1;
    // the status of a transactional definition that was deleted
    const DELETED = 'deleted';

    const MISSING =
        'Marketing Cloud’s answer lacks what is needed to tell whether it is safe to delete.';
    const NOT_THE_ONE = 'Marketing Cloud answered with another message than the one asked for.';
    const JOURNEY =
        'A journey made it. The journey would lose its message, and deleting such a message was never tried.';
    const SMS_OWNED = `It belongs to a transactional SMS message. Deleting it here would leave that one broken for good: listed, but impossible to open or delete. Delete the transactional message under ${PANEL} instead.`;
    const SMS_UNREAD =
        'The transactional SMS messages could not be read completely, so it cannot be ruled out that it belongs to one of them.';
    const PUSH_OWNED = `A transactional push message has the same name, so it is taken to belong to it. Delete the transactional message under ${PANEL} instead.`;
    const PUSH_UNREAD =
        'The transactional push messages could not be read completely, so it cannot be ruled out that it belongs to one of them.';
    const PUSH_IN_USE = 'It is active. Make it inactive first.';
    const JOURNEY_USED =
        'A journey uses it. The journey would lose its message, and deleting such a message was never tried.';
    const JOURNEY_UNREAD =
        'A journey made it, and the journeys could not be read completely, so it cannot be ruled out that one of them still uses it.';
    const JOURNEY_FREE = 'A journey made it, but no journey that still exists uses it.';
    const JOURNEY_SHAPE =
        'A journey made it, and its id has another form than the one a journey names its message by, so it cannot be ruled out that one still uses it.';
    const JOURNEY_KIND =
        'A journey made it, and for this kind of push message nobody has seen how a journey names its message, so it cannot be ruled out that one still uses it.';

    /**
     * Says whether a value can be an id: text that is not empty, or a number.
     *
     * @param {unknown} value what the API or the page holds
     * @returns {boolean} true when it can
     */
    const isId = (value) =>
        (typeof value === 'string' && value.trim() !== '') ||
        (typeof value === 'number' && Number.isFinite(value));
    /**
     * Writes an id or a name so that two spellings of the same one are equal.
     *
     * @param {string|number} value the id or name
     * @returns {string} it, without spaces around it and in small letters
     */
    const same = (value) => String(value).trim().toLowerCase();
    /**
     * Says whether the id of a triggered send definition stands for "none": the number 0, or text
     * of zeros and hyphens with at least one zero, which is the empty GUID that was seen live.
     * Nothing else is "none": not a missing field, null, empty text or blanks, which were never
     * seen.
     *
     * @param {unknown} value what a message holds in the field
     * @returns {boolean} true when it names no definition
     */
    const isNone = (value) =>
        value === 0 || (typeof value === 'string' && /^[0-]*0[0-]*$/.test(value));
    /**
     * Reads the number of a message out of its id. Seen live: the id of a MobileConnect message
     * is three numbers with colons between them, written in Base64, such as "54:78:0", and the
     * SMS activity of a journey names the same message as "54:625:0". The first number is the
     * message, the second what kind of thing the id is for.
     *
     * @param {unknown} id an id of a message, as the API or a journey holds it
     * @returns {string|undefined} the first number; nothing when the id has another form
     */
    const numberOf = (id) => {
        if (typeof id !== 'string' || !/^[\w+/=-]+$/.test(id)) {
            return;
        }
        let plain;
        try {
            plain = atob(id.replaceAll('-', '+').replaceAll('_', '/'));
        } catch {
            return;
        }
        return /^(\d+):\d+:\d+$/.exec(plain)?.[1];
    };
    /**
     * Reads a whole number that the API may write as a number or as text.
     *
     * @param {unknown} value what the API returned
     * @returns {number|undefined} the number; nothing when it is none
     */
    const code = (value) => {
        if (Number.isSafeInteger(value)) {
            return value;
        }
        return typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : undefined;
    };

    /**
     * Judges whether a message may be deleted, from what was read just now. It asks nothing and
     * changes nothing. Whatever is missing, has another shape than expected or was not read
     * refuses the message.
     *
     * @param {string} kind sms for MobileConnect, push for MobilePush
     * @param {string|number} id the id that was asked for
     * @param {unknown} message what the API answered for that id
     * @param {{isComplete: boolean, ids?: Set.<string>, names?: Set.<string>, keys?: Map.<string, string[]>}} [definitions] the transactional definitions of the kind: for sms the ids of all of them, for push the names of those that are not deleted and the keys of the definitions of each name, all as same() writes them; nothing when they were not read
     * @param {{isComplete: boolean, users?: Map.<string, object[]>, smsUsers?: Map.<string, object[]>}} [journeys] the journey versions that use a push message, by the id of the message, and those that use an SMS message, by the number in its id; nothing when the journeys were not read
     * @returns {{isAllowed: boolean, reason?: string, name?: string, needs?: boolean, isFindable?: boolean, isJourneyMade?: boolean, users?: object[], keys?: string[], note?: string}} whether it may be deleted, why not, its name when it has one, and needs when the judgement takes the definitions, which were not handed in. isFindable when reading the journeys could change the judgement, isJourneyMade and a note for a message of a journey that may be deleted, users for the journey versions that use it, keys for the transactional messages it is taken to belong to
     */
    function judge(kind, id, message, definitions, journeys) {
        if (typeof message !== 'object' || message === null || Array.isArray(message)) {
            return { isAllowed: false, reason: MISSING };
        }
        if (!isId(id) || !isId(message.id) || String(message.id) !== String(id)) {
            return { isAllowed: false, reason: NOT_THE_ONE };
        }
        if (typeof message.name !== 'string' || message.name.trim() === '') {
            return { isAllowed: false, reason: MISSING };
        }
        const { name } = message;
        const refuse = (reason, more) => ({ isAllowed: false, reason, name, ...more });
        if (kind === 'sms') {
            const { sendMethod, smsTriggeredSendDefinitionId: held } = message;
            if (typeof sendMethod !== 'string' || sendMethod.trim() === '') {
                return refuse(MISSING);
            }
            // a field that is not there is not a zero
            if (!isNone(held) && !isId(held)) {
                return refuse(MISSING);
            }
            // what the judgement says when nothing below refuses the message
            let allowed = { isAllowed: true, name };
            if (sendMethod.trim().toUpperCase() === SMS_JOURNEY) {
                // the message does not name its journey; the journeys name their messages
                if (!journeys) {
                    return refuse(JOURNEY, { isFindable: true });
                }
                if (journeys.isComplete !== true || typeof journeys.smsUsers?.get !== 'function') {
                    return refuse(JOURNEY_UNREAD, { isFindable: true });
                }
                // a journey names the message by the number in its id, see numberOf()
                const number = numberOf(id);
                if (number === undefined) {
                    return refuse(JOURNEY_SHAPE);
                }
                const users = journeys.smsUsers.get(number);
                if (users !== undefined) {
                    return refuse(JOURNEY_USED, { users });
                }
                // seen live: such a message stays active when its journey is deleted, and is
                // deleted cleanly then. It holds the id of a triggered send definition, which is
                // held against the transactional definitions below like any other
                allowed = { ...allowed, isJourneyMade: true, note: JOURNEY_FREE };
            }
            if (isNone(held)) {
                return allowed;
            }
            // the id alone proves nothing: a message activated in MobileConnect has one too.
            // Only a definition with that id does, whatever its name
            if (!definitions) {
                return refuse(SMS_UNREAD, { needs: true });
            }
            if (definitions.isComplete !== true || typeof definitions.ids?.has !== 'function') {
                return refuse(SMS_UNREAD);
            }
            if (!definitions.ids.has(same(held))) {
                return allowed;
            }
            const key = definitions.keys?.get?.(same(held));
            return refuse(SMS_OWNED, { keys: typeof key === 'string' ? [key] : [] });
        }
        if (kind === 'push') {
            const initiator = code(message.sendInitiator);
            const status = code(message.status);
            if (initiator === undefined || status === undefined) {
                return refuse(MISSING);
            }
            if (initiator === PUSH_JOURNEY) {
                // the message does not name its journey; the journeys name their messages
                if (!journeys) {
                    return refuse(JOURNEY, { isFindable: true });
                }
                if (journeys.isComplete !== true || typeof journeys.users?.get !== 'function') {
                    return refuse(JOURNEY_UNREAD, { isFindable: true });
                }
                const users = journeys.users.get(same(id));
                if (users !== undefined) {
                    return refuse(JOURNEY_USED, { users });
                }
                // seen live for a plain notification only: such a message stays active when its
                // journey is deleted, and is deleted cleanly then
                return code(message.messageType) === PUSH_OUTBOUND
                    ? { isAllowed: true, name, isJourneyMade: true, note: JOURNEY_FREE }
                    : refuse(JOURNEY_KIND);
            }
            if (initiator === PUSH_API) {
                // no id links a push message to its transactional definition; the name does
                if (!definitions) {
                    return refuse(PUSH_UNREAD, { needs: true });
                }
                if (
                    definitions.isComplete !== true ||
                    typeof definitions.names?.has !== 'function'
                ) {
                    return refuse(PUSH_UNREAD);
                }
                if (definitions.names.has(same(name))) {
                    const keys = definitions.keys?.get?.(same(name));
                    return refuse(PUSH_OWNED, { keys: Array.isArray(keys) ? keys : [] });
                }
            }
            // MobilePush's own delete button refuses active messages, also those by location
            // and of a CloudPage, which the message does not tell from one sent by hand
            return status === PUSH_ACTIVE ? refuse(PUSH_IN_USE) : { isAllowed: true, name };
        }
        return refuse(MISSING);
    }

    // what the script hands out: the judgement, for the tests, and the two ways it leaves a
    // page, which a test replaces because its page cannot be loaded again
    const shared = {
        judge,
        reload: () => location.reload(),
        // the address of the app without a route, which is its overview
        toOverview: () => location.assign(location.pathname + location.search),
    };
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the tests call the judgement by itself and replace the two functions that load the page again, which nothing else of this script lets them
    globalThis.sfmcUxToolsMobileDelete = shared;

    // the two apps, each with where its messages and its transactional definitions are in the
    // API, its list and how a row of it names its message
    const APPS = [
        {
            kind: 'sms',
            path: '/MobileConnectFuel3/',
            message: 'legacy/v1/beta/mobile/message/',
            definitions: 'messaging/v1/sms/definitions',
            repeater: '#messagesGridRepeater',
            rowId: (row) =>
                row.cells[0]?.querySelector('a[data-id][data-status]')?.dataset.id || undefined,
            // the page of one message: its route, with the id, the header the button goes into
            // and the title that shows the header is that of a message
            route: /^#!\/message\/view\/([^/?#]+)$/,
            header: '.container > header.header',
            title: '.container > header.header h3.title',
        },
        {
            // seen live: the page of one message is not drawn by the app of the list but by the
            // older MobileConnect under another path, whose address is written with a capital
            // letter or without. It has no list, and asks the API through the app of the list
            kind: 'sms',
            path: '/mobile/',
            api: '/MobileConnectFuel3/',
            message: 'legacy/v1/beta/mobile/message/',
            definitions: 'messaging/v1/sms/definitions',
            route: /^#!\/message\/view\/([^/?#]+)$/,
            // where that page holds the message's status and its own buttons, next to the title
            header: '#alter-message-status',
            title: 'h3.fuel-template-header-text',
        },
        {
            kind: 'push',
            path: '/mobilepush/',
            message: 'push/v1/message/',
            definitions: 'messaging/v1/push/definitions',
            repeater: '#messageGridRepeater',
            rowId: (row) =>
                row.cells[0]?.querySelector('div.message-name-cell[data-id]')?.dataset.id ||
                undefined,
        },
    ];
    const here = location.pathname.toLowerCase();
    const app = APPS.find((item) => here.startsWith(item.path.toLowerCase()));
    if (!app) {
        return;
    }
    // what this frame asks of the Marketing Cloud page, through the extension: to open the panel
    // Transactional Messages on one push message, and to read one page of the journeys
    const PANEL_OPEN = 'sfmc-ux-tools:mobile:panel-open';
    const JOURNEYS = 'sfmc-ux-tools:mobile:journeys';
    // what that page tells this frame: its panel was closed after it deleted a message of a kind
    const PANEL_CLOSED = 'sfmc-ux-tools:mobile:panel-closed';
    // journeys the page reads at a time, which its answer must repeat, and the pages asked for
    // at most; a list that is longer is taken as not read
    const JOURNEY_PAGE = 50;
    const MOST_JOURNEY_PAGES = 1000;
    // how often the whole list of journeys is read at most. Seen live: its order is not fixed,
    // and in one read of 1224 versions one came twice and one not at all; reading again finds it
    const MOST_JOURNEY_PASSES = 3;
    // the kind of journey that sends once ("Single Send")
    const SINGLE_SEND = 'Quicksend';
    // the id of a journey, and the address of the Marketing Cloud page, as a link is made of them
    const JOURNEY_ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
    const SHELL = /^https:\/\/mc\.[\da-z.-]+\.exacttarget\.com$/;
    const ICON = chrome.runtime.getURL('icons/icon16.png');
    // where the app passes calls on to the REST API
    const API = `${app.api ?? app.path}fuelapi/`;
    // the ids of the messages ticked in the list
    const selected = new Set();
    // the dialog that is open, if any
    let dialog;

    /**
     * Creates an element.
     *
     * @param {string} tag name of the element
     * @param {string} [part] what it is, for the stylesheet
     * @param {string} [text] its text
     * @returns {HTMLElement} the element
     */
    function make(tag, part, text) {
        const element = document.createElement(tag);
        if (part) {
            element.className = `${NAME}-${part}`;
        }
        if (text !== undefined) {
            element.textContent = text;
        }
        return element;
    }

    /**
     * Creates the icon of the extension, which says what the extension added at that place when
     * the mouse rests on it.
     *
     * @param {string} says what the extension added there, in one sentence
     * @returns {HTMLImageElement} the icon
     */
    function icon(says) {
        const image = make('img', 'icon');
        image.src = ICON;
        image.alt = MADE_BY;
        image.title = `${MADE_BY}: ${says}`;
        image.width = 16;
        image.height = 16;
        return image;
    }

    /**
     * Creates a button of the script, marked with the icon.
     *
     * @param {string} mark what it is, by which it is found again
     * @param {string} text what it says
     * @param {string} says what its icon says under the mouse: what the extension added, in one sentence
     * @returns {{button: HTMLButtonElement, label: HTMLElement}} the button, and the part of it that holds its text
     */
    function marked(mark, text, says) {
        const button = make('button', 'button');
        button.type = 'button';
        button.setAttribute(MARK, mark);
        button.title = `Added by ${MADE_BY}`;
        const label = make('span', undefined, text);
        button.append(icon(says), label);
        return { button, label };
    }

    /**
     * Asks Marketing Cloud's API through the app. It never throws.
     *
     * @param {string} path address below the API
     * @param {string} [method] GET to read, DELETE to delete
     * @returns {Promise.<{isOk: boolean, body?: object, status?: number, message?: string, isUnanswered?: boolean}>} the answer, or why there is none
     */
    async function ask(path, method = 'GET') {
        let response;
        try {
            response = await fetch(API + path, {
                // what is judged must be what Marketing Cloud holds now
                cache: 'no-store',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
                method,
                redirect: 'error',
            });
        } catch {
            // after a delete request, nobody knows whether it was carried out
            return {
                isOk: false,
                isUnanswered: true,
                message: 'Marketing Cloud did not answer. Are you still logged in?',
            };
        }
        let body;
        try {
            body = await response.json();
        } catch {
            // an answer that is no JSON is told by its status
        }
        const isObject = typeof body === 'object' && body !== null && !Array.isArray(body);
        // what was read must be there; a delete is told by the status alone
        if (!response.ok || (method === 'GET' && !isObject)) {
            return {
                isOk: false,
                status: response.status,
                body: isObject ? body : undefined,
                message:
                    (isObject && typeof body.message === 'string' && body.message) ||
                    `Marketing Cloud answered with ${response.status}.`,
            };
        }
        return { isOk: true, body: isObject ? body : {} };
    }

    /**
     * Reads the list of all transactional definitions of the app, page by page, until a page is
     * shorter than what was asked for. Each answer must say that its page has the size asked for.
     *
     * @returns {Promise.<object[]|undefined>} the rows; nothing when the list could not be read, had another shape than expected, repeated itself or did not end
     */
    async function readList() {
        const rows = [];
        const keys = new Set();
        for (let page = 1; page <= MOST_PAGES; page++) {
            const answer = await ask(`${app.definitions}?$page=${page}&$pageSize=${LARGEST_PAGE}`);
            // seen live: the answer repeats the size asked for. One that does not may have cut
            // its pages shorter, and then a short page is not the last one
            if (
                !answer.isOk ||
                !Array.isArray(answer.body.definitions) ||
                answer.body.pageSize !== LARGEST_PAGE
            ) {
                return;
            }
            for (const row of answer.body.definitions) {
                const key = row?.definitionKey;
                // a key that comes twice: the page asked for was ignored, or the list moved
                if (typeof key !== 'string' || key === '' || keys.has(key)) {
                    return;
                }
                keys.add(key);
                rows.push(row);
            }
            // only a short page is the last one: the count of the answer is that of the page
            if (answer.body.definitions.length < LARGEST_PAGE) {
                return rows;
            }
        }
    }

    /**
     * Reads what the judgement takes of the transactional definitions of the app. For SMS, every
     * definition is read by itself for its id, whatever it is called; one that the API says is
     * not there any more has no message left and is passed over. For push, the names of those
     * that are not deleted.
     *
     * @returns {Promise.<{isComplete: boolean, ids?: Set.<string>, names?: Set.<string>, keys?: Map.<string, string[]>}>} what was read; not complete when anything of it could not be read or had another shape than expected
     */
    async function readDefinitions() {
        const rows = await readList();
        if (!rows) {
            return { isComplete: false };
        }
        if (app.kind === 'push') {
            const names = new Set();
            // several definitions can have the same name
            const keys = new Map();
            for (const row of rows) {
                if (typeof row.name !== 'string' || typeof row.status !== 'string') {
                    return { isComplete: false };
                }
                if (same(row.status) === DELETED) {
                    continue;
                }
                const name = same(row.name);
                names.add(name);
                keys.set(name, [...(keys.get(name) ?? []), row.definitionKey]);
            }
            return { isComplete: true, names, keys };
        }
        const ids = new Set();
        // the key of the definition with an id, for the link to it
        const keys = new Map();
        let isComplete = true;
        let next = 0;
        const work = async () => {
            while (isComplete && next < rows.length) {
                const key = rows[next++].definitionKey;
                const answer = await ask(`${app.definitions}/${encodeURIComponent(key)}`);
                if (answer.isOk) {
                    if (isId(answer.body.definitionId)) {
                        ids.add(same(answer.body.definitionId));
                        keys.set(same(answer.body.definitionId), key);
                    } else {
                        isComplete = false;
                    }
                } else if (
                    answer.status !== NOT_FOUND ||
                    String(answer.body?.errorcode) !== ORPHANED
                ) {
                    isComplete = false;
                }
            }
        };
        await Promise.all(Array.from({ length: DETAILS_AT_ONCE }, work));
        return isComplete ? { isComplete, ids, keys } : { isComplete: false };
    }

    /**
     * Asks the Marketing Cloud page for something, through the extension. It never throws.
     *
     * @param {object} message what to ask
     * @returns {Promise.<object|undefined>} the answer; nothing when none came
     */
    async function askPage(message) {
        try {
            return await chrome.runtime.sendMessage(message);
        } catch {
            // the extension was updated or switched off, or the page does not listen
        }
    }

    /**
     * Reads the business unit this frame is logged in to.
     *
     * @returns {Promise.<string|undefined>} its MID; nothing when it could not be read
     */
    async function readMid() {
        const answer = await ask('platform/v1/tokenContext');
        const mid = answer.isOk ? answer.body.organization?.id : undefined;
        return Number.isSafeInteger(mid) ? String(mid) : undefined;
    }

    /**
     * Reads which journey versions use which push message. The Marketing Cloud page reads the
     * journeys, page by page, because this frame may not. What was read counts as complete only
     * when every page came, each for the business unit this frame is in, all with the same
     * count, and as many different versions came as that count says. The list is read again, a
     * few times at most, while versions are missing, because its order is not fixed. Journeys that
     * send once are counted by themselves, because nobody has seen whether the list has them:
     * as many of their versions must have come as the business unit has.
     *
     * @param {(text: string) => void} say takes how far it is
     * @param {() => boolean} isWanted false once nobody waits for the rest any more
     * @returns {Promise.<{isComplete: boolean, users?: Map.<string, object[]>, smsUsers?: Map.<string, object[]>}>} the versions that use a push message, by the id of the message, and those that use an SMS message, by the number in its id, each with its name, version, status and the address of its journey
     */
    async function readJourneys(say, isWanted) {
        const incomplete = { isComplete: false };
        const mid = await readMid();
        if (mid === undefined) {
            return incomplete;
        }
        // the versions that were read, by journey and version number
        const versions = new Map();
        let count;
        let singleSends;
        let origin;
        /**
         * Takes a page of the list as the Marketing Cloud page answered it.
         *
         * @param {object|undefined} answer what the page answered
         * @param {number} page which page it is, from 1
         * @returns {boolean} false when it did not come or had another shape than expected
         */
        const hasTaken = (answer, page) => {
            if (
                answer?.isOk !== true ||
                answer.mid !== mid ||
                answer.pageSize !== JOURNEY_PAGE ||
                !Number.isSafeInteger(answer.count) ||
                (count !== undefined && answer.count !== count) ||
                !Number.isSafeInteger(answer.singleSends) ||
                (singleSends !== undefined && answer.singleSends !== singleSends) ||
                typeof answer.origin !== 'string' ||
                !SHELL.test(answer.origin) ||
                !Array.isArray(answer.journeys)
            ) {
                return false;
            }
            // every page is full, bar the last one, which has the rest
            const rest = answer.count - (page - 1) * JOURNEY_PAGE;
            if (answer.journeys.length !== Math.max(0, Math.min(JOURNEY_PAGE, rest))) {
                return false;
            }
            ({ count, singleSends, origin } = answer);
            for (const journey of answer.journeys) {
                if (
                    typeof journey?.id !== 'string' ||
                    !JOURNEY_ID.test(journey.id) ||
                    typeof journey.name !== 'string' ||
                    typeof journey.type !== 'string' ||
                    typeof journey.status !== 'string' ||
                    !Number.isSafeInteger(journey.version) ||
                    !Array.isArray(journey.pushIds) ||
                    journey.pushIds.some((pushId) => typeof pushId !== 'string') ||
                    !Array.isArray(journey.smsIds) ||
                    // an id of another form cannot be held against a message
                    journey.smsIds.some((smsId) => numberOf(smsId) === undefined)
                ) {
                    return false;
                }
                const key = `${same(journey.id)}/${journey.version}`;
                const known = versions.get(key);
                // seen live: the list is not in a fixed order, so a version can come on two
                // pages while another one comes on none. Twice is fine, as long as it names the
                // same messages both times
                if (
                    known &&
                    (known.pushIds.join(',') !== journey.pushIds.join(',') ||
                        known.smsIds.join(',') !== journey.smsIds.join(','))
                ) {
                    return false;
                }
                versions.set(key, journey);
            }
            return true;
        };
        /**
         * Reads the whole list once and adds its versions to those that were read.
         *
         * @param {number} pass which read of the list this is, from 1
         * @returns {Promise.<boolean>} false when it was given up
         */
        const hasReadAll = async (pass) => {
            const again = pass === 1 ? '' : ' again, because the list moved meanwhile';
            for (let page = 1; page <= MOST_JOURNEY_PAGES && isWanted(); page++) {
                say(
                    count === undefined
                        ? 'Reading the journeys …'
                        : `Reading the journeys${again}, page ${page} of ${Math.ceil(count / JOURNEY_PAGE)} …`,
                );
                if (!hasTaken(await askPage({ type: JOURNEYS, page }), page)) {
                    return false;
                }
                if (page * JOURNEY_PAGE >= count) {
                    return true;
                }
            }
            return false;
        };
        // until there are as many different versions as the business unit has: none is missing
        for (let pass = 1; pass <= MOST_JOURNEY_PASSES && versions.size !== count; pass++) {
            if (!(await hasReadAll(pass))) {
                return incomplete;
            }
        }
        if (versions.size !== count) {
            return incomplete;
        }
        const users = new Map();
        const smsUsers = new Map();
        let singleSendsRead = 0;
        for (const journey of versions.values()) {
            if (journey.type === SINGLE_SEND) {
                singleSendsRead++;
            }
            const user = {
                name: journey.name,
                version: journey.version,
                status: journey.status,
                href: `${origin}/cloud/#app/Journey%20Builder/%23${journey.id}/${journey.version}`,
            };
            for (const pushId of journey.pushIds) {
                users.set(same(pushId), [...(users.get(same(pushId)) ?? []), user]);
            }
            for (const smsId of journey.smsIds) {
                const number = numberOf(smsId);
                smsUsers.set(number, [...(smsUsers.get(number) ?? []), user]);
            }
        }
        // the frame may have been logged in to another business unit meanwhile
        return singleSendsRead === singleSends && (await readMid()) === mid
            ? { isComplete: true, users, smsUsers }
            : incomplete;
    }

    /**
     * Reads a message and judges it. The transactional definitions are read when the first
     * message needs them, once for all messages of the same click. The journeys are taken as
     * they were read for this click, if they were.
     *
     * @param {{definitions?: Promise.<object>, journeys?: object}} run what belongs to one click on a delete button
     * @param {string} id id of the message
     * @returns {Promise.<{id: string, isAllowed: boolean, reason?: string, name?: string}>} the judgement, with what judge() adds to it for the dialog
     */
    async function inspect(run, id) {
        const answer = await ask(app.message + encodeURIComponent(id));
        if (!answer.isOk) {
            return {
                id,
                isAllowed: false,
                reason: `It could not be read again, so nothing is known about it: ${answer.message}`,
            };
        }
        let verdict = judge(app.kind, id, answer.body, undefined, run.journeys);
        if (verdict.needs) {
            run.definitions ??= readDefinitions();
            verdict = judge(app.kind, id, answer.body, await run.definitions, run.journeys);
        }
        // a judgement that was handed the definitions no longer asks for them
        return { id, ...verdict };
    }

    /**
     * Writes how many messages something is about.
     *
     * @param {number} count how many
     * @returns {string} "1 message" or "n messages"
     */
    function messages(count) {
        return count === 1 ? '1 message' : `${count} messages`;
    }

    /**
     * Builds what a refused message offers to go on with: a link to each journey version that
     * uses it, a link that looks for the journey, or a link to each transactional message it is
     * taken to belong to.
     *
     * @param {{users?: object[], isFindable?: boolean, keys?: string[]}} item the message, as it was judged
     * @param {{open: (key: string) => void, find: () => void}} act what the links do
     * @returns {HTMLElement[]} the links
     */
    function offers(item, act) {
        const links = [];
        const users = item.users ?? [];
        for (const user of users) {
            const link = make(
                'a',
                'link',
                `Open journey “${user.name}” (version ${user.version}${user.status ? `, ${user.status}` : ''})`,
            );
            link.href = user.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = `${MADE_BY}: opens this journey in a new tab.`;
            links.push(link);
        }
        if (item.isFindable) {
            const find = make('button', 'link', 'Find the journey');
            find.type = 'button';
            find.setAttribute(MARK, 'find');
            find.title = `${MADE_BY}: reads all journeys of this business unit to find the one that uses this message. That can take a while.`;
            find.addEventListener('click', act.find);
            links.push(find);
        }
        const keys = item.keys ?? [];
        for (const key of keys) {
            const open = make(
                'button',
                'link',
                keys.length === 1
                    ? 'Open the transactional message'
                    : `Open the transactional message “${key}”`,
            );
            open.type = 'button';
            open.setAttribute(MARK, 'open');
            open.value = key;
            open.title = `${MADE_BY}: closes this dialog and opens the transactional message in the panel Transactional Messages.`;
            open.addEventListener('click', () => act.open(key));
            links.push(open);
        }
        return links;
    }

    /**
     * Builds a list of messages, each by its name and with what is said about it.
     *
     * @param {{id: string, name?: string, said?: string}[]} items the messages
     * @param {{open: (key: string) => void, find: () => void}} [act] what the links of a message do; without it the messages get none
     * @returns {HTMLUListElement} the list
     */
    function listed(items, act) {
        const list = make('ul', 'list');
        for (const item of items) {
            const entry = make('li');
            // a message that could not be read has no name
            const name = make('strong', undefined, item.name ?? `Message ${item.id}`);
            name.title = `ID ${item.id}`;
            entry.append(name);
            if (item.said) {
                entry.append(make('span', 'said', ` — ${item.said}`));
            }
            const links = act ? offers(item, act) : [];
            for (const link of links) {
                entry.append(' ', link);
            }
            list.append(entry);
        }
        return list;
    }

    /**
     * Deletes the messages the user confirmed, one after the other. Each is read and judged
     * again first and passed over when it is no longer allowed or no longer has the name that
     * was shown. A failure does not stop the rest.
     *
     * @param {object} run what belongs to this click
     * @param {{id: string, name: string, isJourneyMade?: boolean}[]} allowed the messages to delete
     * @param {HTMLElement} progress where it says how far it is
     * @returns {Promise.<{id: string, name: string, state: string, said?: string}[]>} what came of each
     */
    async function carryOut(run, allowed, progress) {
        const results = [];
        // what was read of the journeys for the question may be out of date: it is not kept, and
        // they are read anew, once, when a message to delete is a journey's
        run.journeys = undefined;
        if (allowed.some((item) => item.isJourneyMade)) {
            run.journeys = await readJourneys(
                (text) => {
                    progress.textContent = text;
                },
                () => run.dialog.isConnected,
            );
        }
        for (const [index, item] of allowed.entries()) {
            const done = (state, said) => {
                results.push({ ...item, state, said });
            };
            // without the dialog nobody sees what happens: nothing more is sent
            if (!run.dialog.isConnected) {
                done('skipped', 'The dialog was closed.');
                continue;
            }
            progress.textContent = `Deleting ${index + 1} of ${allowed.length} …`;
            const again = await inspect(run, item.id);
            if (!again.isAllowed) {
                done('skipped', `Not deleted, because it changed meanwhile. ${again.reason}`);
                continue;
            }
            if (again.name !== item.name) {
                done('skipped', 'Not deleted, because it has another name now.');
                continue;
            }
            const answer = await ask(app.message + encodeURIComponent(item.id), 'DELETE');
            if (answer.isOk) {
                done('deleted');
            } else if (answer.isUnanswered) {
                done('unknown', `It is not known whether it was deleted: ${answer.message}`);
            } else {
                done('failed', `Not deleted: ${answer.message}`);
            }
        }
        return results;
    }

    /**
     * Opens the dialog for the chosen messages: reads and judges each, then names those that
     * will be deleted and those that will not, and deletes only after the click on its button.
     *
     * @param {string[]} ids ids of the chosen messages
     * @param {boolean} isDetails true when asked from the page of one message
     */
    async function start(ids, isDetails) {
        if (dialog?.isConnected || ids.length === 0) {
            return;
        }
        const run = { isOver: false, isBusy: false, after: undefined };
        const box = make('dialog', 'dialog');
        dialog = box;
        run.dialog = box;
        const head = make('div', 'head');
        head.append(
            make('h2', undefined, 'Delete messages'),
            icon('added this dialog, which asks before messages are deleted.'),
            make('span', 'by', MADE_BY),
        );
        const body = make('div', 'body');
        const buttons = make('div', 'buttons');
        box.append(head, body, buttons);
        /**
         * Builds a button of the dialog.
         *
         * @param {string} part what it is, for the stylesheet
         * @param {string} text what it says
         * @param {() => void} act what a click does
         * @returns {HTMLButtonElement} the button
         */
        const button = (part, text, act) => {
            const made = make('button', part, text);
            made.type = 'button';
            made.addEventListener('click', act);
            return made;
        };
        const close = () => box.close();
        // Esc must not close the dialog while messages are being deleted
        box.addEventListener('cancel', (event) => {
            if (run.isBusy) {
                event.preventDefault();
            }
        });
        box.addEventListener('close', () => {
            run.isOver = true;
            box.remove();
            run.after?.();
        });
        body.append(
            make(
                'p',
                undefined,
                `Reading ${messages(ids.length)} again before anything is deleted …`,
            ),
        );
        buttons.append(button('cancel', 'Cancel', close));
        document.body.append(box);
        box.showModal();

        /**
         * Reads and judges every chosen message.
         *
         * @returns {Promise.<object[]|undefined>} the judgements; nothing when the dialog was closed meanwhile
         */
        const check = async () => {
            const checked = [];
            for (const id of ids) {
                checked.push(await inspect(run, id));
                if (run.isOver) {
                    return;
                }
            }
            return checked;
        };
        const act = {
            // the panel opens on top; this dialog has nothing more to say then
            open: (key) => {
                askPage({ type: PANEL_OPEN, kind: app.kind, key });
                close();
            },
            // one search serves every message of the dialog; then all are read and judged anew
            find: async () => {
                const progress = make('p', 'progress');
                progress.setAttribute('role', 'status');
                body.replaceChildren(progress);
                buttons.replaceChildren(button('cancel', 'Cancel', close));
                run.journeys = await readJourneys(
                    (text) => {
                        progress.textContent = text;
                    },
                    () => !run.isOver,
                );
                if (run.isOver) {
                    return;
                }
                progress.textContent = `Reading ${messages(ids.length)} again …`;
                const again = await check();
                if (again) {
                    draw(again);
                }
            },
        };
        /**
         * Shows which messages will be deleted and which will not, and the button that deletes.
         *
         * @param {object[]} checked the judgements
         */
        function draw(checked) {
            const allowed = checked
                .filter((item) => item.isAllowed)
                .map((item) => ({ ...item, said: item.note }));
            const refused = checked
                .filter((item) => !item.isAllowed)
                .map((item) => ({ ...item, said: item.reason }));
            body.replaceChildren();
            if (allowed.length) {
                body.append(
                    make('h3', undefined, `Will be deleted (${allowed.length})`),
                    listed(allowed),
                    make(
                        'p',
                        'warning',
                        'Marketing Cloud cannot bring a deleted message back. Whatever still sends with it will fail.',
                    ),
                );
            }
            if (refused.length) {
                body.append(
                    make('h3', undefined, `Will not be deleted (${refused.length})`),
                    listed(refused, act),
                );
            }
            if (allowed.length === 0) {
                buttons.replaceChildren(button('cancel', 'Close', close));
                return;
            }
            buttons.replaceChildren(
                button('delete', `Delete ${messages(allowed.length)}`, () => carry(allowed)),
                button('cancel', 'Cancel', close),
            );
        }
        /**
         * Deletes the messages the user confirmed and shows what came of each.
         *
         * @param {object[]} allowed the messages to delete
         */
        async function carry(allowed) {
            run.isBusy = true;
            const progress = make('p', 'progress');
            body.replaceChildren(progress);
            buttons.replaceChildren();
            const results = await carryOut(run, allowed, progress);
            run.isBusy = false;
            const count = (state) => results.filter((item) => item.state === state).length;
            const summary = [`${count('deleted')} deleted`, `${count('failed')} failed`];
            if (count('skipped')) {
                summary.push(`${count('skipped')} not deleted because they changed`);
            }
            if (count('unknown')) {
                summary.push(`${count('unknown')} unknown`);
            }
            body.replaceChildren(make('p', 'result', `${summary.join(', ')}.`));
            const others = results.filter((item) => item.state !== 'deleted');
            if (others.length) {
                body.append(listed(others));
            }
            for (const item of results) {
                if (item.state === 'deleted') {
                    selected.delete(item.id);
                }
            }
            // the list is read again once the result was seen
            const isChanged = count('deleted') + count('unknown') > 0;
            if (isChanged) {
                run.after =
                    isDetails && count('deleted')
                        ? () => shared.toOverview()
                        : () => shared.reload();
            }
            // the dialog was closed meanwhile, so nobody sees the result: what Close would do
            // is done now, because messages may be deleted already
            if (!box.isConnected) {
                run.after?.();
                return;
            }
            buttons.replaceChildren(button('cancel', 'Close', close));
        }
        const checked = await check();
        if (checked) {
            draw(checked);
        }
    }

    /**
     * Reads the id of the message whose page the route is that of.
     *
     * @returns {string|undefined} the id; nothing on any other route
     */
    function routeId() {
        const found = app.route?.exec(location.hash);
        if (!found) {
            return;
        }
        try {
            return decodeURIComponent(found[1]) || undefined;
        } catch {
            // no id that could be asked for
        }
    }

    /**
     * Keeps the "Delete" button in the header of a message's page: there while the route is that
     * of a message and the header is on the page, gone otherwise.
     */
    function syncDetails() {
        const id = routeId();
        const found = id === undefined ? null : document.querySelector(app.header);
        const header = found && document.querySelector(app.title) ? found : null;
        for (const old of document.querySelectorAll(DETAILS_BUTTON)) {
            if (old.parentElement !== header || old.value !== id) {
                old.remove();
            }
        }
        if (!header || header.querySelector(DETAILS_BUTTON)) {
            return;
        }
        const { button } = marked(
            'details',
            'Delete',
            'added this button, which deletes this message.',
        );
        button.value = id;
        button.addEventListener('click', () => {
            // only the message whose page is still the one on show
            if (routeId() === button.value) {
                start([button.value], true);
            }
        });
        header.append(button);
    }

    /**
     * Lists the ticked messages that the list shows, in the order of its rows.
     *
     * @param {Element} repeater the list
     * @returns {string[]} their ids
     */
    function chosen(repeater) {
        const ids = [];
        for (const row of repeater.querySelectorAll(ROWS)) {
            const id = app.rowId(row);
            if (id && selected.has(id) && !ids.includes(id)) {
                ids.push(id);
            }
        }
        return ids;
    }

    /**
     * Keeps the checkbox of a row where it belongs: in room on the left of the app's own first
     * cell, once. It is made again when the app drew the content of that cell again, and whatever
     * the app copied or moved elsewhere in the row is taken away. A row that names no message
     * keeps nothing of the script.
     *
     * @param {HTMLTableRowElement} row a row of a list
     * @param {string} [id] id of the row's message, if it names one
     * @returns {HTMLInputElement|undefined} the checkbox; nothing for a row that names no message
     */
    function syncRow(row, id) {
        const [cell] = row.cells;
        const kept = id
            ? [...cell.children].find(
                  (child) => child.matches(GUTTER) && child.querySelector(ROW_BOX),
              )
            : undefined;
        for (const old of row.querySelectorAll(GUTTER)) {
            if (old !== kept) {
                old.remove();
            }
        }
        for (const old of row.querySelectorAll(`.${GUTTER_CELL}`)) {
            if (!id || old !== cell) {
                old.classList.remove(GUTTER_CELL);
            }
        }
        if (!id) {
            return;
        }
        cell.classList.add(GUTTER_CELL);
        if (kept) {
            return kept.querySelector(ROW_BOX);
        }
        const gutter = make('span', 'gutter');
        gutter.setAttribute(MARK, 'gutter');
        const box = make('input', 'check');
        box.type = 'checkbox';
        box.setAttribute(MARK, 'row');
        box.title = `Select for “Delete selected” (${MADE_BY})`;
        box.setAttribute('aria-label', 'Select this message for deleting');
        gutter.append(box);
        cell.prepend(gutter);
        return box;
    }

    /**
     * Keeps the header of a table in step with its rows: the same room on the left of its first
     * cell while a row has a checkbox, none otherwise.
     *
     * @param {HTMLTableElement} table a table of the list
     * @param {boolean} isWanted true while a row of it has a checkbox
     */
    function syncHead(table, isWanted) {
        for (const row of table.querySelectorAll(HEAD_ROWS)) {
            for (const cell of row.cells) {
                cell.classList.toggle(GUTTER_HEAD, isWanted && cell === row.cells[0]);
            }
        }
    }

    /**
     * Keeps the checkboxes of the list and its "Delete selected" button in step with the rows
     * the list shows now. A message that the list no longer shows is no longer chosen.
     */
    function syncList() {
        const repeater = document.querySelector(app.repeater);
        const header = repeater?.querySelector('.repeater-header');
        if (!header) {
            return;
        }
        let button = header.querySelector(SELECTED_BUTTON);
        if (!button) {
            ({ button } = marked(
                'selected',
                '',
                'added this button, which deletes the messages you ticked in the list.',
            ));
            button.addEventListener('click', () => {
                const list = document.querySelector(app.repeater);
                if (list) {
                    start(chosen(list), false);
                }
            });
            (header.querySelector('.repeater-header-left') ?? header).append(button);
        }
        const present = new Set();
        // the tables that have a row with a checkbox
        const boxed = new Set();
        for (const row of repeater.querySelectorAll(ROWS)) {
            const id = app.rowId(row);
            const box = syncRow(row, id);
            if (!box) {
                continue;
            }
            present.add(id);
            boxed.add(row.closest('table'));
            if (box.value !== id) {
                box.value = id;
            }
            if (box.checked !== selected.has(id)) {
                box.checked = selected.has(id);
            }
        }
        for (const table of repeater.querySelectorAll('table')) {
            syncHead(table, boxed.has(table));
        }
        // a list without rows is one that is being drawn again: what was chosen is kept until
        // its rows are back, and does not count while they are away
        if (present.size) {
            for (const id of selected) {
                if (!present.has(id)) {
                    selected.delete(id);
                }
            }
        }
        const count = [...selected].filter((id) => present.has(id)).length;
        const label = button.querySelector('span');
        const text = `Delete selected (${count})`;
        if (label.textContent !== text) {
            label.textContent = text;
        }
        button.disabled = count === 0;
    }

    /**
     * Puts the buttons and checkboxes where they belong on the page as it is now.
     */
    function sync() {
        if (app.route) {
            syncDetails();
        }
        syncList();
    }

    // a click on a row opens its message; one in the room of the checkbox must not, on the box
    // or next to it. That room is an element of the script that lies over the left of the cell,
    // so whatever is clicked there is the script's, and a click on the name is the app's. The
    // click is stopped on its way down, before anything of the app hears of it. The browser
    // still ticks a box that was clicked, and next to the box nothing happens
    document.addEventListener(
        'click',
        (event) => {
            if (event.target instanceof Element && event.target.closest(GUTTER)) {
                event.stopPropagation();
            }
        },
        { capture: true },
    );
    // heard here and not on each box, so that a box the app copied along with its row counts too
    document.addEventListener('change', (event) => {
        const box = event.target;
        if (!(box instanceof Element) || !box.matches(ROW_BOX)) {
            return;
        }
        if (box.checked) {
            selected.add(box.value);
        } else {
            selected.delete(box.value);
        }
        syncList();
    });
    // a transactional message deleted in the extension's panel takes its message with it: the
    // list of this app is read again once the panel is closed, unless a dialog of this script is
    // open, which reads what it needs itself
    chrome.runtime.onMessage.addListener((message, sender) => {
        if (
            // passed on by the extension itself, not sent by the script of a page
            sender.id === chrome.runtime.id &&
            !sender.tab &&
            message?.type === PANEL_CLOSED &&
            message.kind === app.kind &&
            app.repeater &&
            document.querySelector(app.repeater) &&
            !dialog?.isConnected
        ) {
            shared.reload();
        }
        return false;
    });
    // both apps draw their pages without loading them: the route changes, and so does the page
    new MutationObserver(sync).observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
    addEventListener('hashchange', sync);
    sync();
})();
