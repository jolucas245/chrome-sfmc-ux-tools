/*
 * SFMC UX Tools — content script for the Marketing Cloud page that holds the app menu.
 *
 * Transactional SMS, push and OTT (WhatsApp and the like) messages exist in Marketing Cloud's
 * API only; no app shows them. This adds an entry "Transactional Messages" to the Mobile Studio
 * menu, which
 * opens a panel that lists those definitions, shows the details of one, creates and changes one
 * from a form and deletes one on request. The lists and the details come from
 * Marketing Cloud's own server, through the page's session, and so do the codes, keywords, apps
 * and contents that the forms let choose from and that the details name. A list is read once and kept while
 * the page lives; it is read again after a message was created, changed or deleted here, and
 * when "Refresh" is clicked. A list is read whole and shown in pages. What a list does not say of
 * a message, such as its code or its app, is read message by message once the list is on show,
 * and kept until the message changes. A new or changed message goes there
 * when its form is sent, and a delete only after a question that names the message. Before a
 * change or a delete, the message is read again and left alone if it is no longer the one shown.
 */
(() => {
    'use strict';

    const TITLE = 'Transactional Messages';
    // said wherever this script adds something, so that nobody takes it for Marketing Cloud's own
    const MADE_BY = 'SFMC UX Tools';
    const ICON = chrome.runtime.getURL('icons/icon16.png');
    const ISSUES = 'https://github.com/JoernBerkefeld/chrome-sfmc-ux-tools/issues';
    // where the page passes calls on to the REST API
    const API = '/cloud/fuelapi/';
    // the page refuses a PATCH request outright (seen live: 501 "Unsupported Request"); the API
    // takes a POST for one when this header says so
    const PATCH = 'PATCH';
    const OVERRIDE = 'X-HTTP-Method-Override';
    // the part of the API that holds the transactional messages
    const MESSAGES = 'messaging/v1/';
    // rows the API hands out per request unless asked otherwise
    const PAGE_SIZE = 50;
    // the largest page the API hands out of the definitions; it refuses to hand out a larger one
    // (seen live: 400 "pageSize must be an integer between 1 and 100")
    const LARGEST_PAGE = 100;
    // definitions the panel shows at a time; the rest of a list is a click on "Next" away
    const ROWS_SHOWN = 50;
    // details that are read at the same time, to leave Marketing Cloud's server to the page
    const DETAILS_AT_ONCE = 4;
    // where the extension's storage keeps the rows left out of the lists, and how many it keeps
    const UNREADABLE = 'transactionalUnreadable';
    const UNREADABLE_KEPT = 200;
    // Marketing Cloud keeps a deleted definition in its lists, with the status "Deleted"
    const NOT_DELETED = '$filter=status%20neq%20deleted';
    const MARK = 'data-sfmc-ux-tools-transactional';
    const NAME = 'sfmc-ux-tools-transactional';
    // the apps of Mobile Studio that the menu is recognised by
    const MOBILE_APPS = 'a[href$="#app/MobileConnect"], a[href$="#app/MobilePush"]';
    // what MobilePush's frame asks of this page, through the extension: to open the panel on one
    // push message, and to read one page of the journeys, which that frame may not read itself
    const PANEL_OPEN = 'sfmc-ux-tools:mobile:panel-open';
    const JOURNEYS = 'sfmc-ux-tools:mobile:journeys';
    // what this page tells the frames of Mobile Studio: the panel was closed after it deleted a
    // message of a channel, so that their list is read again
    const PANEL_CLOSED = 'sfmc-ux-tools:mobile:panel-closed';
    // journeys asked for per page; the answer must repeat it
    const JOURNEY_PAGE = 50;
    // what the journeys are asked for, and the kind of journey that sends once ("Single Send"):
    // nobody has seen whether the list of all journeys has those, so they are counted by themselves
    const JOURNEY_LIST = 'interaction/v1/interactions';
    const ALL_VERSIONS = 'mostRecentVersionOnly=false';
    const SINGLE_SEND = 'Quicksend';
    // the longest key of a transactional email; taken for these messages too, which nobody measured
    const KEY_MAX = 36;
    // the kind of Content Builder asset that holds a mobile message ("jsonmessage"); it is what
    // SFMC DevTools takes the content of a push message to be
    const MOBILE_MESSAGE = 230;
    // lines of the field a message is typed into
    const MESSAGE_ROWS = 8;
    // what makes a code editor of that field, in the order it is loaded: CodeMirror, then what
    // the extension adds to every code editor of Marketing Cloud, the colours and the language
    // features. They are files of the extension, loaded when a form with a message is opened
    const EDITOR_SCRIPTS = [
        'editor-codemirror.js',
        'language-data.js',
        'editor-highlight.js',
        'editor-language.js',
    ];
    // what formats the message in the editor of a form: the button, its key, and "format on
    // save". It brings Prettier and is large, so it is loaded only once a form has its editor
    const FORMAT_SCRIPT = 'editor-format.js';
    // tells that script about an editor of the panel, on the element around it: whether it is
    // one to format, which the editor of a form is and the one of the details is not
    const FORMAT_MARK = 'data-sfmc-ux-tools-format';
    const FORMATTED = 'on';
    const NOT_FORMATTED = 'off';
    // tells that script which button sends a form: with "format on save" it holds the click back
    // until the message is formatted
    const FORMAT_SAVE = 'data-sfmc-ux-tools-format-save';
    // the longest id that is taken for one: as many digits as a whole number holds exactly
    const MOST_DIGITS = 15;
    const ID = new RegExp(String.raw`^\d{1,${MOST_DIGITS}}$`);
    /**
     * Reads an id that is made of digits.
     *
     * @param {unknown} value what an answer of the API holds
     * @returns {string|undefined} the id; nothing for anything else
     */
    const idOf = (value) => {
        const text = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
        return ID.test(text) ? text : undefined;
    };
    // the name Marketing Cloud's editors have for their mode, by which those scripts know an editor
    const EDITOR_MODE = 'ampScriptHtmlMixed';
    // said of a stored code or keyword that the lists of the business unit do not hold
    const NOT_FOUND = ' — not found in this business unit';
    // set on the panel while it shows a list of messages: only the rows of the list scroll then
    const LISTING = `${NAME}-listing`;
    const SVG = 'http://www.w3.org/2000/svg';
    const REFRESH = 'Refresh';
    const RELOAD_KEYWORDS = 'Reload keywords';
    // said in the list below a field, in place of entries
    const READING = 'reading …';
    const NOTHING_OFFERED = 'This business unit has nothing to choose from here.';
    const NOTHING_MATCHES = 'Nothing in the list matches. The field takes what you typed as it is.';
    // where a push definition holds the custom keys of its app, each with its value
    const CUSTOM_KEYS = 'options.customKeys';
    // what a mobile message written for push says, by the name Content Builder stores it under
    const PUSH_TEXTS = [
        ['display:title', 'Title'],
        ['display:subtitle', 'Subtitle'],
        ['display:message', 'Message'],
    ];
    // said under a field that holds what its list does not have: no id or key stands for it
    const NOT_LISTED = 'not in the list – sent as typed';
    // the views a mobile message of Content Builder is known to name, in small letters: none of
    // them is one of an OTT channel
    const MOBILE_VIEWS = new Set(['push', 'sms', 'inapp']);
    // said under a field whose list could not be read
    const NO_LIST = 'The list to choose from could not be read. Type the id or key.';
    // said of an app that MobilePush greys out, in the list and under the field that holds its id
    const NO_CREDENTIALS = 'no push credentials set up';
    const APP_REFUSED =
        'This app has no push credentials set up, so nothing can be sent with it. Choose another app.';
    const PERSONALIZE = 'Insert personalization';
    const SHOW_NON_GSM = 'Show non-GSM characters';
    // the characters an SMS holds as one each (GSM 03.38, basic set), and those of its extension
    // table, which take the room of two
    const GSM = new Set(
        '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
    );
    const GSM_EXTENDED = new Set('\f^{}\\[~]|€');
    /**
     * Says whether an app lacks what it needs to push, by the rule of MobilePush's own list of
     * apps: neither Android credentials nor an iOS key or a certificate that still holds.
     *
     * @param {object} app the app as MobilePush's list has it
     * @returns {boolean} true when MobilePush greys it out
     */
    const hasNoCredentials = (app) => {
        const isAndroidOff = !(app?.gcmEnabled || app?.fcmFileName);
        if (app?.apnsAuthType === 'Token') {
            return !app.apnsAuthKeyFileName && isAndroidOff;
        }
        if (app?.apnsCertificateExpiration) {
            // a date that cannot be read counts as one that still holds
            return Date.parse(app.apnsCertificateExpiration) < Date.now() && isAndroidOff;
        }
        return isAndroidOff;
    };
    /**
     * Lists what a new message is asked for, whatever its kind.
     *
     * @param {object} [status] what the status field of the kind has of its own, such as its options
     * @returns {object[]} the fields
     */
    const common = (status) => [
        { path: 'name', label: 'Name', isRequired: true },
        { path: 'definitionKey', label: 'Key', isRequired: true, max: KEY_MAX },
        { path: 'description', label: 'Description' },
        {
            path: 'status',
            label: 'Status',
            input: 'select',
            options: ['Active', 'Inactive'],
            ...status,
        },
    ];
    /**
     * Puts together the parts of a label that are there.
     *
     * @param {...unknown} parts what the API returned
     * @returns {string} the texts among them, with a dot in between
     */
    const joined = (...parts) =>
        parts.filter((part) => typeof part === 'string' && part).join(' · ');
    /**
     * Puts entries to choose from in the order of their names, whatever the case: nobody knows
     * an app or a content by its id or key, and a code or a keyword is looked for by the
     * alphabet. Entries of the same name follow each other by that
     * id or key, so that the order is the same every time.
     *
     * @param {{label: unknown, value: unknown}[]} entries entries of a list
     * @returns {object[]} the same entries, by name and then by value
     */
    const byName = (entries) =>
        entries.toSorted(
            (one, other) =>
                String(one.label ?? '').localeCompare(String(other.label ?? ''), undefined, {
                    sensitivity: 'base',
                }) || String(one.value ?? '').localeCompare(String(other.value ?? '')),
        );
    // lists of the business unit that a field offers to choose from, each entry with the value
    // to send and the name to show for it
    const SUGGESTIONS = {
        codes: {
            path: 'legacy/v1/beta/mobile/code/',
            // two codes of one country are told apart by the code itself and by what kind it is
            read: (answer) =>
                byName(
                    (answer.entry || []).map((item) => ({
                        value: item.code,
                        // what the screen of the code in MobileConnect is found by
                        id: item.id,
                        label: joined(
                            item.code,
                            item.countryCode,
                            typeof item.isShortCode === 'boolean' &&
                                (item.isShortCode ? 'short code' : 'long code'),
                            item.codeType,
                        ),
                    })),
                ),
        },
        keywords: {
            path: 'legacy/v1/beta/mobile/keyword/',
            // a keyword belongs to one code; the same word under another code is another entry
            read: (answer) =>
                byName(
                    (answer.entry || []).map((item) => ({
                        value: item.keyword,
                        label: item.keyword,
                        within: item.code?.code,
                    })),
                ),
        },
        // the settings of MobileConnect for this account: one answer, kept as a list of one
        account: {
            path: 'legacy/v1/beta/mobile/account/@default',
            read: (answer) => [
                {
                    value: 'account',
                    // "Salesforce Link Shortening and Tracking"
                    isShortening: answer.optedInForSmslinktracking,
                    isBlockedOut: answer.mobileBlackoutWindow?.isEnabled,
                },
            ],
        },
        apps: {
            path: 'push/v1/application',
            read: (answer) =>
                byName(
                    (Array.isArray(answer) ? answer : []).map((item) => ({
                        value: item.id,
                        label: item.name,
                        // the custom keys of the app; an app without any does not name them
                        keys: (Array.isArray(item.keys) ? item.keys : []).filter(
                            (key) => typeof key === 'string' && key,
                        ),
                    })),
                ),
            // the list that says which of them can send at all
            credentials: 'credentials',
        },
        // the apps as MobilePush itself reads them, with what tells whether an app has the
        // credentials to push with; the public list above does not say
        credentials: {
            path: 'push-internal/v1/application',
            pages: 'items',
            read: (items) =>
                items.map((item) => ({
                    value: item?.id,
                    label: item?.name,
                    isOff: hasNoCredentials(item),
                })),
        },
        // what an SMS can be personalised with: the attributes of MobileConnect Demographics
        // that the business unit added itself, by the name a message calls them
        attributes: {
            path: 'contacts/v1/attributeSetDefinitions?$pageSize=500',
            read: (answer) => {
                const set = (Array.isArray(answer.items) ? answer.items : []).find(
                    (item) => item?.key === 'MobileDemographics',
                );
                return (Array.isArray(set?.attributes) ? set.attributes : [])
                    .filter(
                        (item) =>
                            item?.isSystemDefined === false && typeof item.storageName === 'string',
                    )
                    .map((item) => {
                        const name = item.storageName.replace(/^_/, '');
                        return { value: name, label: name };
                    });
            },
        },
        contents: {
            path: 'asset/v1/content/assets',
            query: `$filter=assetType.id%20eq%20${MOBILE_MESSAGE}&$fields=id,name,customerKey,availableViews,modifiedDate,modifiedBy,category`,
            // comes in pages, under this name
            pages: 'items',
            // a mobile message is written for one use, which it names as its view: push, sms or
            // inApp, in whatever case. Seen on a business unit with push definitions: every one of
            // them holds a message written for push. All of them are read once; a field offers
            // those of the views it takes
            read: (items) =>
                byName(
                    items.map((item) => ({
                        value: item.customerKey,
                        label: item.name,
                        // what Content Builder opens the message by
                        id: idOf(item.id),
                        views: (Array.isArray(item.availableViews) ? item.availableViews : []).map(
                            String,
                        ),
                        // a row of the list has the id of its folder only
                        folder: item.category?.id,
                        modified: item.modifiedDate,
                        by: item.modifiedBy?.name,
                    })),
                ),
            // the list that names the folders
            folders: 'folders',
        },
        // the business unit the user is in: one answer, kept as a list of one, and an empty
        // one when the answer names no id
        unit: {
            path: 'platform-internal/v1/accounts/@current',
            read: (answer) => [{ value: idOf(answer.accountId) }],
        },
        // the folders of Content Builder, by their id
        folders: {
            path: 'asset/v1/content/categories',
            pages: 'items',
            read: (items) =>
                items.map((item) => ({ value: String(item.id ?? ''), label: item.name })),
        },
    };
    const KINDS = [
        {
            id: 'sms',
            title: 'SMS',
            fields: [
                ...common(),
                {
                    path: 'content.message',
                    label: 'Message',
                    input: 'textarea',
                    isRequired: true,
                    // the account may hold messages back for a while
                    isHeldBack: true,
                },
                {
                    path: 'subscriptions.shortCode',
                    label: 'Code',
                    isRequired: true,
                    choose: 'codes',
                    help: 'The short or long code the message is sent from. A long code starts with the number of its country.',
                },
                {
                    path: 'subscriptions.keyword',
                    label: 'Keyword',
                    isRequired: true,
                    choose: 'keywords',
                    // only the keywords of the code that is chosen in this field
                    within: 'subscriptions.shortCode',
                },
                {
                    path: 'subscriptions.countryCode',
                    label: 'Country code',
                    help: 'For a short code only: the two letters of its country, such as US.',
                },
                {
                    path: 'subscriptions.autoAddSubscriber',
                    label: 'Add the recipient as a subscriber if they are new',
                    input: 'checkbox',
                },
                {
                    path: 'subscriptions.updateSubscriber',
                    label: 'Update the subscriber with what the request brings',
                    input: 'checkbox',
                    // Marketing Cloud takes this one only together with the other
                    needs: 'subscriptions.autoAddSubscriber',
                },
                {
                    path: 'options.urlShortenerOptions.isLinkShorteningEnabled',
                    label: 'Shorten the links in the message',
                    input: 'checkbox',
                    // a new message does not name it unless it is ticked
                    isOptional: true,
                    // works only when the account has link shortening switched on
                    isShortened: true,
                },
                {
                    path: 'options.urlShortenerOptions.isSubscriberTrackingEnabled',
                    label: 'Track the shortened links by subscriber',
                    input: 'checkbox',
                    isOptional: true,
                    isShortened: true,
                },
            ],
            // what the list shows of a message that only its details hold
            columns: [
                { title: 'Code', field: 'subscriptions.shortCode', isDetail: true },
                { title: 'Keyword', field: 'subscriptions.keyword', isDetail: true },
            ],
        },
        {
            id: 'push',
            title: 'Push',
            fields: [
                ...common({
                    // seen live: push has a third status, and a message created as anything
                    // but Active is stored with it
                    options: ['Active', 'Inactive', 'Draft'],
                    whenNew:
                        'Marketing Cloud stores a new push message as Draft unless it is Active.',
                }),
                {
                    path: 'applicationId',
                    label: 'App',
                    isRequired: true,
                    suggest: 'apps',
                    isNamed: true,
                    // the form asks for the custom keys of the app that is chosen
                    isKeyed: true,
                },
                {
                    path: 'content.customerKey',
                    label: 'Content',
                    // seen live: without content the API refuses the message
                    isRequired: true,
                    suggest: 'contents',
                    // the mobile messages that are written for push
                    only: { takes: (views) => views.some((view) => view.toLowerCase() === 'push') },
                    isNamed: true,
                    // the details show what the content says
                    isSaid: true,
                    // the details and the form point to the content in Content Builder
                    isLinked: true,
                    help: 'The customer key of the push message in Content Builder.',
                },
                { path: 'options.sound', label: 'Sound' },
                { path: 'options.badge', label: 'Badge' },
            ],
            // shown by the name that the list of the business unit has for the id or the key
            columns: [
                { title: 'App', field: 'applicationId', isDetail: true, names: 'apps' },
                {
                    title: 'Content',
                    field: 'content.customerKey',
                    isDetail: true,
                    names: 'contents',
                },
            ],
        },
        {
            id: 'ott',
            title: 'OTT',
            fields: [
                ...common(),
                {
                    path: 'senderType',
                    label: 'Sender type',
                    input: 'select',
                    options: ['WhatsApp'],
                    isRequired: true,
                },
                {
                    path: 'senderId',
                    label: 'Sender ID',
                    isRequired: true,
                    help: 'For WhatsApp: the phone number of the sender.',
                },
                {
                    path: 'content.customerKey',
                    label: 'Content',
                    isRequired: true,
                    suggest: 'contents',
                    // nobody has seen what view a message for WhatsApp names (seen on a real
                    // account: push, sms and inApp only), so those of any other view are offered,
                    // each with the views it names
                    only: {
                        takes: (views) =>
                            views.some((view) => !MOBILE_VIEWS.has(view.toLowerCase())),
                        isTold: true,
                    },
                    isNamed: true,
                    help: 'The customer key of the message in Content Builder.',
                },
            ],
            // nobody could try this one: no account with such a channel was at hand
            note: [
                'OTT covers WhatsApp and similar channels. This tab was built from Salesforce’s documentation, without an account that has such a channel to test it on. If you have one, please tell us whether it works for you: ',
                { text: 'issues on GitHub', href: ISSUES },
                '.',
            ],
        },
    ];
    const COLUMNS = [
        { title: 'Name', field: 'name' },
        { title: 'Key', field: 'definitionKey' },
        { title: 'Status', field: 'status' },
        { title: 'Created', field: 'createdDate', isDate: true },
        { title: 'Modified', field: 'modifiedDate', isDate: true },
    ];
    // the column that those of a kind of message come after
    const BEFORE_DETAILS = 'status';
    const SORT = 'Sort by this column; again to turn the order around';
    const SORT_LATER = 'This column can be sorted by once the details of all messages are read.';
    const UNREAD =
        'Some details could not be read. They are asked for again when the list is shown next.';
    // writes what a list is searched by: "name or key"
    const EITHER = new Intl.ListFormat('en', { type: 'disjunction' });
    // the fields of a definition that hold a date, wherever they are shown
    const DATES = new Set(COLUMNS.filter((column) => column.isDate).map((column) => column.field));
    // a date and time as the API writes it; the first group is its time zone, which may be missing
    const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/i;
    // what a list is searched by
    const SEARCHED = ['name', 'definitionKey'];
    // the statuses a list can be narrowed to, in the order they are offered; any other one that
    // occurs follows them by its name
    const STATUSES = ['Active', 'Inactive', 'Draft'];
    // what the details call a field of a definition, by its path; a field that is not in here
    // is shown under the name the API has for it
    const LABELS = new Map([
        ['name', 'Name'],
        ['definitionKey', 'Key'],
        ['definitionId', 'ID'],
        ['description', 'Description'],
        ['status', 'Status'],
        ['createdDate', 'Created'],
        ['modifiedDate', 'Modified'],
        ['applicationId', 'App'],
        ['senderType', 'Sender type'],
        ['senderId', 'Sender ID'],
        ['content', 'Content'],
        ['content.message', 'Message'],
        ['content.customerKey', 'Content key'],
        ['subscriptions', 'Subscription'],
        ['subscriptions.shortCode', 'Code'],
        ['subscriptions.countryCode', 'Country code'],
        ['subscriptions.keyword', 'Keyword'],
        ['subscriptions.autoAddSubscriber', 'Add new subscribers'],
        ['subscriptions.updateSubscriber', 'Update subscribers'],
        ['options', 'Options'],
        ['options.sound', 'Sound'],
        ['options.badge', 'Badge'],
        [CUSTOM_KEYS, 'Custom keys'],
        ['options.isReconcilable', 'Reconcilable'],
        ['options.urlShortenerOptions', 'Link shortener'],
        ['options.urlShortenerOptions.isLinkShorteningEnabled', 'Shorten links'],
        ['options.urlShortenerOptions.isSubscriberTrackingEnabled', 'Track by subscriber'],
        ['options.urlShortenerOptions.shortenerType', 'Shortener type'],
    ]);
    // the lists as they were read, by their kind: {rows, readAt}. A kind that is not in here is
    // read when its list is shown next
    const lists = new Map();
    // what the user searches and sorts each list by, the status it is narrowed to (none for all)
    // and the page of it on show, counted from 0, kept while the page lives
    const views = new Map(
        KINDS.map((kind) => [
            kind.id,
            { search: '', status: '', field: undefined, isReversed: false, page: 0 },
        ]),
    );
    // what was read of single messages, by their kind and then by their key: {definition,
    // modifiedDate}, the latter as the row of the list had it that the details were read for. It
    // outlives the lists, so that a list that is read again asks only for what is new or changed
    const details = new Map(KINDS.map((kind) => [kind.id, new Map()]));
    // the details that are being read right now, by kind and key, for all lists together
    const reading = new Map();
    // lets the list on show go on reading details when one of them has come
    let wake = () => {};
    // rows of a list whose details Marketing Cloud answered with 404 on this page, by their
    // signature. Seen on a real account: an SMS definition whose mobile message was deleted is
    // still listed, but cannot be read ("Unable to find Definition", errorcode 30003)
    const notFound = new Set();
    // the kinds whose list is being read again to make sure of such rows
    const confirming = new Set();
    // lets the list on show take out rows that are left out from now on, where they stand
    let dropped = () => {};
    // rows made sure of are kept in the extension's storage, so that they are left out of the
    // lists of later pages without asking for them again; read once per page
    let unreadable;
    // counts what may have made a list another one than the one being read: every request that
    // changes a message, when it goes out and when it is over, and every menu that is drawn again
    let changed = 0;
    // the lists the fields offer to choose from, by their name: with the entries once they are
    // read, with those who wait for them while they are being read. A list that could not be
    // read is not in here, and is asked for again the next time
    const offers = new Map();
    // counts how often all of these lists were forgotten at once: what was kept of one before
    // that is not put back afterwards
    let cleared = 0;
    // what the mobile messages of Content Builder say, by their customer key, as it was read
    // for the details of a push message; kept until the lists are read again
    const texts = new Map();
    // what looks again at whether a field may hold what it holds, by the field; called before a
    // form is sent, because the lists it was held against may be gone since
    const checks = new WeakMap();
    // the field the user sees and types into in place of one that is out of sight, by that one
    const faces = new WeakMap();

    let dialog;
    let body;
    let note;
    let tabs;
    // the kinds of message of which one was deleted, or may have been, since the panel was closed
    // the last time
    const deletedKinds = new Set();
    // counts what was asked for, so that a late answer for something else is dropped
    let asked = 0;
    // counts the forms, to give the lists of their fields names of their own
    let forms = 0;

    /**
     * Creates an element.
     *
     * @param {string} tag name of the element
     * @param {string} [part] what it is in the panel, for the stylesheet
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
     * Asks Marketing Cloud's API through the page.
     *
     * @param {string} path address below the API
     * @param {string} [method] GET to read, POST to create, PATCH to change, DELETE to delete
     * @param {object} [content] what to send along
     * @param {boolean} [isFresh] true when the answer must not come from the browser's cache
     * @returns {Promise.<object>} the answer; an error with isUnanswered when none came
     */
    async function ask(path, method = 'GET', content, isFresh = false) {
        let response;
        try {
            response = await fetch(API + path, {
                body: content && JSON.stringify(content),
                ...(isFresh && { cache: 'no-store' }),
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    ...(content && { 'Content-Type': 'application/json' }),
                    ...(method === PATCH && { [OVERRIDE]: PATCH }),
                },
                method: method === PATCH ? 'POST' : method,
                redirect: 'error',
            });
        } catch {
            const error = new Error('Marketing Cloud did not answer. Are you still logged in?');
            // after a request that changes something, nobody knows whether it was carried out
            error.isUnanswered = true;
            throw error;
        }
        let answer;
        try {
            answer = await response.json();
        } catch {
            // an answer that is no JSON is told by its status
        }
        const isObject = typeof answer === 'object' && answer !== null;
        // what was read must be there; what was changed is told by the status alone
        const isUnreadable = method === 'GET' && !isObject;
        if (isUnreadable || !response.ok) {
            const error = new Error(
                answer?.message || `Marketing Cloud answered with ${response.status}.`,
            );
            error.status = response.status;
            throw error;
        }
        return isObject ? answer : {};
    }

    /**
     * Reads a list the API hands out in pages, page by page.
     *
     * @param {string} path where the list is
     * @param {string|undefined} query what else to ask for, such as a filter
     * @param {string} field name the rows of a page come under
     * @param {() => boolean} isWanted false once nobody waits for the rest any more
     * @param {number} [size] rows to ask for at a time
     * @returns {Promise.<object[]>} the rows
     */
    async function readPages(path, query, field, isWanted, size = PAGE_SIZE) {
        const rows = [];
        let before;
        // asked between the pages only: the first one is always read
        for (let page = 1; page === 1 || isWanted(); page++) {
            const answer = await ask(
                `${path}?$page=${page}&$pageSize=${size}${query ? `&${query}` : ''}`,
            );
            const found = Array.isArray(answer[field]) ? answer[field] : [];
            const first = JSON.stringify(found[0]);
            // the same rows again: the page asked for was ignored, and would be for ever
            if (first === before || found.length === 0) {
                break;
            }
            before = first;
            rows.push(...found);
            // only a short page is the last one. The count of the answer does not tell: for the
            // definitions it is the number of rows in this page, not in the list (seen live)
            if (found.length < size) {
                break;
            }
        }
        return rows;
    }

    /**
     * Forgets the lists that were read: they are those of the business unit the menu was drawn
     * for before.
     */
    function forget() {
        lists.clear();
        offers.clear();
        cleared++;
        texts.clear();
        for (const kept of details.values()) {
            kept.clear();
        }
        notFound.clear();
        changed++;
    }

    /**
     * Tells a row of a list from all others, also from a later definition under the same key and
     * from the same one after a change.
     *
     * @param {string} kind sms, push or ott
     * @param {object} row the row
     * @returns {string} what the row is known by
     */
    function signature(kind, row) {
        return JSON.stringify([kind, row?.definitionKey, row?.createdDate, row?.modifiedDate]);
    }

    /**
     * Reads the rows that are left out of the lists because they cannot be read, once per page.
     *
     * @returns {Promise.<Set.<string>>} their signatures; none when the storage cannot be read
     */
    function unreadableRows() {
        unreadable ??= (async () => {
            try {
                const stored = await chrome.storage.local.get({ [UNREADABLE]: [] });
                const kept = stored[UNREADABLE];
                return new Set(
                    Array.isArray(kept) ? kept.filter((item) => typeof item === 'string') : [],
                );
            } catch {
                return new Set();
            }
        })();
        return unreadable;
    }

    /**
     * Makes sure that rows whose details answered 404 are listed by the business unit the list
     * is of, and leaves them out from then on. The request for details names the key alone, so a
     * 404 may also come from another business unit, chosen in another tab: the list is read once
     * more, and only rows it still holds are left out. The list on show loses them where it stands.
     *
     * @param {{id: string}} kind kind of message
     * @param {object[]} lost the rows whose details answered 404
     */
    async function leaveOut(kind, lost) {
        if (confirming.has(kind.id)) {
            return;
        }
        confirming.add(kind.id);
        const before = changed;
        let fresh;
        try {
            fresh = await readList(kind.id, () => before === changed);
        } catch {
            // asked again the next time the list is shown
        } finally {
            confirming.delete(kind.id);
        }
        if (!fresh || before !== changed) {
            return;
        }
        const listed = new Set(fresh.map((row) => signature(kind.id, row)));
        const sure = lost.filter((row) => listed.has(signature(kind.id, row)));
        if (sure.length === 0) {
            return;
        }
        const kept = await unreadableRows();
        try {
            // what another tab has kept meanwhile is kept too
            const stored = await chrome.storage.local.get({ [UNREADABLE]: [] });
            const others = Array.isArray(stored[UNREADABLE]) ? stored[UNREADABLE] : [];
            for (const item of others) {
                if (typeof item === 'string' && !kept.has(item)) {
                    kept.add(item);
                }
            }
        } catch {
            // what this page knows is kept
        }
        for (const row of sure) {
            // the newest last, so that the oldest go first once there are too many
            const known = signature(kind.id, row);
            kept.delete(known);
            kept.add(known);
        }
        try {
            await chrome.storage.local.set({ [UNREADABLE]: [...kept].slice(-UNREADABLE_KEPT) });
        } catch {
            // left out on this page all the same
        }
        // out of the list that is kept, and out of the one on show, without drawing it anew
        const rows = lists.get(kind.id)?.rows ?? [];
        for (const row of sure) {
            const at = rows.findIndex(
                (item) => signature(kind.id, item) === signature(kind.id, row),
            );
            if (at !== -1) {
                rows.splice(at, 1);
            }
        }
        dropped(kind, sure);
    }

    /**
     * Keeps the details of a message for the lists.
     *
     * @param {{id: string}} kind kind of message
     * @param {string} key key of the definition
     * @param {object} definition the definition as it was read
     * @param {unknown} modifiedDate when it was last changed, as the list says it or, without a list, the definition itself
     */
    function keep(kind, key, definition, modifiedDate) {
        details.get(kind.id).set(key, { definition, modifiedDate });
    }

    /**
     * Looks up the details that were read of a row of a list.
     *
     * @param {{id: string}} kind kind of message
     * @param {object} row the row
     * @returns {object|undefined} the definition; nothing when it was not read, or changed since
     */
    function detailsOf(kind, row) {
        const kept = details.get(kind.id).get(row?.definitionKey);
        return kept && kept.modifiedDate === row.modifiedDate ? kept.definition : undefined;
    }

    /**
     * Reads a list that fields offer to choose from, once for everyone who asks while the page
     * lives: the details, the forms and the lists share it. A list that cannot be read, was
     * stopped halfway or was forgotten meanwhile is not kept.
     *
     * @param {string} name codes, keywords, apps or contents
     * @param {() => boolean} isWanted false once the one who asks no longer waits for it; a list that comes in pages is read on while anyone does
     * @returns {Promise.<{value: string, label: string}[]|undefined>} the entries; nothing when they could not be read
     */
    function readOffers(name, isWanted) {
        const kept = offers.get(name);
        if (kept) {
            // a list that is read already waits for no one
            if (!kept.entries) {
                kept.wanted.push(isWanted);
            }
            return kept.promise;
        }
        const from = SUGGESTIONS[name];
        const offer = { wanted: [isWanted] };
        let isWhole = true;
        const isRead = async () => {
            try {
                const answer = from.pages
                    ? await readPages(from.path, from.query, from.pages, () => {
                          isWhole = offer.wanted.some((wants) => wants());
                          return isWhole;
                      })
                    : await ask(from.path);
                if (isWhole && offers.get(name) === offer) {
                    // only what can be chosen
                    offer.entries = from
                        .read(answer)
                        .filter(({ value }) => typeof value === 'string' && value)
                        .map((entry) => ({
                            ...entry,
                            label: typeof entry.label === 'string' ? entry.label : '',
                        }));
                }
            } catch {
                // whoever asked does without the list
            }
            offer.wanted = [];
            if (!offer.entries && offers.get(name) === offer) {
                offers.delete(name);
            }
            return offer.entries;
        };
        offers.set(name, offer);
        offer.promise = isRead();
        return offer.promise;
    }

    /**
     * Reads lists that fields offer to choose from again, not from what was kept. A list that
     * could not be read stays the one it was, for everyone, unless the lists were forgotten
     * meanwhile: what was kept is then that of another business unit, or older than a Refresh.
     *
     * @param {string[]} names codes, keywords, apps or contents
     * @param {() => boolean} isWanted false once the one who asks no longer waits for them
     * @returns {Promise.<({value: string, label: string}[] | undefined)[]>} the entries of each; nothing for one that could not be read
     */
    async function readOffersAgain(names, isWanted) {
        const before = cleared;
        const kept = names.map((name) => offers.get(name));
        for (const name of names) {
            offers.delete(name);
        }
        const fresh = await Promise.all(names.map((name) => readOffers(name, isWanted)));
        for (const [index, name] of names.entries()) {
            const old = kept.at(index);
            if (before === cleared && old && !fresh.at(index) && !offers.has(name)) {
                offers.set(name, old);
            }
        }
        return fresh;
    }

    /**
     * Looks up what an entry of a list is called, in what was read of that list so far.
     *
     * @param {string} name codes, keywords, apps or contents
     * @param {unknown} value what a definition holds: a code, a keyword, the id of an app or the customer key of a content
     * @returns {string|undefined} its name; nothing when the list was not read or does not hold it
     */
    function nameOf(name, value) {
        return (
            offers.get(name)?.entries?.find((entry) => entry.value === value)?.label || undefined
        );
    }

    /**
     * Picks the custom keys a push message holds that its app does not define. Marketing Cloud
     * refuses to save a message with such a key, so one that is stored was taken off the app
     * after the message was saved. Nothing is claimed about an app that is not known.
     *
     * @param {unknown} stored the custom keys of the message, as the definition holds them
     * @param {unknown} appId the id of the app
     * @returns {string[]} the names of those keys, each once; none when the list of apps was not read or does not hold the app
     */
    function strayKeys(stored, appId) {
        const keys = offers.get('apps')?.entries?.find((entry) => entry.value === appId)?.keys;
        if (!keys || !Array.isArray(stored)) {
            return [];
        }
        return [
            ...new Set(
                stored
                    .map((item) => item?.key)
                    .filter((key) => typeof key === 'string' && !keys.includes(key)),
            ),
        ];
    }

    /**
     * Builds a link to a screen of Marketing Cloud. It opens in another tab, so that a form
     * that is open is not lost.
     *
     * @param {string} text what the link says
     * @param {string} screen the app and its screen, as the address of the page names them
     * @param {unknown} id the id of what the screen shows
     * @returns {HTMLAnchorElement} the link
     */
    function screenLink(text, screen, id) {
        const link = make('a', 'setup', text);
        link.href = new URL(
            `/cloud/#app/${screen}/${encodeURIComponent(String(id))}`,
            location.origin,
        ).href;
        link.target = '_blank';
        link.rel = 'noopener';
        return link;
    }
    // the settings of an app, where its custom keys are set up
    const appLink = (id) =>
        screenLink(
            'Open this app’s settings in MobilePush',
            'MobilePush/mobilepush/%23!/administration/app',
            id,
        );
    // the settings of MobileConnect for the account, where link shortening and the send blockout
    // window are set up
    const SETUP = 'Setup > MobileConnect';
    const setupLink = () =>
        screenLink(SETUP, 'MobileConnect/MobileConnectFuel3/%23!', 'administration');
    /**
     * Builds a note on what the settings of MobileConnect mean for a form, with the way there.
     *
     * @param {string} before what it says before the link
     * @param {string} after what it says after it
     * @returns {HTMLElement} the note
     */
    function accountNote(before, after) {
        const said = make('p', 'account-note');
        said.append(before, setupLink(), after);
        return said;
    }
    // a code of MobileConnect, where its keywords are; by the id the list of codes has for it
    const codeLink = (id) =>
        screenLink(
            'Open this code in MobileConnect',
            'MobileConnect/MobileConnectFuel3/%23!/administration/code',
            id,
        );

    /**
     * Builds a link to a mobile message in Content Builder, in the form that the extension's
     * links to an asset have: with the business unit the user is in and the id of the asset.
     * Both are read for it, each once for the page; the list of the contents is the one the
     * fields choose from.
     *
     * @param {unknown} key customer key of the content
     * @param {() => boolean} isWanted false once nobody waits for the link any more
     * @returns {Promise.<HTMLAnchorElement|undefined>} the link; nothing when the content is not in the list, has no id made of digits, or the business unit is not known
     */
    async function contentLink(key, isWanted) {
        if (typeof key !== 'string' || !key) {
            return;
        }
        const contents = await readOffers('contents', isWanted);
        const asset = contents?.find((entry) => entry.value === key)?.id;
        if (!asset) {
            return;
        }
        const [unit] = (await readOffers('unit', isWanted)) ?? [];
        if (!unit) {
            return;
        }
        return screenLink(
            'Open in Content Builder',
            `Content%20Builder/ux-tools/${unit.value}/asset`,
            asset,
        );
    }

    /**
     * Keeps a link to the content that a field of a form holds below that field, for as long as
     * the content is one of the list; another content gets another link, and none gets none.
     *
     * @param {HTMLInputElement} input the field that holds the customer key of the content
     */
    function contentTools(input) {
        const tools = make('div', 'content-tools');
        tools.hidden = true;
        input.closest(`.${NAME}-field`).after(tools);
        // counts what the field held, so that a late link for something else is dropped
        let drawn = 0;
        const draw = async () => {
            const mine = ++drawn;
            const link = await contentLink(input.value.trim(), () => input.isConnected);
            if (mine !== drawn) {
                return;
            }
            tools.replaceChildren(...(link ? [link] : []));
            tools.hidden = !link;
        };
        // typing and choosing from the list both come as this
        input.addEventListener('input', draw);
        draw();
    }

    /**
     * Builds the place that names what a field holds, which stays empty until the list is read
     * and whenever the list does not hold the value.
     *
     * @param {string} name the list the value is one of
     * @param {() => unknown} read reads the value
     * @returns {{element: HTMLElement, draw: () => void}} the place, and what to call when the value has changed
     */
    function resolved(name, read) {
        const element = make('span', 'resolved');
        const draw = () => {
            const found = nameOf(name, read());
            element.textContent = found || '';
            element.hidden = !found;
        };
        const drawLater = async () => {
            await readOffers(name, () => element.isConnected);
            draw();
        };
        draw();
        drawLater();
        return { element, draw };
    }

    /**
     * Reads what a mobile message of Content Builder says when it is pushed: its title, its
     * subtitle and its message. Read once for a customer key and kept; what cannot be read is
     * done without (nothing comes of it), and asked for again the next time.
     *
     * @param {string} key customer key of the content
     * @returns {Promise.<{label: string, name: string, text: string}[]|undefined>} what each of them is called here and in Content Builder, and its text; only those that are there
     */
    function readTexts(key) {
        const kept = texts.get(key);
        if (kept) {
            return kept;
        }
        const filter = encodeURIComponent(`customerKey eq '${key.replaceAll("'", "''")}'`);
        const isRead = async () => {
            try {
                const answer = await ask(
                    `${SUGGESTIONS.contents.path}?$filter=${filter}&$fields=name,customerKey,views`,
                );
                const found = (Array.isArray(answer.items) ? answer.items : []).find(
                    (item) => item?.customerKey === key,
                );
                const said = found?.views?.push?.meta?.options?.customBlockData;
                return PUSH_TEXTS.map(([name, label]) => ({
                    label,
                    name,
                    text: said?.[name],
                })).filter(({ text }) => typeof text === 'string' && text);
            } catch {
                // asked for again the next time
                return;
            }
        };
        const read = isRead();
        texts.set(key, read);
        const forgetUnread = async () => {
            if (!(await read) && texts.get(key) === read) {
                texts.delete(key);
            }
        };
        forgetUnread();
        return read;
    }

    /**
     * Puts what the content of a push message says below its key in the details, once it is
     * read: as text, whatever it holds. Nothing is added when there is nothing to show.
     *
     * @param {HTMLElement} shown the details of the definition
     * @param {string} path where the definition holds the customer key of its content
     * @param {unknown} key the customer key
     */
    async function showTexts(shown, path, key) {
        const title = [...shown.querySelectorAll('dt')].find((item) => item.title === path);
        if (!title || typeof key !== 'string' || !key) {
            return;
        }
        const said = (await readTexts(key)) ?? [];
        // right below the key, before whatever else the content holds
        let last = title.nextElementSibling;
        for (const { label, name, text } of said) {
            const term = make('dt', 'content-text', label);
            term.title = name;
            const cell = make('dd', 'content-text');
            cell.append(make('span', 'value', text));
            last.after(term, cell);
            last = cell;
        }
    }

    /**
     * Sends a request that changes a message. Whatever comes of it, also nothing at all, the
     * list of its kind and the details of that message may no longer be what was read, and are
     * read again when the list is shown next.
     *
     * @param {{id: string}} kind kind of message
     * @param {string} key key of the definition
     * @param {string} method POST to create, PATCH to change, DELETE to delete
     * @param {object} [content] what to send along
     * @returns {Promise.<object>} the answer
     */
    async function write(kind, key, method, content) {
        // a new one is sent to the definitions themselves, with its key in what is sent
        const path = method === 'POST' ? '' : `/${encodeURIComponent(key)}`;
        const stale = () => {
            lists.delete(kind.id);
            // the list would not tell: it has the minute of the last change, and a second change
            // within that minute leaves it as it is
            details.get(kind.id).delete(key);
            changed++;
        };
        stale();
        try {
            return await ask(`${MESSAGES}${kind.id}/definitions${path}`, method, content);
        } finally {
            // a list that was read while the request was on its way may be the one from before it
            stale();
        }
    }

    /**
     * Writes a date of the API in the reader's language and time zone. A value that names no
     * time zone is shown with the hours it has, because nobody has seen which zone it is meant in.
     *
     * @param {unknown} value what the API returned
     * @param {string} [locale] language to write it in; the browser's when left out
     * @param {string} [timeZone] time zone to write it in; the browser's when left out
     * @returns {string} date and time; the value as it is when it is no date
     */
    function formatDate(value, locale, timeZone) {
        const raw = String(value ?? '');
        const parts = ISO.exec(raw);
        if (!parts) {
            return raw;
        }
        const hasZone = Boolean(parts[1]);
        const date = new Date(hasZone ? raw : `${raw}Z`);
        // the right shape, but no such day or hour
        if (Number.isNaN(date.getTime())) {
            return raw;
        }
        return date.toLocaleString(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: hasZone ? timeZone : 'UTC',
        });
    }
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the tests call it with a language and a time zone of their own, which nothing else of this script lets them
    globalThis.sfmcUxToolsFormatDate = formatDate;

    /**
     * Puts a date into an element, with the value of the API to be read when the mouse rests on it.
     *
     * @param {HTMLElement} element where the date is shown
     * @param {unknown} value what the API returned
     * @returns {HTMLElement} the element
     */
    function stamp(element, value) {
        element.textContent = formatDate(value);
        if (typeof value === 'string' && value) {
            element.title = value;
        }
        return element;
    }

    /**
     * Reads all definitions of a kind.
     *
     * @param {string} kind sms, push or ott
     * @param {() => boolean} isWanted false once something else was asked for or the panel was closed
     * @returns {Promise.<object[]>} the definitions
     */
    function readList(kind, isWanted) {
        return readPages(
            `${MESSAGES}${kind}/definitions`,
            NOT_DELETED,
            'definitions',
            isWanted,
            LARGEST_PAGE,
        );
    }

    /**
     * Shows a value of a definition: text, or its parts by what they are called here. The name
     * the API has for a part is to be read when the mouse rests on it.
     *
     * @param {unknown} value what the API returned
     * @param {Map.<string, string>} [named] the list that names a value, by the path of its field
     * @param {string} [path] names from the definition down to the value, joined by dots
     * @returns {HTMLElement} the element that shows it
     */
    function show(value, named = new Map(), path = '') {
        if (value === null || typeof value !== 'object') {
            return make('span', 'value', String(value));
        }
        // custom keys are listed by their name, each with its value, when they hold nothing else
        const isKeys =
            path === CUSTOM_KEYS &&
            Array.isArray(value) &&
            value.every(
                (item) =>
                    typeof item?.key === 'string' &&
                    Object.keys(item).every((name) => name === 'key' || name === 'value'),
            );
        const entries = isKeys
            ? value.map((item) => [item.key, item.value ?? ''])
            : Object.entries(value);
        if (entries.length === 0) {
            return make('span', 'value', '(none)');
        }
        const list = make('dl', 'fields');
        for (const [key, part] of entries) {
            const at = path ? `${path}.${key}` : key;
            const title = make('dt', undefined, LABELS.get(at) ?? key);
            title.title = at;
            const cell = make('dd');
            // the name first, when the list has one, and the id or key it stands for after it
            if (typeof part === 'string' && named.has(at)) {
                cell.append(resolved(named.get(at), () => part).element);
            }
            cell.append(
                typeof part === 'string' && DATES.has(key)
                    ? stamp(make('span', 'value'), part)
                    : show(part, named, at),
            );
            list.append(title, cell);
        }
        return list;
    }

    /**
     * Replaces what the panel shows.
     *
     * @param {...(Node|string)} content what to show
     */
    function fill(...content) {
        // only a list of messages keeps the panel from scrolling, and says so itself
        dialog.classList.remove(LISTING);
        body.replaceChildren(...content);
    }

    /**
     * Creates a part of a drawing.
     *
     * @param {string} tag name of the element
     * @param {Object.<string, string>} attributes what it is drawn with
     * @returns {SVGElement} the part
     */
    function shape(tag, attributes) {
        const element = document.createElementNS(SVG, tag);
        for (const [name, value] of Object.entries(attributes)) {
            element.setAttribute(name, value);
        }
        return element;
    }

    /**
     * Draws the sign for reading something again: an arrow that runs round in a circle.
     *
     * @returns {SVGElement} the sign, in the colour of the text around it
     */
    function reloadSign() {
        const sign = shape('svg', {
            class: `${NAME}-sign`,
            viewBox: '0 0 16 16',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '1.5',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'aria-hidden': 'true',
            focusable: 'false',
        });
        sign.append(
            // the circle, open at the top right, and the head of the arrow there
            shape('path', { d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9' }),
            shape('path', { d: 'M13.5 2v3.5H10' }),
        );
        return sign;
    }

    /**
     * Shows that something failed, with what Marketing Cloud said.
     *
     * @param {unknown} error what went wrong
     * @param {...Node} before what stays above it
     */
    function fail(error, ...before) {
        fill(...before, make('p', 'error', `That did not work: ${error?.message || error}`));
    }

    /**
     * Reads one definition.
     *
     * @param {{id: string}} kind kind of message
     * @param {string} key key of the definition
     * @returns {Promise.<object>} the definition
     */
    async function readDefinition(kind, key) {
        const definition = await ask(
            `${MESSAGES}${kind.id}/definitions/${encodeURIComponent(key)}`,
        );
        // the id of the request says nothing about the definition
        delete definition.requestId;
        return definition;
    }

    /**
     * Reads the details of a row of a list and keeps them, unless a message was changed here or
     * the business unit left meanwhile. Details that cannot be read are done without.
     *
     * @param {{id: string}} kind kind of message
     * @param {object} row the row
     * @returns {Promise.<void>} over once the details are kept, or not to be had
     */
    function readDetails(kind, row) {
        const key = row.definitionKey;
        const id = `${kind.id} ${key}`;
        const before = changed;
        const isRead = async () => {
            try {
                const definition = await readDefinition(kind, key);
                if (before === changed) {
                    keep(kind, key, definition, row.modifiedDate);
                }
            } catch (ex) {
                // the row stays without them until its list is shown next; one that Marketing
                // Cloud cannot find is made sure of once the list has read what it can
                if (before === changed && ex?.status === 404) {
                    notFound.add(signature(kind.id, row));
                }
            }
            reading.delete(id);
            wake();
        };
        const read = isRead();
        reading.set(id, read);
        return read;
    }

    /**
     * Tells the apps of Mobile Studio of which kinds a message was deleted, so that their list is
     * read again, and forgets those kinds.
     */
    function announceDeletes() {
        for (const kind of deletedKinds) {
            tell({ type: PANEL_CLOSED, kind });
        }
        deletedKinds.clear();
    }

    /**
     * Notes that a message of a kind was deleted, or may have been. The apps are told when the
     * panel is closed, or at once when the answer came after it was closed.
     *
     * @param {{id: string}} kind kind of message
     */
    function noteDelete(kind) {
        deletedKinds.add(kind.id);
        if (!dialog.open) {
            announceDeletes();
        }
    }

    /**
     * Deletes a definition that the user has confirmed, unless it is no longer the one shown.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {object} shown the definition as the details show it
     * @param {HTMLElement} box the confirmation, which takes what goes wrong
     */
    async function remove(kind, shown, box) {
        const mine = ++asked;
        const key = shown.definitionKey;
        const called = `“${shown.name}” (key ${key})`;
        let isSent = false;
        for (const button of box.querySelectorAll('button')) {
            button.disabled = true;
        }
        try {
            // the request names only the key, and the same key can exist in another business unit,
            // which the user may have changed to in another tab since the details were read
            const held = await readDefinition(kind, key);
            if (mine !== asked) {
                // the user went elsewhere before anything was sent: nothing is deleted
                return;
            }
            if (JSON.stringify(held) !== JSON.stringify(shown)) {
                throw new Error(
                    'what Marketing Cloud holds under this key is no longer what is shown here. Was the business unit changed in another tab? Open the message again.',
                );
            }
            isSent = true;
            await write(kind, key, 'DELETE');
            noteDelete(kind);
            // an answer that comes after the user went elsewhere is not shown; the lists are read anew
            if (mine === asked) {
                openList(kind, `Deleted ${called}.`);
            }
        } catch (ex) {
            // a delete that went out and got no answer may have been carried out
            if (isSent && ex.isUnanswered) {
                noteDelete(kind);
            }
            if (mine !== asked) {
                return;
            }
            // only a delete that went out and got no answer leaves its outcome open
            if (isSent && ex.isUnanswered) {
                openList(
                    kind,
                    `It is not known whether ${called} was deleted: ${ex.message} Look for it in the list.`,
                );
                return;
            }
            box.replaceChildren(make('p', 'error', `Not deleted: ${ex.message}`));
        }
    }

    /**
     * Asks whether a definition is really to be deleted, in place of the button that was clicked.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {object} shown the definition as the details show it
     * @param {HTMLElement} button the button that was clicked
     */
    function confirmDelete(kind, shown, button) {
        const box = make('div', 'confirm');
        const yes = make('button', 'delete', 'Delete it');
        const no = make('button', 'keep', 'Keep it');
        yes.type = 'button';
        no.type = 'button';
        yes.addEventListener('click', () => remove(kind, shown, box));
        no.addEventListener('click', () => box.replaceWith(button));
        box.append(
            make(
                'p',
                undefined,
                `Delete “${shown.name}” (key ${shown.definitionKey}, status ${shown.status}) for good? Marketing Cloud cannot bring it back, and whatever still sends with this key will fail.`,
            ),
            yes,
            no,
        );
        button.replaceWith(box);
    }

    /**
     * Builds an entry of a list to choose from.
     *
     * @param {string} value what is sent
     * @param {string} label what is shown
     * @returns {HTMLOptionElement} the entry
     */
    function choice(value, label) {
        const option = make('option', undefined, label);
        option.value = value;
        return option;
    }

    /**
     * Puts a list of the business unit below a text field, to choose from: all of it whenever
     * the field is entered or clicked, whatever the field holds, and what matches the name or
     * the value while the user types. The field of the form goes out of sight and stays what
     * the form reads, checks and sends: the id or key. In its place stands a field that shows
     * the name of what is chosen and takes what is typed; the id or key that is sent is said
     * below it. Text that is the id or key of an entry, or the name of exactly one, stands for
     * that entry; any other text is taken and sent as it is, with the list and without. A
     * list that cannot be read is done without, and the rest of one is not read for a form that
     * was closed meanwhile.
     *
     * @param {HTMLInputElement} input the text field of the form
     * @param {string} id name for the list and its entries
     * @param {string} name codes, keywords, apps or contents
     * @param {string} [kept] what the message that is changed holds in the field; it can always be kept
     * @param {{takes: (views: string[]) => boolean, isTold?: boolean}} [only] the entries of the list the field offers, by the views they name, and whether an entry says its views
     * @returns {HTMLElement} the field with its list
     */
    function combo(input, id, name, kept, only) {
        const box = make('div', 'combo');
        const drop = make('div', 'combo-drop');
        const status = make('div', 'combo-status');
        const list = make('div', 'combo-list');
        list.id = id;
        list.setAttribute('role', 'listbox');
        drop.hidden = true;
        drop.append(status, list);
        // the field on show. It has no name: nothing of the form reads it
        const face = make('input', 'combo-input');
        face.type = 'text';
        face.id = `${id}-field`;
        face.autocomplete = 'off';
        // the id or key that is stored, until the list tells its name
        face.value = kept ?? '';
        face.setAttribute('aria-required', String(input.required));
        faces.set(input, face);
        // still reachable for the form's check, no stop for the Tab key
        input.classList.add(`${NAME}-coded`);
        input.tabIndex = -1;
        // says what is sent for the field
        const sent = make('span', 'combo-sent');
        sent.hidden = true;
        box.append(input, face, drop, sent);
        face.setAttribute('role', 'combobox');
        face.setAttribute('aria-autocomplete', 'list');
        face.setAttribute('aria-controls', id);
        face.setAttribute('aria-expanded', 'false');
        // taken away when the list cannot be read: the field is a plain text field then
        const wired = new AbortController();
        const on = (target, type, listener) =>
            target.addEventListener(type, listener, { signal: wired.signal });
        // nothing while the list is being read
        let entries;
        // what the user typed to narrow the list down, in small letters; empty for all of it
        let typed = '';
        // the entries on show, and the one among them that the arrow keys are at
        let shown = [];
        let active;
        // true once the user typed into the field on show
        let isTouched = false;
        // true while this puts a value into the field of the form, which is no typing there
        let isWriting = false;
        // the id or key the field stood for before its text was changed: what it held when it
        // was opened, or the entry it held last
        let chosen;

        const entryOf = (value) => (entries || []).find((entry) => entry.value === value);
        // what a text stands for: the id or key of an entry when it is one, or when it is the
        // name of exactly one entry, whatever the case; otherwise the text itself
        const meant = (text) => {
            const wanted = text.trim();
            if (!wanted || entryOf(wanted)) {
                return wanted;
            }
            // the name of the entry that is chosen stays that entry, even if another entry has
            // the same name: typing and taking back a letter changes nothing
            const before = entryOf(chosen);
            if (before && before.label.toLowerCase() === wanted.toLowerCase()) {
                return before.value;
            }
            const called = (entries || []).filter(
                (entry) => entry.label.toLowerCase() === wanted.toLowerCase(),
            );
            return called.length === 1 ? called[0].value : text;
        };
        // puts a value into the field of the form, as if it was typed there: the form and
        // whatever else listens to the field hear of it
        const hold = (value, ...types) => {
            isWriting = true;
            input.value = value;
            for (const type of types) {
                input.dispatchEvent(new Event(type, { bubbles: true }));
            }
            isWriting = false;
        };
        const tell = () => {
            const value = input.value.trim();
            sent.hidden = !entries || !value;
            sent.textContent = entryOf(value) ? value : NOT_LISTED;
        };
        // shows what the field of the form holds: by its name, when the list has one for it
        const paint = () => {
            face.value = entryOf(input.value.trim())?.label || input.value;
        };
        face.addEventListener('input', () => {
            const held = input.value.trim();
            if (!isTouched || entryOf(held)) {
                chosen = held;
            }
            isTouched = true;
            hold(meant(face.value), 'input');
        });
        input.addEventListener('input', () => {
            tell();
            if (isWriting) {
                return;
            }
            // typed into the field of the form itself, which holds the cursor after the form
            // pointed at it as empty or refused
            paint();
            if (document.activeElement === input) {
                face.focus();
            }
        });
        // the browser's note that the field is empty or refused needs the cursor to stay in it
        input.addEventListener('focus', () => {
            if (input.validity.valid) {
                face.focus();
            }
        });

        const close = () => {
            drop.hidden = true;
            face.setAttribute('aria-expanded', 'false');
            face.removeAttribute('aria-activedescendant');
        };
        const choose = (entry) => {
            face.value = entry.label || entry.value;
            hold(entry.value, 'input', 'change');
            typed = '';
            close();
        };
        // the list that names the folders of the entries, if they are in folders, and the one
        // that says which entries cannot be used
        const { folders, credentials } = SUGGESTIONS[name];
        // an id or entry that the other list switches off; nothing is while that list is not
        // read, or does not hold it
        const isOff = (value) =>
            Boolean(
                credentials &&
                offers.get(credentials)?.entries?.find((entry) => entry.value === value)?.isOff,
            );
        // not to be chosen: what is switched off, unless the message holds it already
        const isBarred = (entry) => entry.value !== kept && isOff(entry.value);
        // said under the field while it holds the id of such an entry, however it came there;
        // the form is not sent then
        const refused = make('span', 'refused', APP_REFUSED);
        refused.hidden = true;
        const check = () => {
            const value = input.value.trim();
            refused.hidden = value === kept || !isOff(value);
            input.setCustomValidity(refused.hidden ? '' : APP_REFUSED);
        };
        if (credentials) {
            box.append(refused);
            input.addEventListener('input', check);
            checks.set(input, check);
        }
        // the names of the folders by their id, once they are read
        let folderNames = new Map();
        const folderOf = (entry) => folderNames.get(String(entry.folder ?? '')) || undefined;
        // what else tells an entry from one of the same name: its folder, and when and by whom
        // it was last changed
        const moreOf = (entry) => {
            const views = only?.isTold && entry.views?.length > 0 && entry.views.join(', ');
            const change = [
                typeof entry.modified === 'string' && entry.modified && formatDate(entry.modified),
                typeof entry.by === 'string' && entry.by && `by ${entry.by}`,
            ]
                .filter(Boolean)
                .join(' ');
            return joined(views, folderOf(entry), change && `modified ${change}`);
        };
        const draw = () => {
            const current = input.value.trim();
            shown = (entries || []).filter(
                (entry) =>
                    entry.value.toLowerCase().includes(typed) ||
                    entry.label.toLowerCase().includes(typed) ||
                    Boolean(folderOf(entry)?.toLowerCase().includes(typed)),
            );
            if (!shown.includes(active) || isBarred(active)) {
                active = undefined;
            }
            let at;
            list.replaceChildren(
                ...shown.map((entry) => {
                    const option = make('div', 'combo-option');
                    option.id = `${id}-${entries.indexOf(entry)}`;
                    option.setAttribute('role', 'option');
                    option.setAttribute('aria-selected', String(entry.value === current));
                    const more = joined(moreOf(entry), isOff(entry.value) && NO_CREDENTIALS);
                    option.append(
                        make('span', 'combo-name', entry.label || entry.value),
                        ...(more ? [make('span', 'combo-more', more)] : []),
                        make('span', 'combo-value', entry.value),
                    );
                    if (isBarred(entry)) {
                        // greyed, and neither the mouse nor the keys take it
                        option.classList.add(`${NAME}-combo-off`);
                        option.setAttribute('aria-disabled', 'true');
                        return option;
                    }
                    // before the field loses the focus, which would close the list
                    option.addEventListener('mousedown', () => choose(entry));
                    if (entry === active) {
                        option.classList.add(`${NAME}-combo-active`);
                        at = option;
                    }
                    return option;
                }),
            );
            status.textContent = NOTHING_MATCHES;
            if (!entries) {
                status.textContent = READING;
            } else if (entries.length === 0) {
                status.textContent = NOTHING_OFFERED;
            }
            status.hidden = shown.length > 0;
            if (at && !drop.hidden) {
                face.setAttribute('aria-activedescendant', at.id);
                at.scrollIntoView({ block: 'nearest' });
            } else {
                face.removeAttribute('aria-activedescendant');
            }
        };
        const open = () => {
            // what the field holds is where the keys start from
            const current = input.value.trim();
            active = (entries || []).find((entry) => entry.value === current && !isBarred(entry));
            drop.hidden = false;
            face.setAttribute('aria-expanded', 'true');
            draw();
        };
        const openAll = () => {
            typed = '';
            open();
        };
        const move = (step) => {
            // the keys pass over what cannot be chosen
            const free = shown.filter((entry) => !isBarred(entry));
            if (free.length === 0) {
                return;
            }
            const index = free.indexOf(active);
            const last = free.length - 1;
            const from = step > 0 ? last : 0;
            const to = step > 0 ? 0 : last;
            active = free[index === -1 || index === from ? to : index + step];
            draw();
        };
        const keys = {
            ArrowDown: (event) => {
                event.preventDefault();
                if (drop.hidden) {
                    openAll();
                } else {
                    move(1);
                }
            },
            ArrowUp: (event) => {
                event.preventDefault();
                if (drop.hidden) {
                    openAll();
                } else {
                    move(-1);
                }
            },
            Enter: (event) => {
                if (drop.hidden) {
                    return;
                }
                // closes the list; the form is sent by the next one
                event.preventDefault();
                if (active) {
                    choose(active);
                } else {
                    close();
                }
            },
            Escape: (event) => {
                if (drop.hidden) {
                    return;
                }
                // closes the list, not the panel
                event.preventDefault();
                event.stopPropagation();
                close();
            },
            Tab: close,
        };
        on(face, 'focus', openAll);
        // every click, also into a field that holds something
        on(face, 'click', openAll);
        on(face, 'blur', () => {
            close();
            // an id or key that was typed gives way to its name
            if (entryOf(input.value.trim())) {
                paint();
            }
        });
        on(face, 'input', () => {
            typed = face.value.trim().toLowerCase();
            open();
        });
        on(face, 'keydown', (event) => {
            if (Object.hasOwn(keys, event.key)) {
                keys[event.key](event);
            }
        });
        // a click into the list, also on its scrollbar, leaves the focus in the field
        on(drop, 'mousedown', (event) => event.preventDefault());
        const read = async () => {
            const found = await readOffers(name, () => input.isConnected);
            if (found) {
                entries = only ? found.filter((entry) => only.takes(entry.views ?? [])) : found;
                if (isTouched) {
                    // what was typed before the list came may be the name of an entry
                    const value = meant(face.value);
                    if (value !== input.value) {
                        hold(value, 'input');
                    }
                } else {
                    // nothing is put into the field of the form: one that was not touched
                    // sends nothing
                    paint();
                }
                tell();
                // an open list stays open, narrowed down by what was typed meanwhile
                if (drop.hidden) {
                    draw();
                } else {
                    open();
                }
                return;
            }
            wired.abort();
            for (const attribute of [
                'role',
                'aria-autocomplete',
                'aria-controls',
                'aria-expanded',
                'aria-activedescendant',
            ]) {
                face.removeAttribute(attribute);
            }
            drop.replaceWith(make('span', 'help', NO_LIST));
        };
        // the folders come when they come, and are done without when they do not
        const nameFolders = async () => {
            const found = await readOffers(folders, () => input.isConnected);
            if (!found) {
                return;
            }

            folderNames = new Map(found.map((entry) => [entry.value, entry.label]));
            if (entries) {
                draw();
            }
        };
        // so does what switches entries off: without it every entry can be chosen
        const switchOff = async () => {
            const found = await readOffers(credentials, () => input.isConnected);
            if (!found) {
                return;
            }

            check();
            draw();
        };
        draw();
        read();
        if (folders) {
            nameFolders();
        }
        if (credentials) {
            switchOff();
        }
        return box;
    }

    /**
     * Fills a list to choose from with entries, and with what was stored when they do not
     * have it.
     *
     * @param {HTMLSelectElement} select the list
     * @param {string} hint what its first, empty entry says
     * @param {{value: string, label: string}[]} entries what to choose from
     * @param {string} kept what was stored; empty when nothing was, or when it does not belong here
     * @param {string} value what to choose, if the list has it
     */
    function offer(select, hint, entries, kept, value) {
        const isMissing = kept && entries.every((entry) => entry.value !== kept);
        select.replaceChildren(
            choice('', hint),
            ...entries.map((entry) => choice(entry.value, entry.label || entry.value)),
            ...(isMissing ? [choice(kept, kept + NOT_FOUND)] : []),
        );
        select.value = [...select.options].some((item) => item.value === value) ? value : '';
    }

    /**
     * Turns two text fields of a form into lists to choose from, the second with the entries
     * that belong to what the first holds, once both lists of the business unit are read. Without
     * them, or when one of them is empty, the fields stay as they are and take any text. What a
     * field held is kept, also when the lists do not have it.
     *
     * @param {Map.<string, HTMLElement>} inputs the fields of the form by their path; gets the lists in place of the text fields
     * @param {{path: string, label: string, choose: string}} first the field that is chosen first, such as the code
     * @param {{path: string, label: string, choose: string}} second the field that depends on it, such as the keyword
     */
    async function chooseBoth(inputs, first, second) {
        const typed = [inputs.get(first.path), inputs.get(second.path)];
        const isShown = () => typed[0].isConnected;
        let [all, dependents] = await Promise.all([
            readOffers(first.choose, isShown),
            readOffers(second.choose, isShown),
        ]);
        // a field that cannot show what is stored stays switched off, as the text field it is
        if (!all?.length || !dependents?.length || !isShown() || typed.some((it) => it.disabled)) {
            return;
        }
        const stored = [held(first, typed[0]), held(second, typed[1])];
        const [chosen, dependent] = [first, second].map((spec, index) => {
            const select = make('select');
            select.name = typed[index].name;
            select.required = Boolean(spec.isRequired);
            const isFocused = document.activeElement === typed[index];
            typed[index].replaceWith(select);
            inputs.set(spec.path, select);
            if (isFocused) {
                select.focus();
            }
            return select;
        });
        const [one, other] = [first.label.toLowerCase(), second.label.toLowerCase()];
        const offerDependents = (value) => {
            const within = chosen.value;
            // an entry that does not say what it belongs to is offered everywhere
            const own = dependents.filter((entry) => String(entry.within ?? within) === within);
            // what was stored belongs to what it was stored with
            const kept = within === stored[0] ? stored[1] : '';
            let hint = `Choose the ${one} first`;
            if (within) {
                hint =
                    kept || own.length > 0 ? `Choose a ${other} …` : `This ${one} has no ${other}`;
            }
            offer(dependent, hint, within ? own : [], kept, value);
            dependent.disabled = !within;
        };
        offer(chosen, `Choose a ${one} …`, all, stored[0], stored[0]);
        offerDependents(stored[1]);
        // below the keywords: the way to the code that is chosen, where a keyword can be added,
        // and what reads both lists again afterwards
        const tools = make('div', 'code-tools');
        // stands in until the first code is pointed to
        let link = make('a');
        const help = make('span', 'help', 'Add a keyword there, then reload the keywords.');
        const point = () => {
            const id = all.find((entry) => entry.value === chosen.value)?.id;
            const isKnown = typeof id === 'string' && id !== '';
            const next = isKnown ? codeLink(id) : make('a');
            next.hidden = !isKnown;
            link.replaceWith(next);
            link = next;
            help.hidden = next.hidden;
        };
        const reload = make('button', 'refresh');
        reload.type = 'button';
        reload.title = RELOAD_KEYWORDS;
        reload.setAttribute('aria-label', RELOAD_KEYWORDS);
        reload.append(reloadSign());
        const failed = make('span', 'reload-failed');
        failed.hidden = true;
        // a save does not wait for this reading, and switches the button on again when it fails
        let isReading = false;
        reload.addEventListener('click', async () => {
            if (isReading) {
                return;
            }
            isReading = true;
            reload.disabled = true;
            failed.hidden = true;
            const fresh = await readOffersAgain(
                [first.choose, second.choose],
                () => chosen.isConnected,
            );
            if (fresh.every((entries) => entries?.length)) {
                [all, dependents] = fresh;
                const keyword = dependent.value;
                offer(chosen, `Choose a ${one} …`, all, stored[0], chosen.value);
                offerDependents(keyword);
                point();
            } else {
                failed.textContent = 'The lists could not be read again. They are as they were.';
                failed.hidden = false;
            }
            isReading = false;
            // a form that is being sent keeps its buttons switched off
            reload.disabled = Boolean(reload.form?.querySelector('[type="submit"]')?.disabled);
        });
        tools.append(link, help, reload, failed);
        dependent.closest(`.${NAME}-field`).after(tools);
        point();
        // another code: the keyword stays only when the new code has it too
        chosen.addEventListener('change', () => {
            offerDependents(dependent.value);
            point();
        });
    }

    /**
     * Builds the field of a form.
     *
     * @param {{id: string}} kind kind of message
     * @param {object} spec what the field is, from the list of its kind of message
     * @param {string} id name for what belongs to the field
     * @param {boolean} isNew true in the form for a new message
     * @param {unknown} [kept] what the message that is changed holds in the field
     * @returns {{row: HTMLElement, input: HTMLElement}} the line of the form and the field in it
     */
    function field(kind, spec, id, isNew, kept) {
        // a field with a list below it is no label as a whole: a click into the list would
        // count as one into the field
        const row = make(spec.suggest ? 'div' : 'label', 'field');
        let input;
        if (spec.input === 'select') {
            input = make('select');
            for (const value of spec.options) {
                input.append(make('option', undefined, value));
            }
        } else if (spec.input === 'textarea') {
            input = make('textarea');
            input.rows = MESSAGE_ROWS;
        } else {
            input = make('input');
            input.type = spec.input === 'checkbox' ? 'checkbox' : 'text';
        }
        // with its kind before it: a bare "name" is what a password manager takes for the
        // name of a person, and offers to fill in
        input.name = `${kind.id}_${spec.path}`;
        input.required = Boolean(spec.isRequired);
        if (spec.max) {
            input.maxLength = spec.max;
        }
        const title = make(
            spec.suggest ? 'label' : 'span',
            'label',
            spec.label + (spec.isRequired ? ' *' : ''),
        );
        if (spec.input === 'textarea') {
            // names the code editor that may take the place of the field
            title.id = `${id}-title`;
        }
        if (spec.suggest) {
            // the words of the field are the label of the one on show
            title.htmlFor = `${id}-field`;
            row.append(
                title,
                combo(
                    input,
                    id,
                    spec.suggest,
                    // what the field cannot hold is not shown in it either
                    kept === undefined || kept === null || typeof kept === 'object'
                        ? undefined
                        : String(kept),
                    spec.only,
                ),
            );
        } else {
            // a checkbox stands before its words
            row.append(...(input.type === 'checkbox' ? [input, title] : [title, input]));
        }
        if (spec.help) {
            row.append(make('span', 'help', spec.help));
        }
        if (isNew && spec.whenNew) {
            row.append(make('span', 'help', spec.whenNew));
        }
        return { row, input };
    }

    /**
     * Builds the fields for the custom keys of a push message, below the field of its app: one
     * for every key the definition holds, at once and whatever becomes of the list of apps, and
     * one for every other key of the app that is chosen. They are no fields of the kind of
     * message: what they change is told by what each of them was filled with, and sent as the
     * whole list of the definition, in which everything that was not touched stays as it is.
     * One case apart: Marketing Cloud refuses a key the app does not define, so the stored keys
     * that the chosen app does not list, when that app is known, have no field. They are
     * printed in a box that says they are removed when the message is saved, and left out of
     * what is sent, which counts as a change.
     *
     * @param {HTMLInputElement} app the field that holds the id of the app
     * @param {object} [loaded] the definition the form was filled from; none for a new one
     * @returns {{element: HTMLElement, isChanged: () => boolean, built: () => object[], draw: () => void, printed: () => string[]}} the fields, whether one of them was changed, the list to send, what draws them again and the keys the box says are removed
     */
    function customKeys(app, loaded) {
        const element = make('div', 'custom-keys');
        const kept = valueAt(loaded, CUSTOM_KEYS);
        const stored = Array.isArray(kept) ? kept : [];
        // what is stored as something else than a list is shown in the details only, and left alone
        const isHeld = kept === undefined || kept === null || Array.isArray(kept);
        // the fields by their key: {input, filled, from}, the latter the stored entry, if any
        const fields = new Map();
        // the keys of the app that is chosen; none when the app is not known
        const listed = () =>
            offers.get('apps')?.entries?.find((entry) => entry.value === app.value.trim())?.keys;
        // the stored keys that the chosen app does not define, when it is known
        const gone = () => (isHeld ? strayKeys(stored, app.value.trim()) : []);
        // whether a stored entry is left out: its key is one of those
        const isLeft = (item) => gone().includes(item?.key);
        // the box that prints what is left out, and the keys it names
        const box = make('div', 'keys-gone');
        let printed = [];
        const add = (key, from) => {
            const row = make('label', 'field');
            const input = make('input');
            input.type = 'text';
            input.dataset.customKey = key;
            const value = from?.value;
            const isFixed = typeof value === 'object' && value !== null;
            if (isFixed) {
                input.disabled = true;
                input.title = 'This value cannot be changed here.';
            } else {
                input.value = value === undefined || value === null ? '' : String(value);
            }
            row.append(make('span', 'label', key), input);
            fields.set(key, { row, input, filled: input.value.trim(), from, isFixed });
        };
        for (const item of stored) {
            // an entry without a key, or with one that came before, has no field and stays
            if (typeof item?.key === 'string' && item.key && !fields.has(item.key)) {
                add(item.key, item);
            }
        }
        const title = make('span', 'help', 'Custom keys of the app');
        // the fields on show: those of what is stored and stays, then those of the app that is
        // chosen
        const shown = () => [
            ...fields.values().filter((item) => item.from && !isLeft(item.from)),
            ...(listed() ?? [])
                .filter((key) => !fields.get(key)?.from)
                .map((key) => {
                    // what was typed for a key comes back with its app
                    if (!fields.has(key)) {
                        add(key);
                    }
                    return fields.get(key);
                }),
        ];
        const draw = () => {
            const items = isHeld ? shown() : [];
            const rows = items.map((item) => item.row);
            printed = gone();
            if (printed.length > 0) {
                // every entry that is removed, also a second one of the same key
                const list = make('ul', 'keys-gone-list');
                for (const item of stored) {
                    if (!isLeft(item)) {
                        continue;
                    }

                    const { key, value } = item;
                    const text =
                        typeof value === 'object' && value !== null
                            ? JSON.stringify(value)
                            : String(value ?? '');
                    list.append(make('li', undefined, text ? `${key}: ${text}` : key));
                }
                box.replaceChildren(
                    make(
                        'strong',
                        undefined,
                        'These custom keys are not set up on the app. They will be removed when you save this message.',
                    ),
                    list,
                    appLink(app.value.trim()),
                );
            }
            const parts = [title, ...(printed.length > 0 ? [box] : []), ...rows];
            // fields that stay keep their place, and the cursor in them
            if (
                parts.length !== element.children.length ||
                parts.some((part, index) => element.children[index] !== part)
            ) {
                element.replaceChildren(...parts);
            }
            element.hidden = parts.length === 1;
        };
        const drawLater = async () => {
            await readOffers('apps', () => app.isConnected);
            draw();
        };
        // typing and choosing from the list both come as this
        app.addEventListener('input', draw);
        draw();
        drawLater();
        const changed = () =>
            (isHeld ? shown() : []).filter(
                ({ input, filled, isFixed }) => !isFixed && input.value.trim() !== filled,
            );
        return {
            element,
            draw,
            printed: () => printed,
            isChanged: () => changed().length > 0 || gone().length > 0,
            built: () => {
                const touched = new Set(changed());
                const sent = [];
                for (const item of stored) {
                    if (isLeft(item)) {
                        continue;
                    }
                    const field = fields.get(item?.key);
                    if (field?.from !== item || !touched.has(field)) {
                        sent.push(item);
                        continue;
                    }
                    const value = field.input.value.trim();
                    // a value that was taken out takes its key with it
                    if (value) {
                        sent.push({ ...item, value });
                    }
                }
                for (const field of touched) {
                    if (!field.from) {
                        sent.push({
                            key: field.input.dataset.customKey,
                            value: field.input.value.trim(),
                        });
                    }
                }
                return sent;
            },
        };
    }

    /**
     * Loads a script of the extension into the world of this script.
     *
     * @param {string} file name of the script
     * @returns {Promise.<unknown>} settles when the script ran; fails when it could not be loaded
     */
    function load(file) {
        const url = chrome.runtime.getURL(file);
        // the tests, which cannot load a script this way, put their own way here
        return typeof globalThis.sfmcUxToolsImport === 'function'
            ? globalThis.sfmcUxToolsImport(url)
            : import(url);
    }

    // the scripts of the code editor on their way into the page, or there; none before the
    // first message is shown
    let editorScripts;

    /**
     * Loads what makes a code editor, once for the details and the forms of the page.
     *
     * @returns {Promise.<void>} settles when the scripts ran; fails when one could not be loaded
     */
    function loadEditor() {
        if (!editorScripts) {
            const loading = (async () => {
                for (const file of EDITOR_SCRIPTS) {
                    await load(file);
                }
            })();
            editorScripts = loading;
            const forgetFailed = async () => {
                try {
                    await loading;
                } catch {
                    // asked for again the next time
                    if (editorScripts === loading) {
                        editorScripts = undefined;
                    }
                }
            };
            forgetFailed();
        }
        return editorScripts;
    }

    // the script that formats, on its way into the page or there; none before the first form
    // with a message has its editor
    let formatScript;

    /**
     * Loads what formats the message of a form, once for the page. The editor does not wait for
     * it: the script finds the editors that are there when it has run, and those that come
     * later. Without it the editor is one that does not format.
     */
    function loadFormatter() {
        if (formatScript) {
            return;
        }
        const loading = load(FORMAT_SCRIPT);
        formatScript = loading;
        const forgetFailed = async () => {
            try {
                await loading;
            } catch (ex) {
                // asked for again the next time
                if (formatScript === loading) {
                    formatScript = undefined;
                }
                // eslint-disable-next-line no-console -- the only trace of why the message cannot be formatted
                console.warn(`${MADE_BY}: the formatter for the message could not be loaded`, ex);
            }
        };
        forgetFailed();
    }

    /**
     * Keeps Escape for a code editor while a list of suggestions or a box of it is open (an
     * explanation, quick fixes, parameter help): the key closes that, not the panel. The editor
     * closes them itself, so what was open is noted before the key reaches it.
     *
     * @param {HTMLElement} mount where the editor stands
     * @param {object} editor the editor
     */
    function guardEscape(mount, editor) {
        let hasOpen = false;
        mount.addEventListener(
            'keydown',
            () => {
                const boxes = mount.closest('dialog')?.querySelectorAll('.sfmc-tooltip') ?? [];
                hasOpen =
                    Boolean(editor.state.completionActive) || [...boxes].some((box) => !box.hidden);
            },
            { capture: true },
        );
        mount.addEventListener('keydown', (event) => {
            if (!(hasOpen && event.key === 'Escape')) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
        });
    }

    /**
     * Shows the message of the details in the code editor of the form, to read: with its
     * colours and explanations, to be marked and copied, not to be changed. The editor is
     * loaded for this; until it is there, and when it cannot be had, the text stays as it is.
     *
     * @param {Element|undefined} cell where the details show the message
     * @param {unknown} text the message
     */
    async function codeView(cell, text) {
        if (!cell || typeof text !== 'string' || !text) {
            return;
        }
        const mount = make('div', 'code-view');
        // read only: no button to format it, and never formatted
        mount.setAttribute(FORMAT_MARK, NOT_FORMATTED);
        try {
            await loadEditor();
            // the details were left meanwhile
            if (!cell.isConnected) {
                return;
            }
            const plain = [...cell.children];
            cell.append(mount);
            const editor = new globalThis.CodeMirror(mount, {
                value: text,
                mode: EDITOR_MODE,
                lineNumbers: true,
                lineWrapping: true,
                readOnly: true,
                // all of the text is drawn: the editor is as tall as it, up to what the
                // stylesheet allows
                viewportMargin: Infinity,
                extraKeys: {
                    // left to the browser: on to the next button, and out of the panel
                    Tab: false,
                    'Shift-Tab': false,
                    Esc: false,
                },
            });
            // readOnly only stops typing: a suggestion or a quick fix that is clicked changes
            // the text through the editor's API, which is refused here
            editor.on('beforeChange', (_editor, change) => change.cancel());
            const typing = editor.getInputField();
            typing.setAttribute('aria-label', LABELS.get('content.message'));
            typing.setAttribute('aria-readonly', 'true');
            guardEscape(mount, editor);
            for (const item of plain) {
                item.remove();
            }
        } catch (ex) {
            mount.remove();
            // eslint-disable-next-line no-console -- the only trace of why the message is plain text
            console.warn(`${MADE_BY}: the code editor for the message could not be loaded`, ex);
        }
    }

    /**
     * Puts a code editor in the place of the field a message is typed into: with colours for
     * AMPscript, suggestions, explanations and underlined mistakes, as in Content Builder. The
     * field stays in the form, out of sight, and stays what the form reads: the editor writes
     * to it what the user changes. Without the editor, which is loaded for this, the field
     * stays as it is.
     *
     * @param {HTMLTextAreaElement} input the field
     * @returns {Promise.<object|undefined>} the editor; nothing when the field stays as it is
     */
    async function codeEditor(input) {
        const row = input.closest(`.${NAME}-field`);
        const mount = make('div', 'code');
        mount.setAttribute(FORMAT_MARK, FORMATTED);
        let editor;
        try {
            await loadEditor();
            // the form was left meanwhile, or the field cannot be changed
            if (!input.isConnected || input.disabled) {
                return;
            }
            // outside of the label that the line of the field is: a click into the editor is
            // none on the label
            row.after(mount);
            editor = new globalThis.CodeMirror(mount, {
                value: input.value,
                mode: EDITOR_MODE,
                lineNumbers: true,
                lineWrapping: true,
                extraKeys: {
                    // the form is sent with its button; the browser's dialog for saving the
                    // page stays away. The formatter leaves these two keys of its own editors
                    // alone
                    'Ctrl-S': () => {},
                    'Cmd-S': () => {},
                    // these are left to the browser, as everywhere in the form: on to the next
                    // field, back to the last one, and out of the panel
                    Tab: false,
                    'Shift-Tab': false,
                    Esc: false,
                },
            });
        } catch (ex) {
            mount.remove();
            // eslint-disable-next-line no-console -- the only trace of why the field is a plain one
            console.warn(`${MADE_BY}: the code editor for the message could not be loaded`, ex);
            return;
        }
        const typing = editor.getInputField();
        typing.setAttribute('aria-labelledby', row.querySelector(`.${NAME}-label`).id);
        typing.setAttribute('aria-required', String(input.required));
        // only what the user changes: an editor that was just filled changes nothing, so a
        // form that was not touched still sends nothing
        editor.on('change', () => {
            const value = editor.getValue();
            if (value === input.value) {
                return;
            }

            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        // typed into the field itself, which holds the cursor after the form pointed at it as empty
        input.addEventListener('input', () => {
            if (input.value === editor.getValue()) {
                return;
            }

            editor.setValue(input.value);
            editor.focus();
            editor.setCursor(editor.lineCount(), 0);
        });
        // a click on the title of the field goes to the field; the browser's note that the
        // message is missing needs the cursor to stay in it
        input.addEventListener('focus', () => {
            if (input.validity.valid) {
                editor.focus();
            }
        });
        guardEscape(mount, editor);
        const isFocused = document.activeElement === input;
        input.classList.add(`${NAME}-coded`);
        // still reachable for the form's check, no stop for the Tab key
        input.tabIndex = -1;
        if (isFocused) {
            editor.focus();
        }
        loadFormatter();
        return editor;
    }

    /**
     * Draws the sign for a person: a head above its shoulders.
     *
     * @returns {SVGElement} the sign, in the colour of the text around it
     */
    function personSign() {
        const sign = shape('svg', {
            class: `${NAME}-sign`,
            viewBox: '0 0 16 16',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '1.5',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'aria-hidden': 'true',
            focusable: 'false',
        });
        sign.append(
            shape('circle', { cx: '8', cy: '5', r: '2.75' }),
            shape('path', { d: 'M2.5 14a5.5 5.5 0 0 1 11 0' }),
        );
        return sign;
    }

    /**
     * Measures the text of an SMS: every character counts as one, those of the extension table
     * of the GSM alphabet as the two they take.
     *
     * @param {string} text the message
     * @returns {{count: number, others: {at: number, size: number}[]}} how many characters it has, and where those are that the GSM alphabet does not have
     */
    function measure(text) {
        let count = 0;
        let at = 0;
        const others = [];
        for (const character of text) {
            count += GSM_EXTENDED.has(character) ? 2 : 1;
            if (!GSM.has(character) && !GSM_EXTENDED.has(character)) {
                others.push({ at, size: character.length });
            }
            at += character.length;
        }
        return { count, others };
    }

    /**
     * Puts a line of helpers below the field a message is typed into: a button that inserts a
     * personalization string for an attribute of the business unit, the length of the message,
     * and a button that marks what the GSM alphabet does not have. They work with the code
     * editor and, but for the marks, with the plain field. A field that cannot be changed gets none.
     *
     * @param {HTMLTextAreaElement} input the field
     * @param {Promise.<object|undefined>} editing the code editor of the field, once it is there; nothing when it is not to be had
     */
    function messageTools(input, editing) {
        if (input.disabled) {
            return;
        }
        const bar = make('div', 'tools');
        let editor;
        const person = make('button', 'person');
        person.type = 'button';
        person.title = PERSONALIZE;
        person.setAttribute('aria-label', PERSONALIZE);
        person.setAttribute('aria-haspopup', 'listbox');
        person.setAttribute('aria-expanded', 'false');
        person.append(personSign());
        // not there until there is something to insert
        person.hidden = true;
        const size = make('span', 'count');
        const reveal = make('button', 'keep', SHOW_NON_GSM);
        reveal.type = 'button';
        const drop = make('div', 'combo-drop');
        const list = make('div', 'combo-list');
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', PERSONALIZE);
        list.id = `${NAME}-personalize`;
        list.tabIndex = -1;
        drop.hidden = true;
        drop.append(list);
        bar.append(person, size, reveal, drop);

        // the marks in the editor, which hold until the message is changed
        let marks = [];
        const unmark = () => {
            for (const mark of marks) {
                mark.clear();
            }
            marks = [];
        };
        const count = () => {
            const { count: characters, others } = measure(input.value);
            size.textContent = joined(
                `${characters} ${characters === 1 ? 'character' : 'characters'}`,
                others.length > 0 && `${others.length} not in the GSM alphabet`,
                input.value.includes('%%') && 'length depends on personalization',
            );
            // only the editor can mark them
            reveal.hidden = !editor || others.length === 0;
        };
        reveal.addEventListener('click', () => {
            unmark();
            // the editor has the text of the field, with the same line breaks
            marks = measure(editor.getValue()).others.map(({ at, size: length }) =>
                editor.markText(editor.posFromIndex(at), editor.posFromIndex(at + length), {
                    className: `${NAME}-non-gsm`,
                }),
            );
        });
        input.addEventListener('input', count);
        count();

        let names = [];
        let active = 0;
        const close = () => {
            drop.hidden = true;
            person.setAttribute('aria-expanded', 'false');
            list.removeAttribute('aria-activedescendant');
        };
        const insert = (name) => {
            const text = `%%${name}%%`;
            close();
            if (editor) {
                // the editor writes it to the field
                editor.replaceSelection(text);
                editor.focus();
                return;
            }
            input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        };
        const draw = () => {
            list.replaceChildren(
                ...names.map((name, index) => {
                    const option = make('div', 'combo-option');
                    option.id = `${list.id}-${index}`;
                    option.setAttribute('role', 'option');
                    option.setAttribute('aria-selected', String(index === active));
                    option.append(make('span', 'combo-name', name));
                    option.addEventListener('mousedown', (event) => {
                        // the cursor stays where the name goes
                        event.preventDefault();
                        insert(name);
                    });
                    if (index === active) {
                        option.classList.add(`${NAME}-combo-active`);
                    }
                    return option;
                }),
            );
            const at = list.children[active];
            if (at) {
                list.setAttribute('aria-activedescendant', at.id);
                at.scrollIntoView({ block: 'nearest' });
            } else {
                list.removeAttribute('aria-activedescendant');
            }
        };
        const move = (step) => {
            active = (active + step + names.length) % names.length;
            draw();
        };
        const keys = {
            ArrowDown: () => move(1),
            ArrowUp: () => move(-1),
            Enter: () => insert(names[active]),
            ' ': () => insert(names[active]),
            // closes the list, not the panel
            Escape: () => {
                close();
                person.focus();
            },
        };
        list.addEventListener('keydown', (event) => {
            if (!Object.hasOwn(keys, event.key)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            keys[event.key]();
        });
        // the Tab key and a click elsewhere leave the list
        list.addEventListener('blur', close);
        // a click on the button of an open list closes it: the list keeps the focus until then
        person.addEventListener('mousedown', (event) => {
            if (!drop.hidden) {
                event.preventDefault();
            }
        });
        person.addEventListener('click', () => {
            if (!drop.hidden) {
                close();
                // the list had the focus, and is gone
                person.focus();
                return;
            }
            active = 0;
            drop.hidden = false;
            person.setAttribute('aria-expanded', 'true');
            draw();
            list.focus();
        });
        input.closest(`.${NAME}-field`).after(bar);

        const offer = async () => {
            const found = await readOffers('attributes', () => bar.isConnected);
            names = (found ?? []).map((entry) => entry.value);
            // without attributes, or without their list, there is no button
            person.hidden = names.length === 0;
        };
        offer();
        const mark = async () => {
            editor = await editing;
            if (!editor) {
                return;
            }

            editor.on('change', unmark);
            count();
        };
        mark();
    }

    /**
     * Turns what a form holds into what the API takes. Text that was left empty is left out, and
     * so is a tick that a new message need not name and that was not set.
     *
     * @param {object[]} specs the fields of the kind of message
     * @param {Map.<string, HTMLElement>} inputs the fields of the form by their path
     * @returns {object} the definition
     */
    function toDefinition(specs, inputs) {
        const definition = {};
        for (const { path, input: type, isOptional } of specs) {
            const value = held({ input: type }, inputs.get(path));
            if (value === '' || (isOptional && value === false)) {
                continue;
            }
            const names = path.split('.');
            const last = names.pop();
            let at = definition;
            for (const name of names) {
                at[name] ||= {};
                at = at[name];
            }
            at[last] = value;
        }
        return definition;
    }

    /**
     * Says whether keys are to be made from names, as the options of the extension have it.
     *
     * @returns {Promise.<boolean>} false when the user switched that off
     */
    async function isKeyFromName() {
        try {
            const { readableKeys } = await chrome.storage.sync.get({ readableKeys: 'on' });
            return readableKeys === 'on';
        } catch {
            // without the setting it stays switched on
            return true;
        }
    }

    /**
     * Checks that a form has everything it must have, and points at what is missing.
     *
     * @param {HTMLFormElement} form the form
     * @param {Map.<string, HTMLElement>} inputs its fields by their path
     * @returns {boolean} true when it can be sent
     */
    function isComplete(form, inputs) {
        // blanks alone are no entry: a required field that holds nothing else counts as empty
        for (const input of inputs.values()) {
            if (input.type === 'text') {
                input.value = input.value.trim();
            }
        }
        return form.reportValidity();
    }

    /**
     * Sends a new definition and shows what became of it.
     *
     * @param {{id: string, title: string, fields: object[]}} kind kind of message
     * @param {HTMLFormElement} form the form
     * @param {Map.<string, HTMLElement>} inputs its fields by their path
     * @param {HTMLElement} says where a refusal is shown
     * @param {{built: () => object[]}} [keys] the custom keys of the form, if its kind has them
     */
    async function create(kind, form, inputs, says, keys) {
        const buttons = [...form.querySelectorAll('button')];
        // one is on its way already (its buttons are switched off until it is answered), or a
        // required field is empty; the button that reads the keywords again is off while it
        // reads, which holds nothing back
        const isBusy = buttons.some(
            (button) => button.disabled && !button.closest(`.${NAME}-code-tools`),
        );
        if (isBusy || !isComplete(form, inputs)) {
            return;
        }
        const mine = ++asked;
        for (const button of buttons) {
            button.disabled = true;
        }
        const definition = toDefinition(kind.fields, inputs);
        const added = keys?.built() ?? [];
        if (added.length > 0) {
            definition.options = { ...definition.options, customKeys: added };
        }
        const called = `“${definition.name}” (key ${definition.definitionKey})`;
        try {
            await write(kind, definition.definitionKey, 'POST', definition);
            // an answer that comes after the user went elsewhere is not shown
            if (mine === asked) {
                openDetails(kind, definition.definitionKey, `Created ${called}.`);
            }
        } catch (ex) {
            if (mine !== asked) {
                return;
            }
            if (ex.isUnanswered) {
                openList(
                    kind,
                    `It is not known whether ${called} was created: ${ex.message} Look for it in the list.`,
                );
                return;
            }
            // what was typed stays, to be put right
            says.textContent = `Not created: ${ex.message}`;
            says.hidden = false;
            for (const button of buttons) {
                button.disabled = false;
            }
        }
    }

    /**
     * Reads a value of a definition by the path of its field.
     *
     * @param {object} definition the definition
     * @param {string} path names from the definition down to the value, joined by dots
     * @returns {unknown} the value, undefined when it is not there
     */
    function valueAt(definition, path) {
        let at = definition;
        for (const name of path.split('.')) {
            at = at?.[name];
        }
        return at;
    }

    /**
     * Reads what a field of a form holds.
     *
     * @param {{input?: string}} spec what the field is
     * @param {HTMLElement} input the field
     * @returns {string|boolean} a tick, or text; the text of a message as typed, other text without the blanks around it
     */
    function held(spec, input) {
        if (spec.input === 'checkbox') {
            return input.checked;
        }
        return spec.input === 'textarea' ? input.value : input.value.trim();
    }

    /**
     * Collects what a form changes of a definition, as the API takes it: every part of the
     * definition that has a changed field, whole, however deep in it the field is. A part is sent with everything Marketing Cloud
     * holds in it, also what the form does not know, because nobody has seen whether the API
     * keeps what is left out of a part.
     *
     * @param {object[]} specs the fields of the kind of message
     * @param {Map.<string, HTMLElement>} inputs the fields of the form by their path
     * @param {object} loaded the definition the form was filled from
     * @param {Map.<string, string|boolean>} filled what each field held when the form was filled
     * @returns {{changes: object, paths: string[]}} what to send, and the fields that differ
     */
    function toChanges(specs, inputs, loaded, filled) {
        const changes = {};
        const paths = [];
        for (const spec of specs) {
            const value = held(spec, inputs.get(spec.path));
            // changed is what the user changed in the form. Holding the field against the
            // definition would also catch what a field cannot show as it is stored, such as a
            // number, line breaks or blanks around a text, and send that back altered
            if (value === filled.get(spec.path) || spec.path === 'definitionKey') {
                continue;
            }
            paths.push(spec.path);
            const names = spec.path.split('.');
            const last = names.pop();
            let at = changes;
            let from = loaded;
            // every part on the way down is copied once, so that the definition the form was
            // filled from stays as it was read
            for (const name of names) {
                from = from?.[name];
                if (at[name] === undefined || at[name] === from) {
                    at[name] = typeof from === 'object' && from !== null ? { ...from } : {};
                }
                at = at[name];
            }
            at[last] = value;
        }
        return { changes, paths };
    }

    /**
     * Sends the changes of a definition, unless it is no longer the one the form was filled
     * from, and shows what became of them.
     *
     * @param {{id: string, title: string, fields: object[]}} kind kind of message
     * @param {HTMLFormElement} form the form
     * @param {Map.<string, HTMLElement>} inputs its fields by their path
     * @param {HTMLElement} says where a refusal is shown
     * @param {object} loaded the definition the form was filled from
     * @param {Map.<string, string|boolean>} filled what each field held when the form was filled
     * @param {{isChanged: () => boolean, built: () => object[], draw: () => void, printed: () => string[]}} [keys] the custom keys of the form, if its kind has them
     */
    async function save(kind, form, inputs, says, loaded, filled, keys) {
        const buttons = [...form.querySelectorAll('button')];
        // one is on its way already, or a required field is empty; the button that reads the
        // keywords again is off while it reads, which holds no save back
        const isBusy = buttons.some(
            (button) => button.disabled && !button.closest(`.${NAME}-code-tools`),
        );
        if (isBusy || !isComplete(form, inputs)) {
            return;
        }
        // what is sent is what the box of the custom keys shows, by the list of apps as it is now
        keys?.draw();
        const key = loaded.definitionKey;
        const collect = () => {
            const found = toChanges(kind.fields, inputs, loaded, filled);
            if (keys?.isChanged()) {
                // into the options that go out anyway, or into a copy of those that are stored:
                // the list is sent whole, next to everything else the part holds
                const { options } = loaded;
                found.changes.options ??=
                    typeof options === 'object' && options !== null ? { ...options } : {};
                found.changes.options.customKeys = keys.built();
                found.paths.push(CUSTOM_KEYS);
            }
            return found;
        };
        let { changes, paths } = collect();
        // the custom keys the form says are removed by this save
        const removed = keys?.printed() ?? [];
        // what an earlier try said no longer holds
        says.hidden = true;
        if (paths.length === 0 && removed.length === 0) {
            says.textContent = 'Nothing was changed, so nothing was sent.';
            says.hidden = false;
            return;
        }
        const mine = ++asked;
        for (const button of buttons) {
            button.disabled = true;
        }
        const called = `“${loaded.name}” (key ${key})`;
        // how far it got: the check before, the request itself, the look at what came of it
        let step = 'check';
        try {
            if (removed.length > 0) {
                // the list of apps is as old as the page: a key may have been set up on the app
                // since. Nothing is removed on the word of an old list, so it is read again,
                // and kept for everyone else
                const [fresh] = await readOffersAgain(['apps'], () => true);
                if (mine !== asked) {
                    return;
                }
                // by the list that is there now, also when it is the old one or none
                keys.draw();
                if (!fresh) {
                    throw new Error(
                        'the custom keys of the app could not be checked, so nothing was removed. Try again.',
                    );
                }
                if (JSON.stringify(keys.printed()) !== JSON.stringify(removed)) {
                    throw new Error(
                        'the custom keys of the app have changed. Check the form and save again.',
                    );
                }
                ({ changes, paths } = collect());
            }
            // as before a delete: the request names only the key, which another business unit
            // may hold too, and someone else may have changed the message since it was read
            const current = await readDefinition(kind, key);
            if (mine !== asked) {
                // the user went elsewhere before anything was sent: nothing is saved
                return;
            }
            if (JSON.stringify(current) !== JSON.stringify(loaded)) {
                throw new Error(
                    'what Marketing Cloud holds under this key is no longer what this form was filled from. Was it changed meanwhile, or the business unit changed in another tab? Open the message again.',
                );
            }
            step = 'send';
            await write(kind, key, PATCH, changes);
            if (mine !== asked) {
                return;
            }
            step = 'read';
            // an answer that all went well was never seen for a real message: what Marketing
            // Cloud holds now is read and held against what was sent
            const now = await readDefinition(kind, key);
            if (mine !== asked) {
                return;
            }
            const missed = paths.filter((path) => {
                const sent = valueAt(changes, path);
                // a list is held against the list that is there, key by key and each value as
                // text, whatever else an entry holds and in whatever order; none counts as an
                // empty one
                if (Array.isArray(sent)) {
                    const got = valueAt(now, path) ?? [];
                    const pairs = (list) =>
                        JSON.stringify(list.map((entry) => [entry?.key, String(entry?.value)]));
                    return !Array.isArray(got) || pairs(got) !== pairs(sent);
                }
                // what is not there counts as not ticked, or as no text; a number as its digits
                const got = valueAt(now, path) ?? (sent === false ? false : '');
                return (typeof sent === 'boolean' ? got : String(got)) !== sent;
            });
            showDetails(
                kind,
                now,
                missed.length === 0
                    ? `Saved ${called}.`
                    : `Marketing Cloud answered that ${called} was saved, but these fields are not as they were sent: ${missed.join(', ')}. See below what it holds now.`,
            );
        } catch (ex) {
            if (mine !== asked) {
                return;
            }
            if (step === 'read') {
                openDetails(
                    kind,
                    key,
                    `Marketing Cloud answered that ${called} was saved, but it could not be read again: ${ex.message}`,
                );
                return;
            }
            if (step === 'send' && ex.isUnanswered) {
                openDetails(
                    kind,
                    key,
                    `It is not known whether ${called} was saved: ${ex.message} See below what Marketing Cloud holds now.`,
                );
                return;
            }
            // nothing was saved; what was typed stays, to be put right
            says.textContent = `Not saved: ${ex.message}`;
            says.hidden = false;
            for (const button of buttons) {
                button.disabled = false;
            }
        }
    }

    /**
     * Fits a form to the settings of MobileConnect for the account, once they are read: without
     * link shortening the boxes that ask for it are switched off, except one that was ticked
     * when the form was filled, which can still be unticked; and a send blockout window is
     * mentioned next to the message. Nothing of this changes what is sent. Settings that cannot
     * be read, or that say something else than yes or no, leave the form as it is.
     *
     * @param {object[]} specs the fields of the kind of message
     * @param {Map.<string, HTMLElement>} inputs the fields of the form by their path
     * @param {Map.<string, string|boolean>} filled what each field held when the form was filled
     */
    async function accountSettings(specs, inputs, filled) {
        const boxes = specs.filter((spec) => spec.isShortened);
        const message = inputs.get(specs.find((spec) => spec.isHeldBack)?.path);
        const [first = message] = boxes.map((spec) => inputs.get(spec.path));
        if (!first) {
            return;
        }
        const isShown = () => first.isConnected;
        const [account] = (await readOffers('account', isShown)) ?? [];
        // an answer that comes after the form was left changes nothing
        if (!account || !isShown()) {
            return;
        }
        if (account.isShortening === false && boxes.length > 0) {
            for (const { path } of boxes) {
                const box = inputs.get(path);
                box.disabled ||= !box.checked && filled.get(path) !== true;
            }
            inputs
                .get(boxes.at(-1).path)
                .closest(`.${NAME}-field`)
                .after(accountNote('Link shortening is switched off for this account (', ').'));
        }
        if (message && account.isBlockedOut === true) {
            message
                .closest(`.${NAME}-field`)
                .before(
                    accountNote(
                        'This account has a send blockout window (',
                        '); messages may be held back during it.',
                    ),
                );
        }
    }

    /**
     * Shows the form for a new definition, or for one that exists.
     *
     * @param {{id: string, title: string, fields: object[]}} kind kind of message
     * @param {object} [loaded] the definition to change; none for a new one
     */
    async function openForm(kind, loaded) {
        const mine = ++asked;
        const isFollowing = !loaded && (await isKeyFromName());
        if (mine !== asked) {
            return;
        }
        const form = make('form', 'form');
        // the form checks its fields itself, when it is sent
        form.noValidate = true;
        const inputs = new Map();
        const number = ++forms;
        for (const [index, spec] of kind.fields.entries()) {
            const { row, input } = field(
                kind,
                spec,
                `${NAME}-list-${number}-${index}`,
                !loaded,
                valueAt(loaded, spec.path),
            );
            inputs.set(spec.path, input);
            form.append(row);
            if (!loaded) {
                continue;
            }
            const value = valueAt(loaded, spec.path);
            const isTick = spec.input === 'checkbox';
            // what the field cannot hold is shown in the details only, and left as it is
            const isHeld = isTick
                ? value === undefined || typeof value === 'boolean'
                : value === undefined || value === null || typeof value !== 'object';
            if (!isHeld) {
                // also the field that is on show in its place, if one is
                for (const fixed of [input, faces.get(input) ?? input]) {
                    fixed.disabled = true;
                    fixed.title = 'This value cannot be changed here.';
                }
            } else if (isTick) {
                input.checked = value === true;
            } else {
                const text = value === undefined || value === null ? '' : String(value);
                // a choice the form does not know is kept as it is, not turned into another
                if (text && spec.input === 'select' && !spec.options.includes(text)) {
                    input.append(make('option', undefined, text));
                }
                input.value = text;
            }
        }
        // the key follows the name, as in the dialogs of Marketing Cloud, until one is typed
        const name = inputs.get('name');
        const key = inputs.get('definitionKey');
        // the key of a message cannot be changed once it exists
        key.readOnly = Boolean(loaded);
        // what the form holds before the user touches it, to tell later what they changed
        const filled = new Map(
            kind.fields.map((spec) => [spec.path, held(spec, inputs.get(spec.path))]),
        );
        let isTyped = false;
        key.addEventListener('input', () => {
            isTyped = key.value !== '';
        });
        name.addEventListener('input', () => {
            if (isFollowing && !isTyped) {
                key.value = globalThis.sfmcUxToolsToKey(name.value, KEY_MAX);
            }
        });
        for (const { path, needs } of kind.fields) {
            if (!needs) {
                continue;
            }
            const dependent = inputs.get(path);
            const needed = inputs.get(needs);
            dependent.addEventListener('change', () => {
                needed.checked ||= dependent.checked;
            });
            needed.addEventListener('change', () => {
                dependent.checked &&= needed.checked;
            });
        }
        const keyed = kind.fields.find((spec) => spec.isKeyed);
        let keys;
        if (keyed) {
            const app = inputs.get(keyed.path);
            keys = customKeys(app, loaded);
            app.closest(`.${NAME}-field`).after(keys.element);
        }
        const says = make('p', 'error');
        says.hidden = true;
        const send = make('button', 'save', loaded ? 'Save' : 'Create');
        send.type = 'submit';
        send.setAttribute(FORMAT_SAVE, '');
        const cancel = make('button', 'keep', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', () =>
            loaded ? openDetails(kind, loaded.definitionKey) : openList(kind),
        );
        form.append(says, send, cancel);
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            // a refusal may be left from lists that were dropped since
            for (const input of inputs.values()) {
                checks.get(input)?.();
            }
            if (loaded) {
                save(kind, form, inputs, says, loaded, filled, keys);
            } else {
                create(kind, form, inputs, says, keys);
            }
        });
        const second = kind.fields.find((spec) => spec.within);
        if (second) {
            chooseBoth(
                inputs,
                kind.fields.find((spec) => spec.path === second.within),
                second,
            );
        }
        accountSettings(kind.fields, inputs, filled);
        for (const spec of kind.fields) {
            if (spec.isLinked) {
                contentTools(inputs.get(spec.path));
            }
        }
        fill(
            make(
                'h3',
                'title',
                loaded
                    ? `Edit “${loaded.name}” (key ${loaded.definitionKey})`
                    : `New ${kind.title} message`,
            ),
            form,
        );
        name.focus();
        for (const spec of kind.fields) {
            if (spec.input === 'textarea') {
                messageTools(inputs.get(spec.path), codeEditor(inputs.get(spec.path)));
            }
        }
    }

    /**
     * Shows a definition with what can be done with it.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {object} definition the definition, as it was just read
     * @param {string} [notice] what just happened, to say above the details
     */
    function showDetails(kind, definition, notice) {
        const back = make('button', 'back', `← All ${kind.title} messages`);
        back.type = 'button';
        back.addEventListener('click', () => openList(kind));
        const edit = make('button', 'keep', 'Edit');
        edit.type = 'button';
        edit.addEventListener('click', () => openForm(kind, definition));
        const erase = make('button', 'delete', 'Delete');
        erase.type = 'button';
        erase.addEventListener('click', () => confirmDelete(kind, definition, erase));
        const does = make('div', 'does');
        does.append(edit, erase);
        const actions = make('div', 'actions');
        actions.append(back, does);
        const named = new Map(
            kind.fields.filter((spec) => spec.isNamed).map((spec) => [spec.path, spec.suggest]),
        );
        const shown = show(definition, named);
        // where the details show the value of a field, by the path of the field
        const cellOf = (path) =>
            [...shown.querySelectorAll('dt')].find((item) => item.title === path)
                ?.nextElementSibling;
        // says which custom keys the app no longer defines, once the list of apps tells
        const warning = make('div', 'keys-warning');
        warning.hidden = true;
        fill(...(notice ? [make('p', 'notice', notice)] : []), actions, warning, shown);
        const warn = async () => {
            await readOffers('apps', () => warning.isConnected);
            const stored = valueAt(definition, CUSTOM_KEYS);
            const stray = strayKeys(stored, definition.applicationId);
            if (stray.length === 0) {
                return;
            }
            warning.append(
                make(
                    'strong',
                    undefined,
                    `Custom keys the app does not define: ${stray.join(', ')}`,
                ),
                make(
                    'p',
                    undefined,
                    'Marketing Cloud no longer accepts them for this app. Saving this message here removes them. To keep them, add them to the app first.',
                ),
                appLink(definition.applicationId),
            );
            warning.hidden = false;
            // the rows of those keys, which stand in the order of what is stored
            const rows = [...(cellOf(CUSTOM_KEYS)?.querySelectorAll(':scope > dl > dt') ?? [])];
            for (const [index, item] of stored.entries()) {
                const row = rows.at(index);
                if (!row || !stray.includes(item?.key)) {
                    continue;
                }

                row.classList.add(`${NAME}-stray-key`);
                row.nextElementSibling.classList.add(`${NAME}-stray-key`);
                row.nextElementSibling.append(make('span', 'stray-note', 'not defined on the app'));
            }
        };
        const keyed = kind.fields.find((spec) => spec.isKeyed)?.path;
        if (keyed) {
            const appId = valueAt(definition, keyed);
            if (typeof appId === 'string' && appId) {
                cellOf(keyed)?.append(appLink(appId));
            }
            warn();
        }
        // the code of an SMS message gets a link once the list of codes tells its id
        const coded = kind.fields.find((spec) => spec.choose === 'codes')?.path;
        const point = async () => {
            const entries = await readOffers('codes', () => shown.isConnected);
            const code = valueAt(definition, coded);
            const id = entries?.find((entry) => entry.value === code)?.id;
            if (typeof id === 'string' && id) {
                cellOf(coded)?.append(codeLink(id));
            }
        };
        if (coded) {
            point();
        }
        // the content of a push message gets a link once its id and the business unit are known
        const link = async (path) => {
            const found = await contentLink(valueAt(definition, path), () => shown.isConnected);
            if (found && shown.isConnected) {
                cellOf(path)?.append(found);
            }
        };
        for (const { path, isSaid, isLinked, input } of kind.fields) {
            if (isSaid) {
                showTexts(shown, path, valueAt(definition, path));
            }
            if (isLinked) {
                link(path);
            }
            // the message of an SMS, as the form shows it
            if (input === 'textarea') {
                codeView(cellOf(path), valueAt(definition, path));
            }
        }
    }

    /**
     * Shows the details of one definition.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {string} key key of the definition
     * @param {string} [notice] what just happened, to say above the details
     */
    async function openDetails(kind, key, notice) {
        const mine = ++asked;
        const said = notice ? [make('p', 'notice', notice)] : [];
        fill(...said, make('p', 'hint', 'Loading …'));
        const before = changed;
        try {
            const definition = await readDefinition(kind, key);
            // the lists show it too, until theirs say that it was changed after this
            if (before === changed) {
                keep(kind, key, definition, definition.modifiedDate);
            }
            if (mine === asked) {
                showDetails(kind, definition, notice);
            }
        } catch (ex) {
            if (mine === asked) {
                fail(ex, ...said);
            }
        }
    }

    /**
     * Lists the columns of the list of a kind of message.
     *
     * @param {{columns?: object[]}} kind kind of message
     * @returns {object[]} the columns every list has, with those of the kind among them
     */
    function columnsOf(kind) {
        const at = COLUMNS.findIndex((column) => column.field === BEFORE_DETAILS) + 1;
        return COLUMNS.toSpliced(at, 0, ...(kind.columns || []));
    }

    /**
     * Reads what a column shows of a row that only the details of its message hold.
     *
     * @param {{id: string}} kind kind of message
     * @param {object} row the row
     * @param {{field: string, names?: string}} column the column
     * @returns {{text: string, name?: string}} the value as the definition holds it, empty until it is read, and what the business unit calls it, if it is known
     */
    function detail(kind, row, column) {
        const value = valueAt(detailsOf(kind, row), column.field);
        return {
            text: value === undefined || value === null ? '' : String(value),
            name: column.names ? nameOf(column.names, value) : undefined,
        };
    }

    /**
     * Builds the row of a definition in its list.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {object} row the definition
     * @param {object[]} columns the columns of the list
     * @returns {{element: HTMLTableRowElement, fill: () => void}} the row, and what to call when its details or their names have come
     */
    function line(kind, row, columns) {
        const element = make('tr');
        const late = [];
        for (const column of columns) {
            const cell = element.insertCell();
            if (column.isDetail) {
                late.push([column, cell]);
            } else if (column.isDate) {
                stamp(cell, row?.[column.field]);
            } else {
                cell.textContent = row?.[column.field] ?? '';
            }
        }
        // the column of the app whose custom keys a message holds
        const keyed = kind.fields?.find((spec) => spec.isKeyed)?.path;
        const fill = () => {
            const definition = detailsOf(kind, row);
            const stray = keyed
                ? strayKeys(valueAt(definition, CUSTOM_KEYS), valueAt(definition, keyed))
                : [];
            for (const [column, cell] of late) {
                const { text, name = text } = detail(kind, row, column);
                cell.textContent = name;
                // the id or the key behind a name is to be read when the mouse rests on it
                if (text && column.names) {
                    cell.title = text;
                }
                if (column.field !== keyed || stray.length === 0) {
                    continue;
                }

                const says = `Custom keys the app does not define: ${stray.join(', ')}`;
                const sign = make('span', 'warn', '⚠');
                sign.setAttribute('role', 'img');
                sign.setAttribute('aria-label', says);
                sign.title = says;
                cell.prepend(sign, ' ');
            }
            element.classList.toggle(`${NAME}-stray`, stray.length > 0);
        };
        fill();
        const key = row?.definitionKey;
        // without a key there is nothing to ask the details for
        if (!(typeof key === 'string' && key)) {
            return { element, fill };
        }

        element.tabIndex = 0;
        element.dataset.key = key;
        element.title = 'Show the details';
        element.addEventListener('click', () => openDetails(kind, key));
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                openDetails(kind, key);
            }
        });
        return { element, fill };
    }

    /**
     * Picks the definitions of the status asked for that match what is searched for, in the order
     * asked for. A row is also found by what the columns of its kind hold and show, once its
     * details are read.
     *
     * @param {{id: string}} kind kind of message
     * @param {object[]} all the definitions as they were read
     * @param {{search: string, status: string, isReversed: boolean}} view what the user searches by, the status to show (none for all), and which way round the order is
     * @param {object[]} columns the columns of the list
     * @param {object} [column] the column to sort by; none for the order of the list
     * @returns {object[]} the definitions to show
     */
    function listed(kind, all, { search, status, isReversed }, columns, column) {
        const wanted = search.trim().toLowerCase();
        const late = columns.filter((item) => item.isDetail);
        const rows = status ? all.filter((row) => row?.status === status) : all;
        const found = wanted
            ? rows.filter((row) =>
                  [
                      ...SEARCHED.map((name) => row?.[name]),
                      ...late.flatMap((item) => Object.values(detail(kind, row, item))),
                  ].some((text) => typeof text === 'string' && text.toLowerCase().includes(wanted)),
              )
            : rows;
        if (!column) {
            return found;
        }
        const turn = isReversed ? -1 : 1;
        const text = column.isDetail
            ? (row) => {
                  // a row whose details could not be read is sorted as empty
                  const shown = detail(kind, row, column);
                  return String(shown.name ?? shown.text ?? '');
              }
            : (row) => String(row?.[column.field] ?? '');
        // a date is sorted as the API writes it, which puts the earlier one first
        const order = column.isDate
            ? (one, other) => (one > other) - (one < other)
            : (one, other) => one.localeCompare(other, undefined, { sensitivity: 'base' });
        return found.toSorted((one, other) => turn * order(text(one), text(other)));
    }

    /**
     * Builds the table of definitions, with the field to search it by, the list of statuses to
     * narrow it to and the buttons to page through it. Searching, choosing a status, sorting and
     * paging redraw its rows and the line below them only, so
     * that the field being typed in stays as it is. The details that the list did not bring are
     * read while the table is on show, a few at a time, and fill in row by row.
     *
     * @param {{id: string, title: string, columns?: object[]}} kind kind of message
     * @param {object[]} rows the definitions
     * @param {() => boolean} isShown false once the panel shows something else or is closed
     * @returns {{search: HTMLInputElement, status: HTMLSelectElement, progress: HTMLElement, content: HTMLElement[]}} the search field, the list of statuses, the place that says how many details are read, and the table with what belongs below it
     */
    function table(kind, rows, isShown) {
        const view = views.get(kind.id);
        const columns = columnsOf(kind);
        // the columns that only the details of a message fill
        const late = kind.columns || [];
        const element = make('table', 'list');
        const head = element.createTHead().insertRow();
        const content = element.createTBody();
        const none = make('p', 'hint');
        const pager = make('div', 'pager');
        const previous = make('button', 'previous', '← Previous');
        const next = make('button', 'next', 'Next →');
        const range = make('span', 'range');
        const progress = make('span', 'progress');
        // the rows whose details can be asked for, by their key
        const keyed = new Map(
            (late.length > 0 ? rows : [])
                .filter((row) => typeof row?.definitionKey === 'string' && row.definitionKey)
                .map((row) => [row.definitionKey, row]),
        );
        // the keys whose details are not there yet, and those among them nobody has asked for
        const missing = new Set(keyed.keys().filter((key) => !detailsOf(kind, keyed.get(key))));
        const waiting = new Set(missing);
        // what fills the cells of a row on show, by its key
        const drawn = new Map();
        // the details this table waits for
        let awaited = 0;
        // nothing is asked for any more: what is missing now could not be read
        const isDone = () => awaited === 0 && waiting.size === 0;
        // whether the table was told so
        let hasEnded = isDone();
        // a column of details puts the rows in order once all details that can be had are there
        const sorted = () => {
            const column = columns.find((item) => item.field === view.field);
            return column?.isDetail && !isDone() ? undefined : column;
        };
        const mark = () => {
            const by = sorted();
            for (const cell of head.cells) {
                const direction = view.isReversed ? 'descending' : 'ascending';
                cell.setAttribute(
                    'aria-sort',
                    cell.dataset.field === by?.field ? direction : 'none',
                );
                const sort = cell.firstChild;
                sort.disabled = 'detail' in cell.dataset && !isDone();
                sort.title = sort.disabled ? SORT_LATER : SORT;
            }
        };
        const draw = () => {
            mark();
            const found = listed(kind, rows, view, columns, sorted());
            const last = Math.max(Math.ceil(found.length / ROWS_SHOWN) - 1, 0);
            // a list that got shorter has no such page any more
            view.page = Math.min(view.page, last);
            const from = view.page * ROWS_SHOWN;
            const shown = found.slice(from, from + ROWS_SHOWN);
            // rows that are drawn again while one of them is being used keep it in use
            const used = content.contains(document.activeElement)
                ? document.activeElement.dataset.key
                : undefined;
            drawn.clear();
            content.replaceChildren(
                ...shown.map((row) => {
                    const { element: item, fill } = line(kind, row, columns);
                    if (item.dataset.key) {
                        drawn.set(item.dataset.key, fill);
                    }
                    return item;
                }),
            );
            if (used) {
                [...content.rows].find((item) => item.dataset.key === used)?.focus();
            }
            none.hidden = shown.length > 0;
            none.textContent = view.status
                ? `No message with the status ${view.status} matches what you search for.`
                : 'No message matches what you search for.';
            pager.hidden = last === 0;
            range.textContent = `${from + 1}–${from + shown.length} of ${found.length}`;
            previous.disabled = view.page === 0;
            next.disabled = view.page === last;
        };
        // what has come changes the rows, or their order: they are drawn again. Otherwise the
        // cells are filled where they stand
        const fill = (isOtherRows, cells) => {
            if (isOtherRows) {
                draw();
                return;
            }
            for (const cell of cells) {
                cell();
            }
            mark();
        };
        const tell = () => {
            progress.hidden = missing.size === 0;
            if (isDone()) {
                progress.textContent = `${missing.size} of ${keyed.size} details could not be read`;
                progress.title = UNREAD;
            } else {
                progress.textContent = `details ${keyed.size - missing.size} of ${keyed.size}`;
                progress.title = '';
            }
        };
        const arrived = (key) => {
            if (!detailsOf(kind, keyed.get(key))) {
                return;
            }
            missing.delete(key);
            // a row that is not on show may match what is searched for by what has come
            const isFound = view.search.trim() && !drawn.has(key);
            fill(isFound || sorted()?.isDetail, drawn.has(key) ? [drawn.get(key)] : []);
        };
        const more = () => {
            if (!isShown()) {
                return;
            }
            while (waiting.size > 0) {
                // the rows on show first, then the others in the order of the list
                const key =
                    drawn.keys().find((item) => waiting.has(item)) ?? waiting.values().next().value;
                const row = keyed.get(key);
                // what another showing of this list has asked for is waited for, not asked again
                let read = reading.get(`${kind.id} ${key}`);
                const isOwn = !read;
                if (isOwn) {
                    if (reading.size >= DETAILS_AT_ONCE) {
                        break;
                    }
                    read = readDetails(kind, row);
                }
                waiting.delete(key);
                awaited++;
                const follow = async () => {
                    await read;
                    awaited--;
                    if (!isShown()) {
                        return;
                    }
                    if (isOwn || detailsOf(kind, row)) {
                        arrived(key);
                    } else {
                        // it was asked for an earlier state of the list: once more, for this one
                        waiting.add(key);
                    }
                    more();
                };
                follow();
            }
            tell();
            if (hasEnded || !isDone()) {
                return;
            }
            hasEnded = true;
            // the columns of details can be sorted by now, and may be the order on show
            fill(view.search.trim() || sorted()?.isDetail, []);
            const lost = rows.filter((row) => notFound.has(signature(kind.id, row)));
            if (lost.length > 0) {
                leaveOut(kind, lost);
            }
        };
        for (const { title, field, isDetail } of columns) {
            const cell = make('th');
            cell.scope = 'col';
            cell.dataset.field = field;
            if (isDetail) {
                cell.dataset.detail = '';
            }
            const sort = make('button', 'sort', title);
            sort.type = 'button';
            sort.addEventListener('click', () => {
                view.isReversed = view.field === field && !view.isReversed;
                view.field = field;
                view.page = 0;
                draw();
            });
            cell.append(sort);
            head.append(cell);
        }
        const by = EITHER.format([
            'name',
            'key',
            ...late.map((column) => column.title.toLowerCase()),
        ]);
        const search = make('input', 'search');
        search.type = 'search';
        search.placeholder = `Search ${by}`;
        search.setAttribute('aria-label', `Search the ${kind.title} messages by ${by}`);
        search.value = view.search;
        search.addEventListener('input', () => {
            view.search = search.value;
            view.page = 0;
            draw();
        });
        const status = make('select', 'status');
        status.setAttribute('aria-label', 'Show by status');
        // how many messages have each status that occurs, the known ones first; counted again
        // when rows are left out
        const count = () => {
            const counts = new Map();
            for (const { status: name } of rows) {
                if (typeof name === 'string' && name) {
                    counts.set(name, (counts.get(name) || 0) + 1);
                }
            }
            status.replaceChildren(
                choice('', `All (${rows.length})`),
                ...[
                    ...STATUSES.filter((name) => counts.has(name)),
                    ...counts
                        .keys()
                        .filter((name) => !STATUSES.includes(name))
                        .toArray()
                        .toSorted((one, other) => one.localeCompare(other)),
                ].map((name) => choice(name, `${name} (${counts.get(name)})`)),
            );
            // a status that no message has any more is not asked for any longer
            view.status = counts.has(view.status) ? view.status : '';
            status.value = view.status;
        };
        count();
        status.addEventListener('change', () => {
            view.status = status.value;
            view.page = 0;
            draw();
        });
        const turn = (button, pages) => {
            button.type = 'button';
            button.addEventListener('click', () => {
                view.page += pages;
                draw();
            });
        };
        turn(previous, -1);
        turn(next, 1);
        pager.append(previous, range, next);
        draw();
        // the names of what the columns show come with the list they are in, for all rows at once
        for (const { names } of late) {
            if (!names) {
                continue;
            }
            const name = async () => {
                await readOffers(names, isShown);
                if (isShown()) {
                    fill(view.search.trim() || sorted()?.isDetail, drawn.values());
                }
            };
            name();
        }
        wake = more;
        dropped = (other, gone) => {
            if (other.id !== kind.id || !isShown()) {
                return;
            }
            // the kept list lost them already when it is this one; otherwise they go here
            for (const row of gone) {
                const at = rows.findIndex(
                    (item) => signature(kind.id, item) === signature(kind.id, row),
                );
                if (at !== -1) {
                    rows.splice(at, 1);
                }
                // a row under the same key that was changed since is another one, and stays
                const key = row.definitionKey;
                if (signature(kind.id, keyed.get(key)) !== signature(kind.id, row)) {
                    continue;
                }

                keyed.delete(key);
                missing.delete(key);
                waiting.delete(key);
            }
            count();
            tell();
            draw();
        };
        more();
        // the rows scroll under the names of their columns; what is around the table stays
        const scroll = make('div', 'rows');
        scroll.append(element);
        return { search, status, progress, content: [scroll, none, pager] };
    }

    /**
     * Shows a list that was read, with what can be done with it.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {{rows: object[], readAt: Date}} list the definitions, and when they were read
     * @param {HTMLElement[]} said what just happened, to stay above the list
     */
    function showList(kind, { rows, readAt }, said) {
        const create = make('button', 'new', `New ${kind.title} message`);
        create.type = 'button';
        create.addEventListener('click', () => openForm(kind));
        const refresh = make('button', 'refresh');
        refresh.type = 'button';
        refresh.title = REFRESH;
        refresh.setAttribute('aria-label', REFRESH);
        refresh.append(reloadSign());
        refresh.addEventListener('click', () => {
            lists.delete(kind.id);
            // the names shown with the messages are read again as well, and what their contents say
            offers.clear();
            cleared++;
            texts.clear();
            openList(kind);
        });
        const read = make(
            'span',
            'read',
            `read ${readAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
        );
        // the time alone does not tell a list that was read on another day
        read.title = readAt.toLocaleString();
        const bar = make('div', 'bar');
        bar.append(create, refresh, read);
        if (rows.length === 0) {
            fill(
                ...said,
                bar,
                make(
                    'p',
                    'hint',
                    `This business unit has no transactional ${kind.title} messages.`,
                ),
            );
            return;
        }
        const mine = asked;
        const { search, status, progress, content } = table(kind, rows, () => mine === asked);
        bar.append(progress, search, status);
        fill(...said, bar, ...content);
        dialog.classList.add(LISTING);
    }

    /**
     * Marks the tab of a kind of message as the one on show, and says what is to be said of that
     * kind above whatever the panel shows of it.
     *
     * @param {{id: string, note?: Array}} kind kind of message
     */
    function select(kind) {
        for (const tab of tabs.children) {
            tab.setAttribute('aria-selected', String(tab.dataset.kind === kind.id));
        }
        note.replaceChildren(
            ...(kind.note || []).map((part) => {
                if (typeof part === 'string') {
                    return part;
                }
                const link = make('a', undefined, part.text);
                link.href = part.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                return link;
            }),
        );
        note.hidden = !kind.note;
    }

    /**
     * Shows the list of one kind of message: the one that was read before, unless a message of
     * that kind was created, changed or deleted since, or none was read yet.
     *
     * @param {{id: string, title: string, note?: Array}} kind kind of message
     * @param {string} [notice] what just happened, to say above the list
     */
    async function openList(kind, notice) {
        const mine = ++asked;
        select(kind);
        // what just happened stays in view, whatever becomes of the list
        const said = notice ? [make('p', 'notice', notice)] : [];
        const kept = lists.get(kind.id);
        if (kept) {
            showList(kind, kept, said);
            return;
        }
        fill(...said, make('p', 'hint', 'Loading …'));
        const before = changed;
        try {
            const all = await readList(kind.id, () => mine === asked);
            // what was made sure of before cannot be read: it is left out without asking
            const left = await unreadableRows();
            // whoever went elsewhere stopped the reading, maybe before its last page: what came
            // of it is neither shown nor kept
            if (mine !== asked) {
                return;
            }
            const rows = all.filter((row) => !left.has(signature(kind.id, row)));
            const list = { rows, readAt: new Date() };
            if (before === changed) {
                lists.set(kind.id, list);
            }
            showList(kind, list, said);
        } catch (ex) {
            if (mine === asked) {
                fail(ex, ...said);
            }
        }
    }

    /**
     * Builds the panel once.
     */
    function build() {
        dialog = make('dialog', 'panel');
        const head = make('header', 'head');
        const close = make('button', 'close', '×');
        close.type = 'button';
        close.title = 'Close';
        close.addEventListener('click', () => dialog.close());
        // on every screen of the panel: who added it
        const madeBy = make('span', 'made-by');
        madeBy.append(icon('added this panel, which lists the transactional messages.'), MADE_BY);
        head.append(make('h2', undefined, TITLE), madeBy, close);
        tabs = make('div', 'tabs');
        tabs.setAttribute('role', 'tablist');
        for (const kind of KINDS) {
            const tab = make('button', 'tab', kind.title);
            tab.type = 'button';
            tab.dataset.kind = kind.id;
            tab.setAttribute('role', 'tab');
            tab.addEventListener('click', () => openList(kind));
            tabs.append(tab);
        }
        note = make('p', 'note');
        body = make('div', 'body');
        dialog.append(head, tabs, note, body);
        // a late answer must not fill a panel that was closed
        dialog.addEventListener('close', () => {
            asked++;
            // the apps of Mobile Studio list the messages that belong to these
            announceDeletes();
        });
        // Escape does not close the panel: only its × does. What Escape closes inside it, a list
        // or a box of the code editor, takes the key first and keeps it from coming here. Kept
        // on the window, because the key comes from the body when nothing in the panel has the
        // focus, and Chrome closes the dialog all the same
        addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && dialog.open) {
                event.preventDefault();
            }
        });
        dialog.addEventListener('cancel', (event) => event.preventDefault());
        document.body.append(dialog);
    }

    /**
     * Opens the panel on its first tab.
     */
    function open() {
        if (!dialog) {
            build();
        }
        if (!dialog.open) {
            dialog.showModal();
        }
        openList(KINDS[0]);
    }

    /**
     * Opens the panel on the details of one message, without reading a list first.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {string} key key of the definition
     */
    function openOn(kind, key) {
        if (!dialog) {
            build();
        }
        if (!dialog.open) {
            dialog.showModal();
        }
        select(kind);
        openDetails(kind, key);
    }

    /**
     * Sends a message to the extension, for the frames below this page. It never throws.
     *
     * @param {object} message what to send
     */
    async function tell(message) {
        try {
            await chrome.runtime.sendMessage(message);
        } catch {
            // the extension was updated or switched off: nobody is told
        }
    }

    /**
     * Reads one page of the journeys of the business unit, in all their versions, and of each
     * version the push messages its activities name. The business unit is read along with it,
     * because the frame that asks may be logged in to another one. It never throws.
     *
     * @param {number} page which page, from 1
     * @returns {Promise.<{isOk: boolean, count?: number, pageSize?: number, singleSends?: number, mid?: string, origin?: string, journeys?: object[]}>} the page, with how many versions of journeys that send once the business unit has; not ok when anything of it could not be read or had another shape than expected
     */
    async function readJourneys(page) {
        try {
            // none of it from the browser's cache: a message is deleted on the strength of it
            const [answer, singles, context] = await Promise.all([
                ask(
                    `${JOURNEY_LIST}?$page=${page}&$pageSize=${JOURNEY_PAGE}&extras=activities&${ALL_VERSIONS}`,
                    'GET',
                    undefined,
                    true,
                ),
                ask(
                    `${JOURNEY_LIST}?$page=1&$pageSize=1&definitionType=${SINGLE_SEND}&${ALL_VERSIONS}`,
                    'GET',
                    undefined,
                    true,
                ),
                ask('platform/v1/tokenContext', 'GET', undefined, true),
            ]);
            const mid = context.organization?.id;
            if (
                !Number.isSafeInteger(mid) ||
                !Number.isSafeInteger(answer.count) ||
                answer.count < 0 ||
                !Number.isSafeInteger(singles.count) ||
                singles.count < 0 ||
                answer.page !== page ||
                answer.pageSize !== JOURNEY_PAGE ||
                !Array.isArray(answer.items)
            ) {
                return { isOk: false };
            }
            const journeys = [];
            for (const item of answer.items) {
                if (
                    typeof item?.id !== 'string' ||
                    typeof item.name !== 'string' ||
                    typeof item.definitionType !== 'string' ||
                    !Number.isSafeInteger(item.version) ||
                    !Array.isArray(item.activities)
                ) {
                    return { isOk: false };
                }
                const pushIds = [];
                // of every activity, whatever its type: a type nobody has seen yet counts too
                for (const activity of item.activities) {
                    const id = activity?.configurationArguments?.pushMessageId;
                    if ([undefined, null, ''].includes(id)) {
                        continue;
                    }
                    // an id in a shape nobody has seen cannot be held against a message
                    if (typeof id !== 'number' && typeof id !== 'string') {
                        return { isOk: false };
                    }
                    pushIds.push(String(id));
                }
                // the same for the SMS message an activity names
                const smsIds = [];
                for (const activity of item.activities) {
                    const id = activity?.configurationArguments?.messageId;
                    if ([undefined, null, ''].includes(id)) {
                        continue;
                    }
                    if (typeof id !== 'number' && typeof id !== 'string') {
                        return { isOk: false };
                    }
                    smsIds.push(String(id));
                }
                journeys.push({
                    id: item.id,
                    name: item.name,
                    type: item.definitionType,
                    version: item.version,
                    status: typeof item.status === 'string' ? item.status : '',
                    pushIds,
                    smsIds,
                });
            }
            return {
                isOk: true,
                count: answer.count,
                pageSize: answer.pageSize,
                singleSends: singles.count,
                mid: String(mid),
                origin: location.origin,
                journeys,
            };
        } catch {
            return { isOk: false };
        }
    }

    // what MobilePush's frame asks for; the extension passes on what has the expected form only
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // passed on by the extension itself, not sent by the script of a page
        if (sender.id !== chrome.runtime.id || sender.tab) {
            return false;
        }
        if (message?.type === PANEL_OPEN) {
            const kind = KINDS.find((item) => item.id === message.kind);
            if (kind && typeof message.key === 'string') {
                openOn(kind, message.key);
            }
            return false;
        }
        if (message?.type === JOURNEYS && Number.isSafeInteger(message.page)) {
            (async () => {
                sendResponse(await readJourneys(message.page));
            })();
            // the answer follows once the page was read
            return true;
        }
        return false;
    });

    /**
     * Adds the entry to the Mobile Studio menu, unless it is there.
     */
    function addEntry() {
        const list = document.querySelector(MOBILE_APPS)?.closest('ul');
        if (!list || list.querySelector(`[${CSS.escape(MARK)}]`)) {
            return;
        }
        // a menu that was drawn again may be the one of another business unit
        forget();
        // built like the entries of the menu, to look like them
        const item = make('li');
        item.className = 'mc-app-group-dropdown-app';
        item.setAttribute(MARK, '');
        const link = make('a');
        // the page finds its apps by the address after "#"; this entry must not be taken for one
        link.href = '#';
        link.title = TITLE;
        const group = make('span', undefined, 'Mobile Studio: ');
        group.className = 'sr-only';
        const name = make('span', undefined, TITLE);
        name.className = 'mc-app-name';
        link.append(
            group,
            name,
            ' ',
            icon(
                'added this menu entry, which opens the extension’s panel of transactional messages.',
            ),
        );
        link.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            open();
        });
        item.append(link);
        list.append(item);
    }

    // the menu is drawn after the page has loaded, and drawn again when the business unit changes
    const menu = new MutationObserver(addEntry);
    addEntry();
    menu.observe(document.documentElement, { childList: true, subtree: true });
})();
