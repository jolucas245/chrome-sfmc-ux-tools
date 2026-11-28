/*
 * SFMC UX Tools — background script: loads the TypeScript script into a document that asks for it,
 * and passes messages about links from the frames of Content Builder, Email Studio and Contact
 * Builder to the page around them, and three from that page to the frames below it. It also asks
 * that page, for Email Studio's frame, for the data extensions of the folder of an open one.
 *
 * The TypeScript script is too large to run in every frame of Content Builder and Automation
 * Studio. A document with a code editor asks for it through editor-typescript-loader.js; it then
 * runs in the page's own script world, next to the language script that uses it.
 */
(() => {
    'use strict';

    const NEED_MESSAGE = 'sfmc-ux-tools:need-typescript';
    const FILE = 'editor-typescript.js';
    // the frames the manifest runs the editor scripts in: those of Content Builder ...
    const EDITOR_FRAME = 'https://content-builder.';
    // ... and the documents of Automation Studio, on any stack of Marketing Cloud's apps
    const APP_PROTOCOL = 'https:';
    const APP_HOST = '.marketingcloudapps.com';
    const AUTOMATION_STUDIO = '/AutomationStudioFuel3/';
    // what Content Builder's frame asks of and tells the Marketing Cloud page around it, for the
    // links to an asset: see deep-link-content-builder.js and deep-link-shell.js
    const DEEP_LINK_WANTED = 'sfmc-ux-tools:deep-link:wanted';
    const DEEP_LINK_SHOWN = 'sfmc-ux-tools:deep-link:shown';
    const DEEP_LINK_MESSAGES = [DEEP_LINK_WANTED, DEEP_LINK_SHOWN];
    // what the Marketing Cloud page asks of Content Builder's frame: to close the asset that is
    // open, when the browser stepped back to Content Builder's plain address
    const DEEP_LINK_CLOSE = 'sfmc-ux-tools:deep-link:close';
    // what that page asks of the frames when the browser stepped to an entry with a link: of
    // Content Builder's to open an asset, of Contact Builder's to show a route
    const DEEP_LINK_OPEN = 'sfmc-ux-tools:deep-link:open';
    const CONTACT_LINK_OPEN = 'sfmc-ux-tools:deep-link:contact-open';
    // where that page is, on any stack: the start and the end of its host, and its path
    const SHELL_HOST = 'mc.';
    const SHELL_DOMAIN = '.exacttarget.com';
    const SHELL_PATH = '/cloud/';
    // the same two of Email Studio's frame, for the links to a view of it: see
    // deep-link-email-studio.js
    const EMAIL_LINK_WANTED = 'sfmc-ux-tools:deep-link:email-wanted';
    const EMAIL_LINK_SHOWN = 'sfmc-ux-tools:deep-link:email-shown';
    const EMAIL_LINK_MESSAGES = [EMAIL_LINK_WANTED, EMAIL_LINK_SHOWN];
    // what Contact Builder's frame tells that page, for the links to what is open in it: see
    // deep-link-contact-builder.js
    const CONTACT_LINK_SHOWN = 'sfmc-ux-tools:deep-link:contact-shown';
    // where Contact Builder's frame is, on any stack of Marketing Cloud's apps: its path
    const CONTACT_BUILDER_PATH = '/contactsmeta/';
    // the longest route inside Contact Builder that is taken for one, and such a route: letters,
    // digits, and the four signs seen in Contact Builder's routes
    const MOST_ROUTE = 200;
    const CONTACT_ROUTE = new RegExp(String.raw`^[A-Za-z\d/_.-]{1,${MOST_ROUTE}}$`);
    // the start of the host of Content Builder's frames
    const CONTENT_BUILDER_HOST = 'content-builder.';
    // where Email Studio's frame is: the start and the end of its host, and its path
    const EMAIL_STUDIO_HOST = 'members.';
    const EMAIL_STUDIO_DOMAIN = '.exacttarget.com';
    const EMAIL_STUDIO_PATH = '/C12/Default.aspx';
    // the longest id of an asset that is taken for one: as many digits as a whole number holds
    // exactly
    const MOST_DIGITS = 15;
    const ASSET_ID = new RegExp(String.raw`^\d{1,${MOST_DIGITS}}$`);
    // the longest name of a part of a route inside Email Studio that is taken for one, and the
    // longest id in it: as long as an id of 32 hex digits with its four hyphens
    const MOST_LETTERS = 30;
    const MOST_ROUTE_ID = 36;
    const WORD = String.raw`[A-Za-z\d]{1,${MOST_LETTERS}}`;
    // what Email Studio's frame may say it shows: r for a route, its two names and an id of
    // digits, or of hex digits and hyphens
    const EMAIL_TARGET = new RegExp(
        String.raw`^r\.${WORD}\.${WORD}\.[\dA-Fa-f][\dA-Fa-f-]{0,${MOST_ROUTE_ID - 1}}$`,
    );
    // what a frame of Mobile Studio asks of the Marketing Cloud page: to open the panel
    // Transactional Messages on one message, and to read one page of the journeys, which
    // MobilePush's frame may not read itself
    const MOBILE_PANEL_OPEN = 'sfmc-ux-tools:mobile:panel-open';
    const MOBILE_JOURNEYS = 'sfmc-ux-tools:mobile:journeys';
    const MOBILE_MESSAGES = [MOBILE_PANEL_OPEN, MOBILE_JOURNEYS];
    // what that page tells the frames of Mobile Studio: its panel was closed after it deleted a
    // transactional message of a channel
    const MOBILE_PANEL_CLOSED = 'sfmc-ux-tools:mobile:panel-closed';
    const MOBILE_KINDS = ['sms', 'push'];
    // where the apps of Mobile Studio are; Marketing Cloud writes these paths with capitals or
    // without, so they are compared in small letters
    const MOBILE_PATHS = ['/mobilepush/', '/mobileconnectfuel3/', '/mobile/'];
    // the key of a transactional message as it is passed on: text on one line. Nobody measured
    // how long such a key can be; this is far above the 36 characters the panel lets type
    const MOST_KEY = 200;
    const MOBILE_KEY = new RegExp(String.raw`^[^\u0000-\u001F\u007F]{1,${MOST_KEY}}$`);
    // the pages of journeys that are passed on at most
    const MOST_JOURNEY_PAGES = 1000;
    // what Email Studio's frame asks the Marketing Cloud page for: the data extensions of the
    // folder of an open data extension, see email-studio-de-switcher.js and
    // email-studio-de-switcher-shell.js; the id of a data extension, and how many of them, with
    // how long a name, are passed back at most
    const SWITCHER_LIST = 'sfmc-ux-tools:de-switcher:list';
    const DE_ID = /^[\dA-Fa-f]{8}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{12}$/;
    const MOST_ENTRIES = 1000;
    const MOST_NAME = 200;
    // the id Chrome gives the page of a tab, as opposed to the frames in it
    const TOP_FRAME = 0;
    // by document: whether the script could be loaded into it. Forgotten when the browser stops
    // this script, which the TypeScript script allows for by doing nothing the second time
    const injections = new Map();

    /**
     * Tells whether a document is one the editor scripts run in.
     *
     * @param {unknown} address the document's address, as Chrome names it
     * @returns {boolean} true for a frame of Content Builder and for Automation Studio
     */
    function isEditorFrame(address) {
        if (typeof address !== 'string') {
            return false;
        }
        if (address.startsWith(EDITOR_FRAME)) {
            return true;
        }
        try {
            // read as the browser reads it, so that nothing in the address can pass for its host
            const { protocol, hostname, pathname } = new URL(address);
            return (
                protocol === APP_PROTOCOL &&
                hostname.endsWith(APP_HOST) &&
                pathname.startsWith(AUTOMATION_STUDIO)
            );
        } catch {
            return false;
        }
    }

    /**
     * Runs the TypeScript script in a document.
     *
     * @param {number} tabId tab of the document
     * @param {string} documentId the document, which a frame only shows until it loads another one
     * @returns {Promise.<boolean>} false if the document is gone or cannot be reached
     */
    async function inject(tabId, documentId) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId, documentIds: [documentId] },
                files: [FILE],
                world: 'MAIN',
            });
            return true;
        } catch {
            // may be asked for again
            injections.delete(documentId);
            return false;
        }
    }

    /**
     * Tells the document that asked whether it has the script now, once per request.
     *
     * @param {object} sender who sent the request, as Chrome describes it
     * @param {(answer: {isLoaded: boolean}) => void} sendResponse answers the request
     */
    async function answer(sender, sendResponse) {
        const { documentId } = sender;
        if (!injections.has(documentId)) {
            injections.set(documentId, inject(sender.tab.id, documentId));
        }
        sendResponse({ isLoaded: await injections.get(documentId) });
    }

    /**
     * Reads the address of a frame below the page of a tab.
     *
     * @param {object} sender who sent a message, as Chrome describes it
     * @returns {URL|undefined} the address; nothing for the page itself and for anything else
     */
    function frameAddress(sender) {
        if (
            typeof sender.tab?.id !== 'number' ||
            typeof sender.frameId !== 'number' ||
            sender.frameId === TOP_FRAME ||
            typeof sender.url !== 'string'
        ) {
            return;
        }
        try {
            // read as the browser reads it, so that nothing in the address can pass for its host
            const address = new URL(sender.url);
            return address.protocol === APP_PROTOCOL ? address : undefined;
        } catch {
            // no address
        }
    }

    /**
     * Tells whether a message comes from a frame of Content Builder below the page of a tab.
     *
     * @param {object} sender who sent the message, as Chrome describes it
     * @returns {boolean} true for such a frame only
     */
    function isContentBuilderFrame(sender) {
        const hostname = frameAddress(sender)?.hostname;
        return (
            hostname !== undefined &&
            hostname.startsWith(CONTENT_BUILDER_HOST) &&
            hostname.endsWith(APP_HOST)
        );
    }

    /**
     * Tells whether a message comes from Email Studio's frame below the page of a tab.
     *
     * @param {object} sender who sent the message, as Chrome describes it
     * @returns {boolean} true for such a frame only
     */
    function isEmailStudioFrame(sender) {
        const address = frameAddress(sender);
        return (
            address !== undefined &&
            address.hostname.startsWith(EMAIL_STUDIO_HOST) &&
            address.hostname.endsWith(EMAIL_STUDIO_DOMAIN) &&
            address.pathname === EMAIL_STUDIO_PATH
        );
    }

    /**
     * Tells whether a message comes from Contact Builder's frame below the page of a tab.
     *
     * @param {object} sender who sent the message, as Chrome describes it
     * @returns {boolean} true for such a frame only
     */
    function isContactBuilderFrame(sender) {
        const address = frameAddress(sender);
        return (
            address !== undefined &&
            address.hostname.endsWith(APP_HOST) &&
            address.pathname.startsWith(CONTACT_BUILDER_PATH)
        );
    }

    /**
     * Tells whether a message comes from a frame of MobilePush or MobileConnect below the page
     * of a tab.
     *
     * @param {object} sender who sent the message, as Chrome describes it
     * @returns {boolean} true for such a frame only
     */
    function isMobileStudioFrame(sender) {
        const address = frameAddress(sender);
        if (address === undefined || !address.hostname.endsWith(APP_HOST)) {
            return false;
        }
        const path = address.pathname.toLowerCase();
        return MOBILE_PATHS.some((item) => path.startsWith(item));
    }

    /**
     * Tells whether a message comes from the Marketing Cloud page itself, not from a frame in it.
     *
     * @param {object} sender who sent the message, as Chrome describes it
     * @returns {boolean} true for that page only
     */
    function isShellPage(sender) {
        if (
            typeof sender.tab?.id !== 'number' ||
            sender.frameId !== TOP_FRAME ||
            typeof sender.url !== 'string'
        ) {
            return false;
        }
        try {
            // read as the browser reads it, so that nothing in the address can pass for its host
            const { protocol, hostname, pathname } = new URL(sender.url);
            return (
                protocol === APP_PROTOCOL &&
                hostname.startsWith(SHELL_HOST) &&
                hostname.endsWith(SHELL_DOMAIN) &&
                pathname === SHELL_PATH
            );
        } catch {
            return false;
        }
    }

    /**
     * Tells whether a message about a link comes from the frame of the app it is about.
     *
     * @param {unknown} type the type of the message
     * @param {object} sender who sent the message, as Chrome describes it
     * @returns {boolean|undefined} true for that app's frame, false for any other sender; nothing when the message is not about a link
     */
    function isFromItsFrame(type, sender) {
        if (DEEP_LINK_MESSAGES.includes(type)) {
            return isContentBuilderFrame(sender);
        }
        if (EMAIL_LINK_MESSAGES.includes(type)) {
            return isEmailStudioFrame(sender);
        }
        if (type === CONTACT_LINK_SHOWN) {
            return isContactBuilderFrame(sender);
        }
        if (MOBILE_MESSAGES.includes(type)) {
            return isMobileStudioFrame(sender);
        }
    }

    /**
     * Reads what of a message about a link is passed on: its type and, of what a frame says it
     * shows, one text of the form that is expected there, or null. That the user caused what
     * Content Builder or Contact Builder shows is passed on only as the one value that says so.
     *
     * @param {{type: string, asset?: unknown, target?: unknown, route?: unknown, byUser?: unknown}} message what a frame sent
     * @returns {object} what the page gets
     */
    function passable(message) {
        const passed = { type: message.type };
        if (message.type === DEEP_LINK_SHOWN) {
            const isId = typeof message.asset === 'string' && ASSET_ID.test(message.asset);
            passed.asset = isId ? message.asset : null;
        }
        if (message.type === EMAIL_LINK_SHOWN) {
            const isTarget =
                typeof message.target === 'string' && EMAIL_TARGET.test(message.target);
            passed.target = isTarget ? message.target : null;
        }
        if (message.type === CONTACT_LINK_SHOWN) {
            const isRoute = typeof message.route === 'string' && CONTACT_ROUTE.test(message.route);
            passed.route = isRoute ? message.route : null;
        }
        if (message.type === MOBILE_PANEL_OPEN) {
            passed.kind = MOBILE_KINDS.includes(message.kind) ? message.kind : null;
            const isKey = typeof message.key === 'string' && MOBILE_KEY.test(message.key);
            passed.key = isKey ? message.key : null;
        }
        if (message.type === MOBILE_JOURNEYS) {
            const isPage =
                Number.isSafeInteger(message.page) &&
                message.page >= 1 &&
                message.page <= MOST_JOURNEY_PAGES;
            passed.page = isPage ? message.page : null;
        }
        const isStepped = message.type === DEEP_LINK_SHOWN || message.type === CONTACT_LINK_SHOWN;
        if (isStepped && message.byUser === true) {
            passed.byUser = true;
        }
        return passed;
    }

    /**
     * Passes a message about a link on to the page of the same tab, and its answer back.
     *
     * @param {{type: string, asset?: unknown, target?: unknown, route?: unknown}} message what the frame of an app sent
     * @param {number} tabId the tab of that frame
     * @param {(answer?: object) => void} sendResponse answers the frame
     */
    async function relay(message, tabId, sendResponse) {
        const passed = passable(message);
        try {
            sendResponse(await chrome.tabs.sendMessage(tabId, passed, { frameId: TOP_FRAME }));
        } catch {
            // the page is gone or does not listen: the frame gets no answer
            sendResponse();
        }
    }

    /**
     * Reads what of a request of the Marketing Cloud page is passed on to the frames below it:
     * its type and, for a request to open, the one id or route of the form that is expected.
     *
     * @param {{type?: unknown, asset?: unknown, route?: unknown}|null|undefined} message what was sent
     * @returns {object|null|undefined} what the frames get; null for a request to open that names nothing of the form; nothing when the message is no such request
     */
    function downward(message) {
        const type = message?.type;
        if (type === DEEP_LINK_CLOSE) {
            return { type };
        }
        if (type === DEEP_LINK_OPEN) {
            const isId = typeof message.asset === 'string' && ASSET_ID.test(message.asset);
            return isId ? { type, asset: message.asset } : null;
        }
        if (type === MOBILE_PANEL_CLOSED) {
            return MOBILE_KINDS.includes(message.kind) ? { type, kind: message.kind } : null;
        }
        if (type !== CONTACT_LINK_OPEN) {
            return;
        }
        const isRoute = typeof message.route === 'string' && CONTACT_ROUTE.test(message.route);
        return isRoute ? { type, route: message.route } : null;
    }

    /**
     * Passes a request of the Marketing Cloud page on to the frames of its tab. Only the script
     * of the app that the request is for listens for it. It never throws.
     *
     * @param {number} tabId the tab of that page
     * @param {object} passed what the frames get
     */
    async function passDown(tabId, passed) {
        try {
            await chrome.tabs.sendMessage(tabId, passed);
        } catch {
            // no frame listens: nothing is closed or opened
        }
    }

    /**
     * Reads what of the page's answer about the data extensions of a folder is passed back: the
     * id and the name of each, and whether the folder has more than were listed.
     *
     * @param {unknown} answer what the page answered
     * @returns {{items: {id: string, name: string}[], isCut: boolean}|{isFailed: true}} what the frame gets
     */
    function listed(answer) {
        if (typeof answer !== 'object' || answer === null || !Array.isArray(answer.items)) {
            return { isFailed: true };
        }
        const items = answer.items
            .filter(
                (item) =>
                    typeof item === 'object' &&
                    item !== null &&
                    typeof item.id === 'string' &&
                    DE_ID.test(item.id) &&
                    typeof item.name === 'string' &&
                    item.name.length > 0 &&
                    item.name.length <= MOST_NAME,
            )
            .slice(0, MOST_ENTRIES)
            .map(({ id, name }) => ({ id, name }));
        return { items, isCut: answer.isCut === true };
    }

    /**
     * Asks the Marketing Cloud page of a tab for the data extensions of the folder of one, and
     * answers the frame that asked. It never throws.
     *
     * @param {string} id id of the data extension
     * @param {number} tabId the tab of that frame
     * @param {(answer: object) => void} sendResponse answers the frame
     */
    async function askForList(id, tabId, sendResponse) {
        let answer;
        try {
            answer = await chrome.tabs.sendMessage(
                tabId,
                { type: SWITCHER_LIST, id },
                { frameId: TOP_FRAME },
            );
        } catch {
            // the page is gone or does not listen: told as a failure
        }
        sendResponse(listed(answer));
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === SWITCHER_LIST) {
            // taken from Email Studio's frame only, and only for an id of the form
            if (
                sender.id !== chrome.runtime.id ||
                !isEmailStudioFrame(sender) ||
                typeof message.id !== 'string' ||
                !DE_ID.test(message.id)
            ) {
                return false;
            }
            askForList(message.id, sender.tab.id, sendResponse);
            return true;
        }
        const down = downward(message);
        if (down !== undefined) {
            // taken from the Marketing Cloud page only; nobody waits for an answer
            if (down !== null && sender.id === chrome.runtime.id && isShellPage(sender)) {
                passDown(sender.tab.id, down);
            }
            return false;
        }
        // each app's messages are taken from that app's frame only
        const isItsFrame = isFromItsFrame(message?.type, sender);
        if (isItsFrame !== undefined) {
            if (!isItsFrame || sender.id !== chrome.runtime.id) {
                return false;
            }
            relay(message, sender.tab.id, sendResponse);
            // the answer follows once the page gave its own
            return true;
        }
        if (
            message?.type !== NEED_MESSAGE ||
            sender.id !== chrome.runtime.id ||
            typeof sender.tab?.id !== 'number' ||
            typeof sender.frameId !== 'number' ||
            typeof sender.documentId !== 'string' ||
            !isEditorFrame(sender.url)
        ) {
            return false;
        }
        answer(sender, sendResponse);
        // the answer follows once the script ran
        return true;
    });
})();
