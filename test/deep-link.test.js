import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const shellScript = read('../src/deep-link-shell.js');
const frameScript = read('../src/deep-link-content-builder.js');
const backgroundScript = read('../src/background.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// lets what was started settle, also what a timer of the page started
const settle = async () => {
    await tick();
    await tick();
};
const WANTED = 'sfmc-ux-tools:deep-link:wanted';
const SHOWN = 'sfmc-ux-tools:deep-link:shown';
const EXTENSION = 'this-extension';
const ORIGIN = 'https://mc.s7.exacttarget.com';
const SHELL = `${ORIGIN}/cloud/`;
const APP = '#app/Content%20Builder/';
// the business unit the user is in, another one of the same account, and one of no account
const MID = '500';
const OTHER = '600';
const NOWHERE = '999';
// the route of an asset of the business unit the user is in
const MARKER = `${APP}ux-tools/${MID}/asset/`;
/**
 * Writes the route of an asset.
 *
 * @param {string} mid id of its business unit
 * @param {string} asset its id
 * @returns {string} the route
 */
const link = (mid, asset) => `${APP}ux-tools/${mid}/asset/${asset}`;
const NOTICE = '[data-sfmc-ux-tools-deep-link="notice"]';
// what the frame script waits before it looks at a changed page, and for the row of a link
const LOOK_DELAY = 250;
const ROW_WAIT = 60_000;
const SEARCH_BOX = '<input placeholder="Search">';
// where the shell script reads the business units, how many at once and in how many pages at most
const ACCOUNTS = '/cloud/fuelapi/platform-internal/v1/accounts';
const PAGE_SIZE = 50;
const MOST_PAGES = 20;
// how long the shell script waits to learn the business unit the user is in
const CURRENT_WAIT = 10_000;
// the business unit as the header of the Marketing Cloud page shows it
const HEADER =
    '<div class="mc-account-switcher-current-account-details">MID: 500 <span class="mc-account-switcher-current-account-name">Northwind Germany</span></div>';
// where the business units this browser has seen are kept
const MEMORY_KEY = 'deepLinkBusinessUnits';
// where a link is kept in the tab's session storage while the business unit is switched
const CARRIED = 'sfmcUxToolsDeepLink';
// where the business unit that was read last is kept in the page's local storage, and the pass
// for one link into Contact Builder in the tab's session storage
const LAST_UNIT = 'sfmcUxToolsBusinessUnit';
const PASS = 'sfmcUxToolsDeepLinkPass';
// the page that switches the business unit, and the plain addresses of the two apps, which are
// all it is ever sent on to
const SWITCH = `${ORIGIN}/cloud/context-switch.html`;
const PLAIN_CONTENT_BUILDER = `${SHELL}#app/Content%20Builder/`;
const PLAIN_EMAIL = `${SHELL}#app/Email`;
/**
 * Writes the address that switches to the other business unit and then opens an app.
 *
 * @param {string} app the plain address of the app
 * @returns {string} the address
 */
const switchTo = (app) => `${SWITCH}?m=${OTHER}&h=${encodeURIComponent(app)}`;
/**
 * Writes an address in base64, as it stands in the query of the Marketing Cloud page.
 *
 * @param {string} text the address
 * @returns {string} its base64 form, percent-encoded
 */
const encode = (text) => encodeURIComponent(Buffer.from(text, 'latin1').toString('base64'));
/**
 * Writes the query with which Marketing Cloud loads its page to open an address by itself.
 *
 * @param {string} hash the address to open, from the #
 * @returns {string} the query, from the ?
 */
const handed = (hash) => `?hash=logged-in${encode(hash)}`;
// the two messages of Email Studio's frame, its route on the Marketing Cloud page with and
// without a view of the business unit the user is in, and that view as a link names it
const EMAIL_WANTED = 'sfmc-ux-tools:deep-link:email-wanted';
const EMAIL_SHOWN = 'sfmc-ux-tools:deep-link:email-shown';
const EMAIL = '#app/Email/C12/Default.aspx?entityType=none&entityID=0&ks=ks';
const VIEW = 'r.Subscribers.customobject.0a1b2c3d-0000-4000-8000-00000000abcd';
const FOLDER = 'r.Subscribers.CustomObjects.4711';
/**
 * Writes the route of a view of Email Studio.
 *
 * @param {string} mid id of its business unit
 * @param {string} target the view
 * @param {string} [inner] the route inside Email Studio
 * @returns {string} the route
 */
const emailLink = (mid, target, inner = 'Subscribers') =>
    `${EMAIL}&ux-tools=${mid}.${target}%23${inner}`;
/**
 * Writes Email Studio's route with whatever stands in the field of a view.
 *
 * @param {string} value what the field holds
 * @returns {string} the route
 */
const field = (value) => `${EMAIL}&ux-tools=${value}%23Subscribers`;
/**
 * Builds a business unit as the API lists it.
 *
 * @param {number} accountId its id
 * @param {string} name its name
 * @param {number|null} parentId id of the business unit above it; null for the enterprise
 * @param {boolean} [hasAccess] whether the user may open it
 * @returns {object} the business unit
 */
const unit = (accountId, name, parentId, hasAccess = true) => ({
    accountId,
    name,
    accountType: parentId === null ? 'ENTERPRISE_2' : 'BUSINESS_UNIT',
    hasAccess,
    parentId,
});
// a made-up account
const UNITS = [
    unit(100, 'Northwind', null),
    unit(500, 'Northwind Germany', 100),
    unit(600, 'Northwind France', 100),
    unit(700, 'Northwind Spain', 100, false),
];
// what is kept of that account
const REMEMBERED = {
    100: {
        name: 'Northwind',
        units: {
            100: 'Northwind',
            500: 'Northwind Germany',
            600: 'Northwind France',
            700: 'Northwind Spain',
        },
    },
};

/**
 * Builds a row of Content Builder's list.
 *
 * @param {string} id id of the asset
 * @returns {string} the row
 */
const row = (id) =>
    `<tr data-flow-id="cb:repeater:list:${id}"><td class="contentitem-table-name">asset ${id}</td></tr>`;
/**
 * Builds Content Builder's list.
 *
 * @param {...string} ids ids of its assets
 * @returns {string} the list
 */
const list = (...ids) => `<table><tbody>${ids.map((id) => row(id)).join('')}</tbody></table>`;
// the page of the open asset 123
const DETAILS =
    '<div class="contentproperties-detailsview"><div data-content-field="id"><input class="contentinput-copyvalue" value="123"></div></div>';
// how Chrome describes the background script when it passes a message on
const BACKGROUND = { id: EXTENSION };

/**
 * Runs the shell script on the Marketing Cloud page.
 *
 * @param {string} [hash] the route the page is loaded with
 * @param {object} [has] what the account and the browser hold; the test may change it later
 * @param {object[]} [has.units] the business units of the account, as the API lists them
 * @param {string|null} [has.current] id of the business unit the user is in; null when it cannot be read
 * @param {boolean} [has.isListDown] true when the list of business units cannot be read
 * @param {boolean} [has.isDown] true when nothing can be read
 * @param {object} [has.memory] the business units this browser has seen
 * @param {boolean} [has.isStorageDown] true when the extension's storage cannot be used
 * @param {boolean} [has.isCurrentHanging] true when the question for the user's business unit is never answered
 * @param {string} [has.header] what the page holds when the script starts
 * @param {boolean} [has.isBodyLate] true when the page has no body yet when the script starts
 * @param {string} [has.path] path of the page, when it is not the Marketing Cloud page itself
 * @param {string} [has.carried] the link that the tab's session storage holds when the script starts
 * @param {string} [has.search] the query the page is loaded with, from the ?
 * @param {string} [has.remembered] what the page's local storage holds as the business unit that was read last
 * @param {string} [has.pass] the pass that the tab's session storage holds when the script starts
 * @param {boolean} [has.hasNavigation] true for a browser that tells a step through its history before the address changes
 * @returns {object} the page, a way to send the script a message as the background script does, what it asked, kept and showed, and the script's functions
 */
function shell(hash = '', has = {}) {
    const account = { units: UNITS, current: MID, ...has };
    const { window } = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        url: `${ORIGIN}${account.path ?? '/cloud/'}${account.search ?? '?x=1'}${hash}`,
    });
    if (account.carried !== undefined) {
        window.sessionStorage.setItem(CARRIED, account.carried);
    }
    if (account.remembered !== undefined) {
        window.localStorage.setItem(LAST_UNIT, account.remembered);
    }
    if (account.pass !== undefined) {
        window.sessionStorage.setItem(PASS, account.pass);
    }
    if (account.header) {
        window.document.body.innerHTML = account.header;
    }
    if (account.isBodyLate) {
        window.document.body.remove();
    }
    // the script's waits are run by the test; what it only puts off is left to the page
    let now = 0;
    let lastTimer = 0;
    const timers = new Map();
    const later = window.setTimeout.bind(window);
    const never = window.clearTimeout.bind(window);
    window.setTimeout = (act, delay = 0) => {
        if (delay === 0) {
            return later(act, 0);
        }
        timers.set(--lastTimer, { at: now + delay, act });
        return lastTimer;
    };
    window.clearTimeout = (id) => {
        if (!timers.delete(id)) {
            never(id);
        }
    };
    // jsdom has the element but not the two methods the dialog uses
    window.eval(`
        HTMLDialogElement.prototype.showModal = function () {
            this.setAttribute('open', '');
        };
        HTMLDialogElement.prototype.close = function () {
            this.removeAttribute('open');
            this.dispatchEvent(new Event('close'));
        };
    `);
    const listeners = [];
    const store = account.memory === undefined ? {} : { [MEMORY_KEY]: account.memory };
    const sets = [];
    // what the script listens for on the page, so that a test can click or type as a person
    // does: the page of a test cannot make up an event that the browser trusts
    const heard = [];
    const listen = window.addEventListener.bind(window);
    window.addEventListener = (type, act, options) => {
        heard.push({ type, act });
        listen(type, act, options);
    };
    // what the script wants to be told about the browser's navigation, if the browser tells
    const navigations = [];
    if (account.hasNavigation) {
        window.navigation = {
            addEventListener: (type, act) => {
                assert.equal(type, 'navigate');
                navigations.push(act);
            },
        };
    }
    // each address the script writes, and whether it added an entry to the history for it
    const writes = [];
    for (const [name, how] of [
        ['pushState', 'push'],
        ['replaceState', 'replace'],
    ]) {
        const act = window.history[name].bind(window.history);
        window.history[name] = (state, title, to) => {
            writes.push(`${how} ${to}`);
            act(state, title, to);
        };
    }
    // what the script asked of the frames below the page
    const asked = [];
    window.chrome = {
        runtime: {
            id: EXTENSION,
            getURL: (path) => `chrome-extension://id/${path}`,
            sendMessage: async (message) => {
                asked.push(structuredClone(message));
            },
            onMessage: {
                addListener: (item) => {
                    listeners.push(item);
                },
            },
        },
        storage: {
            local: {
                get: async (key) => {
                    if (account.isStorageDown) {
                        throw new Error('Extension context invalidated.');
                    }
                    return structuredClone({ [key]: store[key] });
                },
                set: async (values) => {
                    if (account.isStorageDown) {
                        throw new Error('Extension context invalidated.');
                    }
                    sets.push(structuredClone(values));
                    Object.assign(store, structuredClone(values));
                },
            },
        },
    };
    const calls = [];
    window.fetch = async (address, options) => {
        calls.push(`${options.method} ${address}`);
        assert.equal(address.startsWith(ACCOUNTS), true, address);
        if (account.isCurrentHanging && address.endsWith('/@current')) {
            return new Promise(() => {});
        }
        const path = address.slice(ACCOUNTS.length);
        let status = 200;
        let body;
        if (account.isDown) {
            status = 500;
        } else if (path.startsWith('?')) {
            const page = Number(
                /^\?\$page=(\d+)&\$pageSize=50&includeParentDetails=true$/.exec(path)[1],
            );
            const items = account.units.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
            body = { count: account.units.length, page, pageSize: PAGE_SIZE, items };
            status = account.isListDown ? 500 : 200;
        } else {
            const mid = path === '/@current' ? account.current : path.slice(1);
            body = account.units.find((item) => String(item.accountId) === mid);
            if (!body) {
                status = 400;
                body = { message: 'Bad Request', errorcode: 0, documentation: '' };
            }
        }
        return { ok: status === 200, status, json: async () => body };
    };
    window.eval(shellScript);
    assert.equal(listeners.length, 1);
    const went = [];
    window.sfmcUxToolsDeepLink.go = (to) => {
        went.push(to);
    };
    let reloads = 0;
    window.sfmcUxToolsDeepLink.reload = () => {
        reloads++;
    };
    const dialog = () => window.document.querySelector('dialog');
    return {
        window,
        account,
        calls,
        store,
        sets,
        went,
        writes,
        asked,
        // the addresses that got an entry of their own in the history
        pushes: () =>
            writes.filter((item) => item.startsWith('push ')).map((item) => item.slice(5)),
        /**
         * Clicks or types on the page, as a person does.
         *
         * @param {string} type pointerdown or keydown
         */
        input: (type) => {
            for (const item of heard) {
                if (item.type === type) {
                    item.act({ type, isTrusted: true });
                }
            }
        },
        /**
         * Tells the script of a navigation, as the browser does before the address changes.
         *
         * @param {string} navigationType how the browser names it
         * @param {unknown} [isHashChange] what the browser says about whether only the part of the address from the # changes
         */
        navigate: (navigationType, isHashChange = false) => {
            for (const act of navigations) {
                act({ navigationType, hashChange: isHashChange });
            }
        },
        /**
         * Steps through the history to an entry with another route, as Back and Forward do.
         *
         * @param {string} to the route of that entry
         */
        step: async (to) => {
            for (const act of navigations) {
                act({ navigationType: 'traverse', hashChange: true });
            }
            window.location.hash = to;
            await settle();
        },
        // how often the script loaded the page again
        reloads: () => reloads,
        // the business unit that the page's local storage holds, and the pass of the tab
        remembered: () => window.localStorage.getItem(LAST_UNIT),
        pass: () => window.sessionStorage.getItem(PASS),
        dialog,
        hash: () => window.location.hash,
        // the link that the tab's session storage holds
        kept: () => window.sessionStorage.getItem(CARRIED),
        // what the dialog says, and its buttons
        said: () => [...dialog().querySelectorAll('p')].map((item) => item.textContent),
        buttons: () => [...dialog().querySelectorAll('button')].map((item) => item.textContent),
        /**
         * Clicks a button of the dialog.
         *
         * @param {string} text what the button says
         */
        click: (text) => {
            [...dialog().querySelectorAll('button')]
                .find((item) => item.textContent === text)
                .click();
        },
        // how often the business unit the user is in was read
        currentReads: () => calls.filter((call) => call.endsWith('/@current')).length,
        // how many pages of the list of business units were read
        listReads: () => calls.filter((call) => !call.endsWith('/@current')).length,
        /**
         * Lets time pass for the script's waits.
         *
         * @param {number} delay milliseconds
         */
        elapse: async (delay) => {
            await settle();
            now += delay;
            for (const [id, timer] of timers) {
                if (!(timer.at <= now)) {
                    continue;
                }

                timers.delete(id);
                timer.act();
            }
            await settle();
        },
        // how many of the script's waits are still under way
        waits: () => timers.size,
        /**
         * Sends the script a message and lets what it starts settle.
         *
         * @param {object} message the message
         * @param {object} [sender] who sent it; the background script unless said otherwise
         * @returns {Promise.<object|undefined>} a copy of the answer; nothing when there was none
         */
        send: async (message, sender = BACKGROUND) => {
            let answer;
            const { promise, resolve } = Promise.withResolvers();
            const willAnswer = listeners[0](message, sender, (given) => {
                answer = structuredClone(given);
                resolve();
            });
            if (willAnswer) {
                await promise;
            }
            await settle();
            return answer;
        },
        /**
         * Changes the route as the page itself does.
         *
         * @param {string} to the new route
         */
        route: async (to) => {
            window.location.hash = to;
            await settle();
        },
        helpers: window.sfmcUxToolsDeepLink,
    };
}

/**
 * Runs the frame script in a document of Content Builder.
 *
 * @param {object} [has] what the document and the account hold
 * @param {string} [has.html] content of the document
 * @param {string|null} [has.wanted] the asset the page around the frame was asked for
 * @param {Object.<string, object>} [has.assets] what the API answers by the id of an asset: {status, body}, and with until a promise that the answer waits for
 * @param {string} [has.depth] top for no page around it, nested for a frame inside Content Builder's
 * @returns {object} the document, what was sent, asked, searched and clicked, and a way to let time pass
 */
function frame({ html = '', wanted = null, assets = {}, depth = 'frame' } = {}) {
    const { window: top } = new JSDOM('<!doctype html><body><iframe></iframe></body>', {
        runScripts: 'outside-only',
        url: SHELL,
    });
    let view = depth === 'top' ? top : top.document.querySelector('iframe').contentWindow;
    if (depth === 'nested') {
        view.document.body.append(view.document.createElement('iframe'));
        view = view.document.querySelector('iframe').contentWindow;
    }
    const { document } = view;
    document.body.innerHTML = html;
    // the script's timers, run by the test
    let now = 0;
    let lastTimer = 0;
    const timers = new Map();
    view.setTimeout = (act, delay) => {
        timers.set(++lastTimer, { at: now + delay, act });
        return lastTimer;
    };
    view.clearTimeout = (id) => {
        timers.delete(id);
    };
    const sent = [];
    const listeners = [];
    view.chrome = {
        runtime: {
            id: EXTENSION,
            sendMessage: async (message) => {
                sent.push({ ...message });
                return message.type === WANTED ? { asset: wanted } : {};
            },
            onMessage: {
                addListener: (item) => {
                    listeners.push(item);
                },
            },
        },
    };
    // what the script listens for in the frame, so that a test can click or type as a person
    // does: the page of a test cannot make up an event that the browser trusts
    const heard = [];
    const listen = view.addEventListener.bind(view);
    view.addEventListener = (type, act, options) => {
        heard.push({ type, act });
        listen(type, act, options);
    };
    const calls = [];
    view.fetch = async (address, options) => {
        calls.push(`${options.method} ${address}`);
        const id = /assets\/([^?]+)/.exec(address)[1];
        const { status = 200, body, isDown, until } = assets[id] ?? { status: 404 };
        await until;
        if (isDown) {
            throw new TypeError('Failed to fetch');
        }
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => {
                if (body === undefined) {
                    throw new SyntaxError('no JSON');
                }
                return body;
            },
        };
    };
    const clicked = [];
    const searched = [];
    document.addEventListener('click', (event) => {
        const name = event.target.closest('.contentitem-table-name');
        clicked.push(name ? name.closest('tr').dataset.flowId : event.target.tagName);
    });
    for (const type of ['input', 'change', 'keydown', 'keypress', 'keyup']) {
        document.addEventListener(type, (event) => {
            // eslint-disable-next-line unicorn/prefer-keyboard-event-key -- the search box was seen to take Enter by its key code, so the test must see that one too
            const code = event.key ? ` ${event.key} ${event.keyCode}` : '';
            searched.push(`${type} ${event.target.value}${code}`);
        });
    }
    view.eval(frameScript);
    return {
        document,
        sent,
        calls,
        clicked,
        searched,
        /**
         * Lets the page settle and the given time pass.
         *
         * @param {number} [delay] milliseconds
         */
        pass: async (delay = LOOK_DELAY) => {
            await tick();
            now += delay;
            for (const [id, timer] of timers) {
                if (!(timer.at <= now)) {
                    continue;
                }

                timers.delete(id);
                timer.act();
            }
            await tick();
        },
        shown: () => sent.filter((message) => message.type === SHOWN).map((item) => item.asset),
        // what was told, whole: with what says that the user caused it, when it was said
        told: () => sent.filter((message) => message.type === SHOWN),
        /**
         * Clicks or types in the frame, as a person does.
         *
         * @param {string} type pointerdown or keydown
         */
        input: (type) => {
            for (const item of heard) {
                if (item.type === type) {
                    item.act({ type, isTrusted: true });
                }
            }
        },
        /**
         * Sends the script a message, as the background script does unless said otherwise.
         *
         * @param {object} message the message
         * @param {object} [sender] who sent it
         * @returns {boolean[]} what each of the script's listeners returned
         */
        receive: (message, sender = BACKGROUND) =>
            listeners.map((item) => item(message, sender, () => {})),
        asked: () => sent.filter((message) => message.type === WANTED).length,
        notice: () => document.querySelector(NOTICE),
    };
}

/**
 * Runs the background script with a stand-in for the extension API.
 *
 * @param {(message: object) => object} [page] what the page of the tab answers; it throws when there is none
 * @returns {{send: (message: object, sender: object) => Promise.<object> | false, passed: object[]}} a way to send it a message, which gives the answer or false if none will come, and what it passed on
 */
function background(page = () => ({})) {
    const listeners = [];
    const passed = [];
    const chrome = {
        runtime: {
            id: EXTENSION,
            onMessage: {
                addListener: (item) => {
                    listeners.push(item);
                },
            },
        },
        tabs: {
            sendMessage: async (tabId, message, options) => {
                passed.push(structuredClone({ tabId, message, options }));
                return page(message);
            },
        },
    };
    vm.runInNewContext(backgroundScript, { chrome, URL });
    const send = (message, sender) => {
        const { promise, resolve } = Promise.withResolvers();
        const willAnswer = listeners[0](message, sender, (answer) =>
            resolve(answer === undefined ? undefined : structuredClone(answer)),
        );
        return willAnswer === true && promise;
    };
    return { send, passed };
}

/**
 * Copies what the page's script returned, so that it can be compared with what a test writes.
 *
 * @param {object|null|undefined} value what the script returned
 * @returns {object|null|undefined} the copy
 */
const plain = (value) => (value ? structuredClone(value) : value);

test('an address names an asset only as two ids of digits after Content Builder’s own route', () => {
    const { parse, isContentBuilderHash } = shell().helpers;
    assert.deepEqual(plain(parse(`${MARKER}123`)), { mid: MID, asset: '123' });
    assert.deepEqual(plain(parse(`${MARKER}123/`)), { mid: MID, asset: '123' });
    assert.deepEqual(plain(parse('#app/Content Builder/ux-tools/7/asset/123')), {
        mid: '7',
        asset: '123',
    });
    const longest = link('123456789012345', '123456789012345');
    assert.deepEqual(plain(parse(longest)), {
        mid: '123456789012345',
        asset: '123456789012345',
    });
    for (const hash of [
        '',
        APP,
        MARKER,
        // the format without a business unit, which was never released, and the first name of
        // the marker
        `${APP}ux-tools/asset/123`,
        `${APP}sfmcux/asset/123`,
        `${APP}sfmcux/${MID}/asset/123`,
        // too long, and not digits only
        `${MARKER}1234567890123456`,
        link('1234567890123456', '123'),
        `${MARKER}12a`,
        link('5a', '123'),
        link('', '123'),
        link('-5', '123'),
        link('5.0', '123'),
        link('%35', '123'),
        link('5/6', '123'),
        link('..', '123'),
        `${MARKER}-1`,
        `${MARKER}1.5`,
        `${MARKER}1e3`,
        `${MARKER}12?x=1`,
        `${MARKER}12/edit`,
        `${MARKER}12#${MARKER}13`,
        `${MARKER}<img src=x onerror=alert(1)>`,
        link('<img src=x onerror=alert(1)>', '123'),
        `${MARKER}%31`,
        ` ${MARKER}12`,
        `${MARKER}12\n`,
        // another app, and another route of Content Builder
        `#app/Email/ux-tools/${MID}/asset/123`,
        `#app/Content%20Builder%20Two/ux-tools/${MID}/asset/123`,
        `#app/Content%20Builder/other/${MID}/asset/123`,
        `app/Content%20Builder/ux-tools/${MID}/asset/123`,
        undefined,
        null,
        123,
    ]) {
        assert.equal(parse(hash), null, String(hash));
    }

    for (const hash of [
        '#app/Content%20Builder',
        APP,
        '#app/Content Builder/',
        `${MARKER}123`,
        `${APP}anything/else`,
    ]) {
        assert.equal(isContentBuilderHash(hash), true, hash);
    }
    for (const hash of [
        '',
        '#',
        '#app/Email/',
        '#app/Content%20BuilderX/',
        '#app/Content%20Builder%20Two/',
        '#app/Journey%20Builder/#app/Content%20Builder/',
        '#home',
        undefined,
        null,
    ]) {
        assert.equal(isContentBuilderHash(hash), false, String(hash));
    }
});

test('the address of an asset keeps the path and the query, and takes nothing but digits', () => {
    const { address, switchAddress } = shell().helpers;
    assert.equal(address('/cloud/', '', MID, '123'), `/cloud/${MARKER}123`);
    assert.equal(address('/cloud/', '?x=1', MID, '123'), `/cloud/?x=1${MARKER}123`);
    assert.equal(address('/cloud/', '?x=1', MID, null), `/cloud/?x=1${APP}`);
    for (const id of [undefined, '', 'abc', '12/../x', '1234567890123456', 123, {}, ['1']]) {
        assert.equal(address('/cloud/', '', MID, id), `/cloud/${APP}`, String(id));
        // an asset without its business unit is no link
        assert.equal(address('/cloud/', '', id, '123'), `/cloud/${APP}`, String(id));
        assert.equal(switchAddress(ORIGIN, id, '123'), undefined);
        assert.equal(switchAddress(ORIGIN, MID, id), undefined);
    }
    // to Content Builder itself, without the asset
    assert.equal(
        switchAddress(ORIGIN, OTHER, '123'),
        'https://mc.s7.exacttarget.com/cloud/context-switch.html?m=600&h=https%3A%2F%2Fmc.s7.exacttarget.com%2Fcloud%2F%23app%2FContent%2520Builder%2F',
    );
});

test('the page hands the asset of a link of this business unit to Content Builder once', async () => {
    const at = shell(`${MARKER}123`);
    // only the extension's background script is answered
    assert.equal(await at.send({ type: WANTED }, { id: 'another-extension' }), undefined);
    assert.equal(await at.send({ type: WANTED }, { id: EXTENSION, tab: { id: 7 } }), undefined);
    assert.equal(await at.send({ type: 'something else' }), undefined);
    // read once for the load of the page and once for the early decision, and anew when
    // Content Builder asks
    assert.equal(at.currentReads(), 2);
    assert.deepEqual(await at.send({ type: WANTED }), { asset: '123' });
    assert.equal(at.currentReads(), 3);
    assert.equal(at.waits(), 0);
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    // asking changes nothing in the address, and no dialog is shown
    assert.equal(at.hash(), `${MARKER}123`);
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.went, []);

    assert.deepEqual(await shell(APP).send({ type: WANTED }), { asset: null });
    for (const hash of [
        `#app/Email/ux-tools/${MID}/asset/123`,
        `${MARKER}12a`,
        `${APP}ux-tools/asset/123`,
    ]) {
        const other = shell(hash);
        assert.deepEqual(await other.send({ type: WANTED }), { asset: null });
        assert.equal(other.dialog(), null);
    }
});

test('a link of another business unit is not followed: a dialog names both and offers to switch', async () => {
    const at = shell(link(OTHER, '123'));
    // the API alone tells the business unit: the header is not there
    await settle();
    // before Content Builder asked anything
    assert.equal(at.dialog().hasAttribute('open'), true);
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.equal(at.window.document.querySelectorAll('dialog').length, 1);
    assert.equal(
        at.dialog().querySelector('img').title,
        'SFMC UX Tools: added this dialog, which asks before a link to another business unit is opened.',
    );
    assert.deepEqual(at.said(), [
        'This link belongs to the business unit Northwind France (600). You are in Northwind Germany (500).',
    ]);
    assert.deepEqual(at.buttons(), ['Switch and open', 'Stay here']);
    assert.equal(at.calls.includes(`GET ${ACCOUNTS}/${OTHER}`), true);
    // nothing switches without the click
    assert.deepEqual(at.went, []);
    at.click('Stay here');
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.went, []);
    // the link was used up
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.equal(at.dialog(), null);

    const again = shell(link(OTHER, '123'));
    await again.send({ type: WANTED });
    again.click('Switch and open');
    assert.deepEqual(again.went, [switchTo(PLAIN_CONTENT_BUILDER)]);
    assert.equal(again.dialog(), null);
    // only GET requests, all to the business units of the account
    for (const call of [...at.calls, ...again.calls]) {
        assert.equal(call.startsWith(`GET ${ACCOUNTS}`), true, call);
    }

    // a name is text, whatever it holds
    const odd = shell(link(OTHER, '123'), {
        units: [
            unit(100, 'Northwind', null),
            unit(500, '<b>here</b>', 100),
            unit(600, '<img src=x>', 100),
        ],
    });
    await odd.send({ type: WANTED });
    assert.deepEqual(odd.said(), [
        'This link belongs to the business unit <img src=x> (600). You are in <b>here</b> (500).',
    ]);
    assert.equal(odd.dialog().querySelectorAll('img, b').length, 1);

    // the list could not be read: the business unit itself answered, which is enough
    const listless = shell(link(OTHER, '123'), { isListDown: true });
    await listless.send({ type: WANTED });
    assert.deepEqual(listless.buttons(), ['Switch and open', 'Stay here']);
});

test('a link of a business unit that the account does not have, or that the user may not open, says so', async () => {
    const TEXT =
        'The business unit 999 of this link does not exist in the Marketing Cloud account you are logged in to (Northwind), or you have no access to it.';
    // never seen
    const at = shell(link(NOWHERE, '123'));
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.deepEqual(at.said(), [TEXT]);
    assert.deepEqual(at.buttons(), ['Close']);
    at.click('Close');
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.went, []);

    // seen before, in another account
    const memory = { 900: { name: 'Contoso', units: { 900: 'Contoso', 999: 'Contoso Italy' } } };
    const known = shell(link(NOWHERE, '123'), { memory });
    await known.send({ type: WANTED });
    assert.deepEqual(known.said(), [
        TEXT,
        'This browser has seen it before: Contoso Italy in Contoso.',
    ]);
    assert.deepEqual(known.buttons(), ['Close']);
    // an account whose name was never read
    const nameless = shell(link(NOWHERE, '123'), {
        memory: { 900: { name: '', units: { 999: 'Contoso Italy' } } },
    });
    await nameless.send({ type: WANTED });
    assert.equal(
        nameless.said()[1],
        'This browser has seen it before: Contoso Italy in the account 900.',
    );
    // a memory that cannot be read, or holds something else, does not fail the dialog
    for (const has of [
        { isStorageDown: true },
        { memory: 'broken' },
        { memory: { 900: null, 901: { units: 7 }, 902: { units: { 999: 7 } } } },
    ]) {
        const broken = shell(link(NOWHERE, '123'), has);
        assert.deepEqual(await broken.send({ type: WANTED }), { asset: null });
        assert.deepEqual(broken.said(), [TEXT], JSON.stringify(has));
    }

    // a business unit of this account that the user may not open: no offer to switch
    const closed = shell(link('700', '123'));
    await closed.send({ type: WANTED });
    assert.deepEqual(closed.said(), [
        'The business unit 700 of this link does not exist in the Marketing Cloud account you are logged in to (Northwind), or you have no access to it.',
    ]);
    assert.deepEqual(closed.buttons(), ['Close']);

    // the list could not be read now: the account is named as it was kept before
    const listless = shell(link(NOWHERE, '123'), { isListDown: true, memory: REMEMBERED });
    await listless.send({ type: WANTED });
    assert.deepEqual(listless.said(), [TEXT]);
});

test('when the business unit of the user cannot be read, no link is followed and none is written', async () => {
    // nothing can be read at all
    const down = shell(`${MARKER}123`, { isDown: true });
    await down.elapse(CURRENT_WAIT);
    assert.deepEqual(await down.send({ type: WANTED }), { asset: null });
    assert.deepEqual(down.said(), [
        'The business unit 500 of this link does not exist in the Marketing Cloud account you are logged in to, or you have no access to it.',
    ]);
    assert.deepEqual(down.buttons(), ['Close']);
    down.click('Close');
    await down.route(APP);
    assert.deepEqual(await down.send({ type: SHOWN, asset: '123' }), {});
    assert.equal(down.hash(), APP);
    assert.deepEqual(down.sets, []);

    // only the user's own business unit cannot be read
    const blind = shell(link(OTHER, '123'), { current: null });
    await blind.elapse(CURRENT_WAIT);
    assert.deepEqual(await blind.send({ type: WANTED }), { asset: null });
    assert.deepEqual(blind.said(), [
        'This link belongs to the business unit Northwind France (600). The business unit you are in could not be read.',
    ]);
    assert.deepEqual(blind.buttons(), ['Switch and open', 'Stay here']);

    // a marker that was written goes away once the business unit cannot be read any more
    const at = shell(APP);
    await at.send({ type: SHOWN, asset: '123' });
    assert.equal(at.hash(), `${MARKER}123`);
    at.account.current = null;
    await at.send({ type: SHOWN, asset: '456' });
    assert.equal(at.hash(), APP);
    // a dialog that cannot be shown breaks nothing
    const mute = shell(link(OTHER, '123'));
    mute.window.chrome.runtime.getURL = () => {
        throw new Error('Extension context invalidated.');
    };
    assert.deepEqual(await mute.send({ type: WANTED }), { asset: null });
});

test('the dialog comes as soon as the business unit is known, by the API or by the header of the page', async () => {
    const SAID =
        'This link belongs to the business unit Northwind France (600). You are in Northwind Germany (500).';
    // the API never answers: the header alone is enough, once the page has drawn it
    const at = shell(link(OTHER, '123'), { isCurrentHanging: true });
    await settle();
    assert.equal(at.dialog(), null);
    at.window.document.body.insertAdjacentHTML('beforeend', '<div id="header"></div>');
    await settle();
    assert.equal(at.dialog(), null);
    at.window.document.querySelector('#header').innerHTML = HEADER;
    await settle();
    assert.deepEqual(at.said(), [SAID]);
    assert.equal(at.waits(), 0);
    // Content Builder asks later: nothing to open, no second dialog, and no wait for the API
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.equal(at.window.document.querySelectorAll('dialog').length, 1);
    // (asked for the load of the page and for the link, and never again)
    assert.equal(at.currentReads(), 2);

    // a header that is there from the start, and one without the name
    const ready = shell(link(OTHER, '123'), { isCurrentHanging: true, header: HEADER });
    await settle();
    assert.deepEqual(ready.said(), [SAID]);
    const nameless = shell(link(OTHER, '123'), {
        isCurrentHanging: true,
        header: '<div class="mc-account-switcher-current-account-details">MID: 500</div>',
    });
    await settle();
    assert.deepEqual(nameless.said(), [
        'This link belongs to the business unit Northwind France (600). You are in the business unit 500.',
    ]);
    // only digits after "MID:" are an id
    for (const text of ['', 'MID:', 'MID: abc', 'MID: 1234567890123456', '500 Northwind']) {
        const odd = shell(link(OTHER, '123'), {
            isCurrentHanging: true,
            header: `<div class="mc-account-switcher-current-account-details">${text}</div>`,
        });
        await settle();
        assert.equal(odd.dialog(), null, text);
    }

    // the header of the link's own business unit: no dialog; Content Builder's question is
    // answered by the API alone, which here never answers in time
    const same = shell(`${MARKER}123`, { isCurrentHanging: true, header: HEADER });
    await settle();
    assert.equal(same.dialog(), null);
    const answer = same.send({ type: WANTED });
    await same.elapse(CURRENT_WAIT);
    assert.deepEqual(await answer, { asset: null });
    assert.deepEqual(same.said(), [
        'This link belongs to the business unit Northwind Germany (500). The business unit you are in could not be read.',
    ]);

    // neither tells: unknown after the wait, and not before
    const none = shell(link(OTHER, '123'), { isCurrentHanging: true });
    await none.elapse(CURRENT_WAIT - 1);
    assert.equal(none.dialog(), null);
    await none.elapse(1);
    assert.deepEqual(none.said(), [
        'This link belongs to the business unit Northwind France (600). The business unit you are in could not be read.',
    ]);
    assert.deepEqual(await none.send({ type: WANTED }), { asset: null });
    assert.equal(none.window.document.querySelectorAll('dialog').length, 1);

    // a page without a body yet: the dialog waits for it
    const early = shell(link(OTHER, '123'), { isBodyLate: true });
    await settle();
    assert.equal(early.dialog(), null);
    early.window.document.documentElement.append(early.window.document.createElement('body'));
    await settle();
    assert.equal(early.dialog().parentElement, early.window.document.body);

    // a link pasted into the open page is decided by the API, not by the header, which may
    // be that of before a switch in another tab
    const pasted = shell(APP, { header: HEADER });
    pasted.account.current = OTHER;
    await pasted.route(link(OTHER, '456'));
    assert.equal(pasted.dialog(), null);
    assert.deepEqual(await pasted.send({ type: WANTED }), { asset: '456' });
    // a link of this business unit shows no dialog at all
    const fine = shell(`${MARKER}123`, { header: HEADER });
    await settle();
    assert.equal(fine.dialog(), null);
    assert.equal(fine.waits(), 0);
});

test('the dialog greys the page out and closes by its buttons only', async () => {
    const at = shell(link(OTHER, '123'));
    await settle();
    const box = at.dialog();
    assert.equal(box.closedBy, 'none');
    let shows = 0;
    const showModal = box.showModal.bind(box);
    box.showModal = () => {
        shows++;
        showModal();
    };
    // Escape
    const cancel = new at.window.Event('cancel', { cancelable: true });
    box.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(box.hasAttribute('open'), true);
    // closed all the same, as Chrome does on a second Escape: it is shown again
    box.close();
    box.close();
    assert.equal(at.dialog(), box);
    assert.equal(box.hasAttribute('open'), true);
    assert.equal(shows, 2);
    assert.deepEqual(at.went, []);
    // Content Builder gets nothing meanwhile
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    at.click('Stay here');
    assert.equal(at.dialog(), null);
    assert.equal(shows, 2);
    // a link is decided once: no dialog when Content Builder asks after the choice
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    await at.route(APP);
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.went, []);

    // the dialog about a business unit of another account stays as well
    const other = shell(link(NOWHERE, '123'));
    await settle();
    other.dialog().close();
    assert.equal(other.dialog().hasAttribute('open'), true);
    other.click('Close');
    assert.equal(other.dialog(), null);

    // shown by showModal, which greys the page out by the backdrop of the stylesheet
    assert.match(shellScript, /\.showModal\(\)/);
    assert.doesNotMatch(shellScript, /\.show\(\)/);
    assert.match(
        read('../src/deep-link.css'),
        /\.sfmc-ux-tools-deep-link-dialog::backdrop \{\s*background: rgb\(0 0 0 \/ 40%\);/,
    );
});

test('the open asset is written into the address with its business unit, without routing again, and only in Content Builder', async () => {
    const at = shell(APP);
    let routed = 0;
    at.window.addEventListener('hashchange', () => routed++);
    const state = { kept: true };
    at.window.history.replaceState(state, '');

    assert.deepEqual(await at.send({ type: SHOWN, asset: '123' }), {});
    assert.equal(at.window.location.href, `${SHELL}?x=1${MARKER}123`);
    await at.send({ type: SHOWN, asset: '456' });
    assert.equal(at.hash(), `${MARKER}456`);
    // the business unit is read each time: it may have been switched in another tab
    // (and once for the load of the page)
    assert.equal(at.currentReads(), 3);
    at.account.current = OTHER;
    await at.send({ type: SHOWN, asset: '789' });
    assert.equal(at.hash(), link(OTHER, '789'));
    at.account.current = MID;
    // no asset any more, for which nothing is read
    const reads = at.currentReads();
    await at.send({ type: SHOWN, asset: null });
    assert.equal(at.window.location.href, `${SHELL}?x=1${APP}`);
    assert.equal(at.currentReads(), reads);
    // whatever is no id of digits is no asset
    for (const asset of ['12a', '1234567890123456', 123, '../x', '', undefined, { id: 1 }]) {
        await at.send({ type: SHOWN, asset: '123' });
        await at.send({ type: SHOWN, asset });
        assert.equal(at.hash(), APP, String(asset));
    }
    // an asset that was closed before its business unit was read is not written
    const first = at.send({ type: SHOWN, asset: '123' });
    const second = at.send({ type: SHOWN, asset: null });
    await Promise.all([first, second]);
    assert.equal(at.hash(), APP);
    // from anyone but the background script nothing is written
    await at.send({ type: SHOWN, asset: '123' }, { id: 'another-extension' });
    await at.send({ type: SHOWN, asset: '123' }, { id: EXTENSION, tab: { id: 7 } });
    assert.equal(at.hash(), APP);
    assert.equal(routed, 0);
    assert.deepEqual(at.window.history.state, state);

    // another app's address is never touched
    for (const hash of ['#app/Email/', '#app/Journey%20Builder/', '', '#home']) {
        const other = shell(hash);
        await other.send({ type: SHOWN, asset: '123' });
        await other.send({ type: SHOWN, asset: null });
        assert.equal(other.hash(), hash);
        // (read for the load of the page only)
        assert.equal(other.currentReads(), 1);
    }
});

test('the page keeps the asset in the address when it resets its own route', async () => {
    const at = shell(`${MARKER}123`);
    await at.send({ type: WANTED });
    // the reset before any asset is shown stays as it is
    await at.route(APP);
    assert.equal(at.hash(), APP);

    await at.send({ type: SHOWN, asset: '123' });
    assert.equal(at.hash(), `${MARKER}123`);
    await at.route(APP);
    assert.equal(at.hash(), `${MARKER}123`);
    await at.route('#app/Content%20Builder');
    assert.equal(at.hash(), `${MARKER}123`);
    // written again with the business unit as it is then
    at.account.current = OTHER;
    await at.route(APP);
    assert.equal(at.hash(), link(OTHER, '123'));
    at.account.current = MID;
    await at.route(APP);
    assert.equal(at.hash(), `${MARKER}123`);
    // another route of Content Builder is the page's own business
    await at.route(`${APP}something`);
    assert.equal(at.hash(), `${APP}something`);

    // forgotten once nothing is shown
    await at.send({ type: SHOWN, asset: null });
    await at.route(APP);
    assert.equal(at.hash(), APP);

    // forgotten once the page left Content Builder
    await at.send({ type: SHOWN, asset: '123' });
    await at.route('#app/Email/');
    assert.equal(at.hash(), '#app/Email/');
    await at.route(APP);
    assert.equal(at.hash(), APP);
    // told while another app is open: nothing is written, and nothing kept for later
    await at.route('#app/Email/');
    await at.send({ type: SHOWN, asset: '123' });
    assert.equal(at.hash(), '#app/Email/');
    await at.route(APP);
    assert.equal(at.hash(), APP);
});

test('a link pasted into the open page is checked the same way when Content Builder asks again', async () => {
    const at = shell(APP);
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    await at.route(`${MARKER}456`);
    assert.deepEqual(await at.send({ type: WANTED }), { asset: '456' });
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });

    // the marker of the asset that is shown already is no new link
    await at.send({ type: SHOWN, asset: '456' });
    await at.route(`${MARKER}456`);
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.equal(at.dialog(), null);

    // the same asset id in another business unit is a new link, and leads to the dialog
    await at.route(link(OTHER, '456'));
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.deepEqual(at.said(), [
        'This link belongs to the business unit Northwind France (600). You are in Northwind Germany (500).',
    ]);
    at.click('Stay here');
    // and so does any other link of another business unit, or of none of this account
    await at.route(link(NOWHERE, '9'));
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.match(at.said()[0], /^The business unit 999 of this link does not exist/);
    assert.deepEqual(at.went, []);

    // the business unit was switched in another tab: the link of the other one is followed now
    const moved = shell(APP);
    await moved.send({ type: WANTED });
    moved.account.current = OTHER;
    await moved.route(link(OTHER, '456'));
    assert.deepEqual(await moved.send({ type: WANTED }), { asset: '456' });
    assert.equal(moved.dialog(), null);
});

test('the business units of an account are added to those the browser has seen', () => {
    const { merge } = shell().helpers;
    const germany = { mid: '500', name: 'Northwind Germany', parent: '100' };
    const france = { mid: '600', name: 'Northwind France', parent: '100' };
    const top = { mid: '100', name: 'Northwind', parent: null };
    const other = { 900: { name: 'Contoso', units: { 900: 'Contoso' } } };
    // a new enterprise, next to what was kept
    assert.deepEqual(plain(merge(other, [top, germany])), {
        ...other,
        100: { name: 'Northwind', units: { 100: 'Northwind', 500: 'Northwind Germany' } },
    });
    for (const nothing of [undefined, null, 'broken', []]) {
        assert.deepEqual(plain(merge(nothing, [top, germany])), {
            100: { name: 'Northwind', units: { 100: 'Northwind', 500: 'Northwind Germany' } },
        });
    }
    // a business unit more, one that was renamed, and one that is not listed any more is kept
    const before = {
        100: {
            name: 'Northwind Old',
            units: { 100: 'Northwind Old', 500: 'Germany', 800: 'Gone' },
        },
    };
    assert.deepEqual(plain(merge(before, [top, germany, france])), {
        100: {
            name: 'Northwind',
            units: {
                100: 'Northwind',
                500: 'Northwind Germany',
                600: 'Northwind France',
                800: 'Gone',
            },
        },
    });
    // what was handed in is not changed
    assert.equal(before[100].units[500], 'Germany');
    // a list without the enterprise is kept under the one above the user's business unit, or
    // under that business unit itself, and keeps the name that enterprise had
    assert.deepEqual(plain(merge(before, [germany], { mid: '500', parent: '100' })), {
        100: {
            name: 'Northwind Old',
            units: { 100: 'Northwind Old', 500: 'Northwind Germany', 800: 'Gone' },
        },
    });
    assert.deepEqual(plain(merge({}, [germany], { mid: '500', parent: null })), {
        500: { name: '', units: { 500: 'Northwind Germany' } },
    });
    // nothing to add
    assert.equal(merge(before, [germany]), undefined);
    assert.equal(merge(before, []), undefined);
    assert.equal(merge(before), undefined);
});

test('the page reads the business units once when it is loaded and keeps their names in the browser only', async () => {
    const at = shell();
    await settle();
    // and, as every load of the page does, the business unit the user is in
    assert.deepEqual(at.calls, [
        `GET ${ACCOUNTS}?$page=1&$pageSize=50&includeParentDetails=true`,
        `GET ${ACCOUNTS}/@current`,
    ]);
    assert.deepEqual(at.sets, [{ [MEMORY_KEY]: REMEMBERED }]);

    // next to another account that was seen before
    const memory = { 900: { name: 'Contoso', units: { 900: 'Contoso', 999: 'Contoso Italy' } } };
    const second = shell('', { memory });
    await settle();
    assert.deepEqual(second.store[MEMORY_KEY], { ...memory, ...REMEMBERED });

    // a list of several pages is read to its end
    const many = [unit(100, 'Northwind', null)];
    for (let index = 1; index <= PAGE_SIZE; index++) {
        many.push(unit(1000 + index, `Unit ${index}`, 100));
    }
    const long = shell('', { units: many });
    await settle();
    assert.equal(long.listReads(), 2);
    assert.equal(Object.keys(long.store[MEMORY_KEY][100].units).length, PAGE_SIZE + 1);
    // a list that does not end is given up after its most pages
    const full = many.slice(0, PAGE_SIZE);
    const looping = [...full];
    looping.slice = () => full;
    const endless = shell('', { units: looping });
    await settle();
    assert.equal(endless.listReads(), MOST_PAGES);

    // a list without the enterprise: the user's business unit says where it belongs
    const partial = shell('', { units: UNITS.slice(1) });
    await settle();
    // (read for that, and for the load of the page)
    assert.equal(partial.currentReads(), 2);
    assert.deepEqual(Object.keys(partial.store[MEMORY_KEY]), ['100']);

    // a list that cannot be read leaves what was kept as it is
    for (const has of [{ isListDown: true }, { isDown: true }, { units: [] }]) {
        const failed = shell('', { memory, ...has });
        await settle();
        assert.deepEqual(failed.sets, [], JSON.stringify(has));
        assert.deepEqual(failed.store[MEMORY_KEY], memory);
    }
    // a storage that cannot be used breaks nothing
    const lost = shell(`${MARKER}123`, { isStorageDown: true });
    await settle();
    assert.deepEqual(await lost.send({ type: WANTED }), { asset: '123' });
});

test('every load of the Marketing Cloud page reads the business unit the user is in, link or not, and no other page does', async () => {
    // seen live: right after a switch, the business unit that is remembered for Contact
    // Builder's links was still the one before, because a page without a link never read it
    for (const hash of ['', '#home', APP, `${EMAIL}%23Subscribers`, '#app/Journey%20Builder/']) {
        const at = shell(hash, { remembered: OTHER });
        assert.equal(at.remembered(), OTHER, hash);
        await settle();
        assert.equal(at.currentReads(), 1, hash);
        assert.equal(at.remembered(), MID, hash);
        // reading it shows nothing, goes nowhere and leaves the address as it is
        assert.equal(at.dialog(), null);
        assert.deepEqual(at.went, []);
        assert.equal(at.hash(), hash);
        assert.equal(at.waits(), 0);
    }
    // nothing was kept before
    const first = shell();
    await settle();
    assert.equal(first.remembered(), MID);
    // the API does not answer: the header of the page, which is right while the page is loaded
    const header = shell('', { isCurrentHanging: true, header: HEADER, remembered: OTHER });
    await settle();
    assert.equal(header.remembered(), MID);
    assert.equal(header.waits(), 0);
    // neither tells it: what was kept stays, and the wait ends
    for (const has of [{ isDown: true }, { current: null }, { isCurrentHanging: true }]) {
        const mute = shell('', { remembered: OTHER, ...has });
        await settle();
        await mute.elapse(CURRENT_WAIT);
        assert.equal(mute.currentReads(), 1, JSON.stringify(has));
        assert.equal(mute.remembered(), OTHER, JSON.stringify(has));
        assert.equal(mute.waits(), 0);
    }
    // any other page under the same path, such as the one that switches the business unit
    for (const path of ['/cloud/context-switch.html', '/cloud/tools/', '/cloud', '/']) {
        const other = shell('', { path, remembered: OTHER });
        await settle();
        assert.equal(other.currentReads(), 0, path);
        assert.equal(other.remembered(), OTHER, path);
        assert.equal(other.waits(), 0);
    }
});

test('the options page forgets the business units on a click, and only them', async () => {
    const { window } = new JSDOM(read('../src/options.html'), { runScripts: 'outside-only' });
    const removed = [];
    let isDown = false;
    window.chrome = {
        storage: {
            sync: { get: async (defaults) => ({ ...defaults }), set: () => {} },
            local: {
                remove: async (key) => {
                    if (isDown) {
                        throw new Error('Extension context invalidated.');
                    }
                    removed.push(key);
                },
            },
        },
    };
    window.eval(read('../src/options.js'));
    await tick();
    assert.deepEqual(removed, []);
    const button = window.document.querySelector('#forgetBusinessUnits');
    const done = window.document.querySelector('#forgetBusinessUnitsDone');
    assert.equal(
        button.textContent.trim().replaceAll(/\s+/g, ' '),
        'Forget the business units this browser has seen',
    );
    assert.equal(done.textContent, '');
    button.click();
    await tick();
    assert.deepEqual(removed, [MEMORY_KEY]);
    assert.equal(done.textContent, 'Forgotten.');
    isDown = true;
    button.click();
    await tick();
    assert.deepEqual(removed, [MEMORY_KEY]);
    assert.match(done.textContent, /Could not be forgotten/);
    // the shell script keeps them under the same name
    assert.match(shellScript, new RegExp(`MEMORY_KEY = '${MEMORY_KEY}'`));
});

test('Content Builder tells which asset is open, and only when that changed', async () => {
    const at = frame({ html: SEARCH_BOX + list('1', '2') });
    // the first look says that nothing is open
    assert.deepEqual(at.shown(), [null]);
    at.document.body.insertAdjacentHTML('beforeend', DETAILS);
    // not at once: the page may still be changing
    await tick();
    assert.deepEqual(at.shown(), [null]);
    await at.pass();
    assert.deepEqual(at.shown(), [null, '123']);
    // other changes of the page tell nothing new
    at.document.body.append(at.document.createElement('div'));
    await at.pass();
    at.document.body.lastChild.setAttribute('class', 'x');
    await at.pass();
    assert.deepEqual(at.shown(), [null, '123']);

    // another asset in the same view: the field holds another id, which is read at each look
    at.document.querySelector('.contentinput-copyvalue').value = '456';
    at.document.body.append(at.document.createElement('div'));
    await at.pass();
    assert.deepEqual(at.shown(), [null, '123', '456']);
    // a view that is not drawn shows no asset
    at.document.querySelector('.contentproperties-detailsview').parentElement.style.display =
        'none';
    await at.pass();
    assert.deepEqual(at.shown(), [null, '123', '456', null]);
    at.document.querySelector('.contentproperties-detailsview').parentElement.style.display = '';
    await at.pass();
    assert.deepEqual(at.shown().at(-1), '456');
    // an id that is none, and a view that is gone
    at.document.querySelector('.contentinput-copyvalue').value = 'abc';
    at.document.body.append(at.document.createElement('div'));
    await at.pass();
    assert.deepEqual(at.shown().at(-1), null);
    at.document.querySelector('.contentinput-copyvalue').value = '7';
    at.document.body.append(at.document.createElement('div'));
    await at.pass();
    assert.deepEqual(at.shown().at(-1), '7');
    at.document.querySelector('.contentproperties-detailsview').remove();
    await at.pass();
    assert.deepEqual(at.shown().slice(-2), ['7', null]);
    // without a link nothing was read, searched or clicked
    assert.equal(at.asked(), 1);
    assert.deepEqual(at.calls, []);
    assert.deepEqual(at.searched, []);
    assert.deepEqual(at.clicked, []);
});

test('many changes in a row are looked at once', async () => {
    const at = frame({ html: SEARCH_BOX });
    let looks = 0;
    const find = at.document.querySelector.bind(at.document);
    at.document.querySelector = (selector) => {
        if (selector === '.contentproperties-detailsview') {
            looks++;
        }
        return find(selector);
    };
    for (let index = 0; index < 20; index++) {
        at.document.body.append(at.document.createElement('div'));
        await tick();
    }
    assert.equal(looks, 0);
    await at.pass();
    assert.equal(looks, 1);
});

test('a link is followed by a search for the asset’s name and a click on the row with its id', async () => {
    const at = frame({
        html: SEARCH_BOX + list('1', '2'),
        wanted: '123',
        assets: { 123: { body: { id: 123, name: 'Welcome <b>mail</b>' } } },
    });
    await at.pass();
    assert.equal(at.asked(), 1);
    assert.deepEqual(at.calls, ['GET /fuelapi/asset/v1/content/assets/123?$fields=id,name']);
    assert.deepEqual(at.searched, [
        'input Welcome <b>mail</b>',
        'change Welcome <b>mail</b>',
        'keydown Welcome <b>mail</b> Enter 13',
        'keypress Welcome <b>mail</b> Enter 13',
        'keyup Welcome <b>mail</b> Enter 13',
    ]);
    // the rows that are there are other assets
    assert.deepEqual(at.clicked, []);
    // the search lists several, the wanted one not first
    at.document.querySelector('tbody').innerHTML = row('1234') + row('12') + row('123');
    await at.pass();
    assert.deepEqual(at.clicked, ['cb:repeater:list:123']);
    // once: the list drawn again is left alone, and so is the time after
    at.document.querySelector('tbody').innerHTML = row('123');
    await at.pass();
    await at.pass(ROW_WAIT);
    assert.deepEqual(at.clicked, ['cb:repeater:list:123']);
    assert.equal(at.notice(), null);
    assert.equal(at.asked(), 1);
    assert.equal(at.calls.length, 1);
    assert.equal(at.searched.length, 5);
    // the asset is not open yet: the search stays
    const box = at.document.querySelector('input');
    assert.equal(box.value, 'Welcome <b>mail</b>');
    at.document.body.insertAdjacentHTML('beforeend', DETAILS);
    await at.pass();
    // open now: the search is emptied the way it was made, once
    assert.equal(box.value, '');
    assert.deepEqual(at.searched.slice(5), [
        'input ',
        'change ',
        'keydown  Enter 13',
        'keypress  Enter 13',
        'keyup  Enter 13',
    ]);
    box.value = 'Welcome <b>mail</b>';
    at.document.body.append(at.document.createElement('div'));
    await at.pass();
    assert.equal(box.value, 'Welcome <b>mail</b>');
    assert.equal(at.searched.length, 10);
    assert.deepEqual(at.clicked, ['cb:repeater:list:123']);
});

test('the search is left alone when the user changed it or opened another asset', async () => {
    const start = async () => {
        const at = frame({
            html: SEARCH_BOX + list('123'),
            wanted: '123',
            assets: { 123: { body: { id: 123, name: 'Welcome' } } },
        });
        await at.pass();
        assert.deepEqual(at.clicked, ['cb:repeater:list:123']);
        return at;
    };
    // the user searched for something else before the asset was open
    const changed = await start();
    changed.document.querySelector('input').value = 'my own search';
    changed.document.body.insertAdjacentHTML('beforeend', DETAILS);
    await changed.pass();
    assert.equal(changed.document.querySelector('input').value, 'my own search');
    assert.equal(changed.searched.length, 5);

    // another asset was opened instead: the link is done with, also when its asset opens later
    const other = await start();
    other.document.body.insertAdjacentHTML('beforeend', DETAILS);
    other.document.querySelector('.contentinput-copyvalue').value = '456';
    await other.pass();
    other.document.querySelector('.contentinput-copyvalue').value = '123';
    other.document.body.append(other.document.createElement('div'));
    await other.pass();
    assert.equal(other.document.querySelector('input').value, 'Welcome');
    assert.equal(other.searched.length, 5);
});

test('a link to an asset that is listed already is followed at once', async () => {
    const at = frame({
        html: SEARCH_BOX + list('1', '123'),
        wanted: '123',
        assets: { 123: { body: { id: '123', name: 'Welcome' } } },
    });
    await at.pass(0);
    assert.deepEqual(at.clicked, ['cb:repeater:list:123']);
});

test('a link whose row never comes ends in a notice that can be closed, and clicks nothing', async () => {
    const at = frame({
        html: SEARCH_BOX + list('1', '2'),
        wanted: '123',
        assets: { 123: { body: { id: 123, name: 'Welcome' } } },
    });
    await at.pass();
    at.document.querySelector('tbody').innerHTML = row('1234') + row('12');
    await at.pass(ROW_WAIT - LOOK_DELAY - 1);
    assert.equal(at.notice(), null);
    await at.pass(1);
    assert.equal(
        at.notice().querySelector('span').textContent,
        "SFMC UX Tools: could not open asset 123 from the link (Content Builder's search did not list it).",
    );
    assert.deepEqual(at.clicked, []);
    // a row that comes too late is not clicked
    at.document.querySelector('tbody').innerHTML = row('123');
    await at.pass();
    assert.deepEqual(at.clicked, []);
    at.notice().querySelector('button').click();
    assert.equal(at.notice(), null);
    assert.deepEqual(at.clicked, ['BUTTON']);
    assert.equal(at.calls.length, 1);
    // the search stays, so that the user sees what was looked for, also once an asset is open
    at.document.body.insertAdjacentHTML('beforeend', DETAILS);
    await at.pass();
    assert.equal(at.document.querySelector('input').value, 'Welcome');
    assert.equal(at.searched.length, 5);
});

test('a link to an asset that cannot be read ends in the notice, without a search', async () => {
    for (const answer of [
        undefined,
        { status: 403, body: { message: 'no' } },
        { isDown: true },
        { status: 200 },
        { body: { id: 124, name: 'another asset' } },
        { body: { id: 123 } },
        { body: { id: 123, name: '' } },
        { body: { id: 123, name: 7 } },
        { body: null },
    ]) {
        const at = frame({
            html: SEARCH_BOX + list('123'),
            wanted: '123',
            assets: { 123: answer },
        });
        await at.pass();
        assert.match(at.notice().textContent, /could not open asset 123/, JSON.stringify(answer));
        assert.deepEqual(at.searched, []);
        assert.deepEqual(at.clicked, []);
        assert.equal(at.calls.length, 1);
    }
});

test('what the page answers is followed only when it is an id of digits', async () => {
    for (const wanted of [null, undefined, '', '12a', '1234567890123456', 123, '../x', {}]) {
        const at = frame({ html: SEARCH_BOX + list('123'), wanted });
        await at.pass();
        assert.equal(at.asked(), 1);
        assert.deepEqual(at.calls, [], String(wanted));
        assert.deepEqual(at.clicked, []);
        assert.equal(at.notice(), null);
    }
});

test('only the document with the list, directly below the page, talks to the page', async () => {
    // Content Builder opened by itself
    const alone = frame({
        html: SEARCH_BOX + list('123') + DETAILS,
        wanted: '123',
        depth: 'top',
    });
    await alone.pass();
    assert.deepEqual(alone.sent, []);
    // a frame inside Content Builder's frame
    const nested = frame({
        html: SEARCH_BOX + list('123') + DETAILS,
        wanted: '123',
        depth: 'nested',
    });
    await nested.pass();
    assert.deepEqual(nested.sent, []);
    for (const at of [alone, nested]) {
        assert.deepEqual(at.calls, []);
        assert.deepEqual(at.clicked, []);
    }

    // a document without the search box says nothing, until it has one
    const other = frame({ html: DETAILS, wanted: '123' });
    await other.pass();
    other.document.body.append(other.document.createElement('div'));
    await other.pass();
    assert.deepEqual(other.sent, []);
    assert.deepEqual(other.calls, []);
    other.document.body.insertAdjacentHTML('afterbegin', SEARCH_BOX);
    await other.pass();
    assert.equal(other.asked(), 1);
    assert.deepEqual(other.shown(), ['123']);
    // the box may go away again: the document stays the one with the list
    other.document.querySelector('input[placeholder="Search"]').remove();
    other.document.querySelector('.contentproperties-detailsview').remove();
    await other.pass();
    assert.deepEqual(other.shown(), ['123', null]);
    assert.equal(other.asked(), 1);
});

test('the scripts change nothing in Marketing Cloud and write no markup', () => {
    assert.deepEqual(frameScript.match(/\bfetch\(/g), ['fetch(']);
    assert.deepEqual(frameScript.match(/method: '[A-Z]+'/g), ["method: 'GET'"]);
    assert.equal(frameScript.match(/\.click\(\)/g).length, 1);
    // the page's script only reads, and leaves the page in one place: the switch the user clicked
    assert.deepEqual(shellScript.match(/\bfetch\(/g), ['fetch(']);
    assert.deepEqual(shellScript.match(/method: '[A-Z]+'/g), ["method: 'GET'"]);
    assert.deepEqual(shellScript.match(/location\.(?:assign|replace|href)\b/g), [
        'location.assign',
    ]);
    for (const script of [shellScript, frameScript]) {
        assert.doesNotMatch(script, /XMLHttpRequest|sendBeacon/);
        assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML/);
    }
});

test('the background script passes the two messages from Content Builder’s frame to the page of its tab', async () => {
    const FRAME = {
        id: EXTENSION,
        tab: { id: 7 },
        frameId: 3,
        documentId: 'A1',
        url: 'https://content-builder.s7.marketingcloudapps.com/',
    };
    const { send, passed } = background((message) =>
        message.type === WANTED ? { asset: '123' } : {},
    );
    assert.deepEqual(await send({ type: WANTED, asset: 'x', more: 1 }, FRAME), { asset: '123' });
    assert.deepEqual(await send({ type: SHOWN, asset: '456', more: 1 }, FRAME), {});
    // to the page only, and with nothing but the type and the asset
    assert.deepEqual(passed, [
        { tabId: 7, message: { type: WANTED }, options: { frameId: 0 } },
        { tabId: 7, message: { type: SHOWN, asset: '456' }, options: { frameId: 0 } },
    ]);

    for (const other of [
        { id: 'another-extension' },
        { tab: undefined },
        { tab: {} },
        // the page itself, and a sender without a frame
        { frameId: 0 },
        { frameId: undefined },
        { url: undefined },
        { url: 'not an address' },
        { url: 'https://mc.s7.marketingcloudapps.com/AutomationStudioFuel3/' },
        { url: 'https://jbinteractions.s7.marketingcloudapps.com/' },
        // the same address without encryption
        { url: FRAME.url.replace('https:', 'http:') },
        { url: 'https://content-builder.s7.marketingcloudapps.com.example.org/' },
        { url: 'https://example.org/https://content-builder.s7.marketingcloudapps.com/' },
        { url: 'https://content-builder.example.org/?x=.marketingcloudapps.com' },
        { url: 'https://mc.s7.exacttarget.com/cloud/' },
    ]) {
        for (const type of [WANTED, SHOWN]) {
            const sender = { ...FRAME, ...other };
            assert.equal(send({ type, asset: '1' }, sender), false, JSON.stringify(other));
        }
    }
    assert.equal(passed.length, 2);

    // a page that does not listen: the frame gets no answer, and nothing breaks
    const deaf = background(() => {
        throw new Error('Could not establish connection');
    });
    assert.equal(await deaf.send({ type: WANTED }, FRAME), undefined);
});

test('the manifest runs both scripts in the extension’s own world, without a new permission', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entry = (file) => manifest.content_scripts.filter((item) => item.js.includes(file));
    // the page only, and before it reads its own address
    assert.deepEqual(entry('deep-link-shell.js'), [
        {
            matches: ['https://*.exacttarget.com/cloud/*'],
            include_globs: ['https://mc.*'],
            js: ['deep-link-shell.js'],
            css: ['deep-link.css'],
            run_at: 'document_start',
        },
    ]);
    assert.deepEqual(entry('deep-link-content-builder.js'), [
        {
            matches: ['https://*.marketingcloudapps.com/*'],
            include_globs: ['https://content-builder.*'],
            js: ['deep-link-content-builder.js'],
            all_frames: true,
            run_at: 'document_idle',
        },
    ]);
    assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
    assert.deepEqual(manifest.host_permissions, ['https://*.marketingcloudapps.com/*']);
});

test('a link is carried across a switch of the business unit, taken by the Marketing Cloud page only, and once', async () => {
    const KEPT = 'content-builder/600/123';
    const at = shell(link(OTHER, '123'));
    await settle();
    assert.equal(at.kept(), null);
    at.click('Switch and open');
    assert.equal(at.kept(), KEPT);
    assert.equal(at.went.length, 1);

    // the page that switches lies under the same path as the Marketing Cloud page: it leaves
    // the link where it is, for the page after it
    const switching = shell('', {
        path: '/cloud/context-switch.html',
        current: OTHER,
        carried: KEPT,
    });
    await settle();
    assert.equal(switching.kept(), KEPT);
    assert.deepEqual(await switching.send({ type: WANTED }), { asset: null });
    assert.equal(switching.kept(), KEPT);
    for (const path of ['/cloud/other.html', '/cloud/tools/SSO.aspx', '/cloud']) {
        const other = shell(APP, { path, current: OTHER, carried: KEPT });
        await settle();
        assert.equal(other.kept(), KEPT, path);
        assert.deepEqual(await other.send({ type: WANTED }), { asset: null });
    }

    // the Marketing Cloud page after the switch, whose address lost the asset: it takes the
    // link out when it starts, and hands it over once
    const after = shell(APP, { current: OTHER, carried: KEPT });
    assert.equal(after.kept(), null);
    assert.deepEqual(await after.send({ type: WANTED }), { asset: '123' });
    assert.deepEqual(await after.send({ type: WANTED }), { asset: null });
    assert.equal(after.dialog(), null);
    // loaded again, there is nothing left to take
    const again = shell(APP, { current: OTHER });
    assert.deepEqual(await again.send({ type: WANTED }), { asset: null });

    // the switch did not happen: the link is decided as any other
    const failed = shell(APP, { carried: KEPT });
    await settle();
    assert.deepEqual(failed.buttons(), ['Switch and open', 'Stay here']);
    assert.deepEqual(await failed.send({ type: WANTED }), { asset: null });
    assert.equal(failed.kept(), null);

    // what is kept is a link only in the form it was written in; anything else is thrown away
    for (const kept of [
        '',
        '600/123',
        'content-builder/600/12a',
        'content-builder/x/123',
        'content-builder/600/',
        `content-builder/600/${VIEW}`,
        'email-studio/600/123',
        'email-studio/600/r.a.b',
        'another-app/600/123',
        ' content-builder/600/123',
    ]) {
        const odd = shell(APP, { current: OTHER, carried: kept });
        assert.equal(odd.kept(), null, kept);
        assert.deepEqual(await odd.send({ type: WANTED }), { asset: null }, kept);
        assert.deepEqual(await odd.send({ type: EMAIL_WANTED }), { target: null }, kept);
        assert.equal(odd.dialog(), null);
    }

    // a link into Email Studio is carried the same way
    const view = shell(emailLink(OTHER, VIEW));
    await settle();
    view.click('Switch and open');
    assert.equal(view.kept(), `email-studio/600/${VIEW}`);
    assert.deepEqual(view.went, [switchTo(PLAIN_EMAIL)]);
    const landed = shell('#app/Email', { current: OTHER, carried: view.kept() });
    assert.equal(landed.kept(), null);
    assert.deepEqual(await landed.send({ type: EMAIL_WANTED }), { target: VIEW });
    assert.deepEqual(await landed.send({ type: EMAIL_WANTED }), { target: null });
    assert.equal(landed.dialog(), null);
});

test('the address that the page was handed to open is read only from its marked base64 form', () => {
    const { arrival } = shell().helpers;
    const ASSET_LINK = link(MID, '123');
    const VIEW_LINK = emailLink(MID, VIEW);
    assert.equal(arrival(handed(ASSET_LINK)), ASSET_LINK);
    assert.equal(arrival(handed(VIEW_LINK)), VIEW_LINK);
    assert.equal(arrival(`?x=1&${handed('#app/Email').slice(1)}&y=2`), '#app/Email');
    // seen live: the page after a switch of the business unit
    assert.equal(arrival('?hash=logged-inI2FwcC9FbWFpbA%3D%3D'), '#app/Email');
    for (const search of [
        '',
        '?',
        '?x=1',
        '?hash=',
        // no mark, or another one
        `?hash=${encode(link(MID, '123'))}`,
        `?hash=logged-out${encode(link(MID, '123'))}`,
        `?hash=Logged-In${encode(link(MID, '123'))}`,
        `?other=logged-in${encode(link(MID, '123'))}`,
        // no base64
        '?hash=logged-in',
        '?hash=logged-in!!!',
        '?hash=logged-in%23app%2FEmail',
        `?hash=logged-in${link(MID, '123')}`,
        // base64 of something that is no address from the #
        `?hash=logged-in${encode('app/Email')}`,
        `?hash=logged-in${encode(` ${ASSET_LINK}`)}`,
        `?hash=logged-in${encode(SHELL + ASSET_LINK)}`,
        `?hash=logged-in${encode('javascript:alert(1)')}`,
    ]) {
        assert.equal(arrival(search), null, search);
    }
});

test('a link that only the address handed to the page holds is decided as any other', async () => {
    // the business unit the user is in: handed to its app once, and nothing is rewritten
    const asset = shell('', { search: handed(link(MID, '123')) });
    assert.deepEqual(await asset.send({ type: EMAIL_WANTED }), { target: null });
    assert.deepEqual(await asset.send({ type: WANTED }), { asset: '123' });
    assert.deepEqual(await asset.send({ type: WANTED }), { asset: null });
    assert.equal(asset.dialog(), null);
    assert.equal(asset.window.location.search, handed(link(MID, '123')));
    assert.equal(asset.hash(), '');
    const view = shell('', { search: handed(emailLink(MID, VIEW)) });
    assert.deepEqual(await view.send({ type: WANTED }), { asset: null });
    assert.deepEqual(await view.send({ type: EMAIL_WANTED }), { target: VIEW });
    assert.deepEqual(await view.send({ type: EMAIL_WANTED }), { target: null });
    assert.equal(view.dialog(), null);
    assert.equal(view.window.location.search, handed(emailLink(MID, VIEW)));

    // another business unit: the dialog, and the app gets nothing
    for (const [hash, type, nothing] of [
        [link(OTHER, '123'), WANTED, { asset: null }],
        [emailLink(OTHER, VIEW), EMAIL_WANTED, { target: null }],
    ]) {
        const other = shell('', { search: handed(hash) });
        await settle();
        assert.deepEqual(other.buttons(), ['Switch and open', 'Stay here'], hash);
        assert.deepEqual(await other.send({ type }), nothing, hash);
        assert.equal(other.window.location.search, handed(hash));
        assert.deepEqual(other.went, []);
    }
    const nowhere = shell('', { search: handed(link(NOWHERE, '123')) });
    await settle();
    assert.deepEqual(nowhere.buttons(), ['Close']);

    // a field that is not what the page writes there holds no link
    for (const search of [
        `?hash=${encode(link(MID, '123'))}`,
        '?hash=logged-in!!!',
        `?hash=logged-in${encode(link(MID, '123').slice(1))}`,
        `?hash=logged-in${encode('#app/Content%20Builder/ux-tools/500/asset/12a')}`,
    ]) {
        const odd = shell('', { search });
        await settle();
        assert.deepEqual(await odd.send({ type: WANTED }), { asset: null }, search);
        assert.equal(odd.dialog(), null, search);
        assert.equal(odd.window.location.search, search);
    }
});

test('the link kept for a switch is written into the address that the page was handed, or into its route, before the page reads it', async () => {
    const { arrival, withArrival } = shell().helpers;
    const KEPT = 'content-builder/600/123';
    const KEPT_VIEW = `email-studio/600/${VIEW}`;
    const KEPT_FOLDER = `email-studio/600/${FOLDER}`;
    assert.equal(
        withArrival('?hash=logged-inI2FwcC9FbWFpbA%3D%3D', '#app/Email/x?a=b'),
        '?hash=logged-inI2FwcC9FbWFpbC94P2E9Yg%3D%3D',
    );
    assert.equal(withArrival('?x=1&hash=old&y=2', '#a'), '?x=1&hash=logged-inI2E%3D&y=2');
    assert.equal(withArrival('', '#a'), '?hash=logged-inI2E%3D');

    // seen live: the page after the switch is handed the plain address of the app
    const ARRIVALS = [
        [KEPT, APP, link(OTHER, '123'), WANTED, { asset: '123' }, { asset: null }],
        [
            KEPT_VIEW,
            '#app/Email',
            emailLink(OTHER, VIEW),
            EMAIL_WANTED,
            { target: VIEW },
            { target: null },
        ],
        [
            KEPT_FOLDER,
            '#app/Email',
            emailLink(OTHER, FOLDER),
            EMAIL_WANTED,
            { target: FOLDER },
            { target: null },
        ],
    ];
    for (const [carried, plain, full, type, once, nothing] of ARRIVALS) {
        const at = shell('', { current: OTHER, carried, search: handed(plain) });
        // at once, before the page applies what it was handed
        assert.equal(at.window.location.search, handed(full), carried);
        assert.equal(arrival(at.window.location.search), full, carried);
        assert.equal(at.window.location.pathname, '/cloud/');
        assert.equal(at.hash(), '');
        assert.equal(at.kept(), null);
        assert.deepEqual(await at.send({ type }), once, carried);
        assert.deepEqual(await at.send({ type }), nothing, carried);
        assert.equal(at.dialog(), null);
        assert.equal(at.window.location.search, handed(full));

        // not handed an address: the link goes into the route, and the query stays
        const routed = shell(plain, { current: OTHER, carried });
        assert.equal(routed.hash(), full, carried);
        assert.equal(routed.window.location.search, '?x=1');
        assert.equal(routed.kept(), null);
        assert.deepEqual(await routed.send({ type }), once, carried);
        assert.deepEqual(await routed.send({ type }), nothing, carried);
        assert.equal(routed.dialog(), null);
    }
    assert.equal(
        shell('', { current: OTHER, carried: KEPT, search: handed(APP) }).window.location.search,
        '?hash=logged-inI2FwcC9Db250ZW50JTIwQnVpbGRlci91eC10b29scy82MDAvYXNzZXQvMTIz',
    );
    // the other fields of the query stay, and a field that is not what the page writes there
    // is no address that was handed over
    const among = shell('', {
        current: OTHER,
        carried: KEPT,
        search: `?x=1&${handed(APP).slice(1)}&y=2`,
    });
    assert.equal(among.window.location.search, `?x=1&${handed(link(OTHER, '123')).slice(1)}&y=2`);
    const unmarked = shell(APP, { current: OTHER, carried: KEPT, search: '?hash=abc' });
    assert.equal(unmarked.window.location.search, '?hash=abc');
    assert.equal(unmarked.hash(), link(OTHER, '123'));

    // the switch did not happen: the link that was written is decided as any other
    const failed = shell('', { carried: KEPT_VIEW, search: handed('#app/Email') });
    await settle();
    assert.deepEqual(failed.buttons(), ['Switch and open', 'Stay here']);
    assert.deepEqual(await failed.send({ type: EMAIL_WANTED }), { target: null });
});

test('the kept link changes nothing in an address that holds a link already, on another page, or a second time', async () => {
    const KEPT = 'content-builder/600/123';
    // a link in the route, or in the address that the page was handed: that one is followed,
    // and the kept one is thrown away
    const routed = shell(link(OTHER, '7'), { current: OTHER, carried: KEPT });
    assert.equal(routed.hash(), link(OTHER, '7'));
    assert.equal(routed.window.location.search, '?x=1');
    assert.equal(routed.kept(), null);
    assert.deepEqual(await routed.send({ type: WANTED }), { asset: '7' });
    assert.deepEqual(await routed.send({ type: WANTED }), { asset: null });
    const arrived = shell('', {
        current: OTHER,
        carried: KEPT,
        search: handed(emailLink(OTHER, VIEW)),
    });
    assert.equal(arrived.window.location.search, handed(emailLink(OTHER, VIEW)));
    assert.equal(arrived.hash(), '');
    assert.equal(arrived.kept(), null);
    assert.deepEqual(await arrived.send({ type: WANTED }), { asset: null });
    assert.deepEqual(await arrived.send({ type: EMAIL_WANTED }), { target: VIEW });
    // the link of the route comes before the one that the page was handed
    const both = shell(link(OTHER, '7'), {
        current: OTHER,
        carried: KEPT,
        search: handed(link(OTHER, '8')),
    });
    assert.equal(both.window.location.search, handed(link(OTHER, '8')));
    assert.deepEqual(await both.send({ type: WANTED }), { asset: '7' });
    assert.deepEqual(await both.send({ type: WANTED }), { asset: null });

    // any other page under the same path leaves the kept link and its own address alone
    for (const path of ['/cloud/context-switch.html', '/cloud/other.html', '/cloud']) {
        const other = shell('', { path, current: OTHER, carried: KEPT, search: handed(APP) });
        await settle();
        assert.equal(other.kept(), KEPT, path);
        assert.equal(other.window.location.search, handed(APP), path);
        assert.equal(other.hash(), '', path);
        assert.deepEqual(await other.send({ type: WANTED }), { asset: null }, path);
        assert.equal(other.dialog(), null, path);
    }

    // taken once: the same page loaded again has nothing to write
    const first = shell('', { current: OTHER, carried: KEPT, search: handed(APP) });
    assert.equal(first.kept(), null);
    const again = shell('', { current: OTHER, search: handed(APP) });
    assert.equal(again.window.location.search, handed(APP));
    assert.deepEqual(await again.send({ type: WANTED }), { asset: null });
    const plain = shell(APP, { current: OTHER });
    assert.equal(plain.hash(), APP);
    assert.deepEqual(await plain.send({ type: WANTED }), { asset: null });
});

test('a kept link is written into the address of its own app only, and is dropped for any other', async () => {
    const KEPT = 'content-builder/600/123';
    const KEPT_VIEW = `email-studio/600/${VIEW}`;
    const JOURNEYS = '#app/Journey%20Builder';
    // the page is about to open another app than the kept link's
    for (const [carried, plain] of [
        [KEPT, JOURNEYS],
        [KEPT, '#app/Email'],
        [KEPT_VIEW, JOURNEYS],
        [KEPT_VIEW, APP],
    ]) {
        const name = `${carried} ${plain}`;
        const handedOver = shell('', { current: OTHER, carried, search: handed(plain) });
        assert.equal(handedOver.window.location.search, handed(plain), name);
        assert.equal(handedOver.hash(), '', name);
        const routed = shell(plain, { current: OTHER, carried });
        assert.equal(routed.window.location.href, `${SHELL}?x=1${plain}`, name);
        // the address that was handed over decides, not the route
        const own = carried === KEPT ? APP : '#app/Email';
        const crossed = shell(own, { current: OTHER, carried, search: handed(JOURNEYS) });
        assert.equal(crossed.window.location.search, handed(JOURNEYS), name);
        assert.equal(crossed.hash(), own, name);
        for (const at of [handedOver, routed, crossed]) {
            // dropped: taken out of the session storage, and no app is handed it
            assert.equal(at.kept(), null, name);
            assert.deepEqual(await at.send({ type: WANTED }), { asset: null }, name);
            assert.deepEqual(await at.send({ type: EMAIL_WANTED }), { target: null }, name);
            assert.equal(at.dialog(), null, name);
        }
    }
    // the switch did not happen, and the page opens another app: no dialog about the kept link
    const failed = shell('', { carried: KEPT, search: handed(JOURNEYS) });
    await settle();
    assert.equal(failed.dialog(), null);
    assert.equal(failed.window.location.search, handed(JOURNEYS));

    // its own app, for both apps: written and handed over once
    const asset = shell('', { current: OTHER, carried: KEPT, search: handed(APP) });
    assert.equal(asset.window.location.search, handed(link(OTHER, '123')));
    assert.deepEqual(await asset.send({ type: WANTED }), { asset: '123' });
    const view = shell('#app/Email', { current: OTHER, carried: KEPT_VIEW });
    assert.equal(view.hash(), emailLink(OTHER, VIEW));
    assert.deepEqual(await view.send({ type: EMAIL_WANTED }), { target: VIEW });
});

test('the link of the address that the page was handed is no new link when the page writes that address', async () => {
    const SAID =
        'This link belongs to the business unit Northwind France (600). You are in Northwind Germany (500).';
    const at = shell('', { search: handed(link(OTHER, '123')) });
    await settle();
    assert.deepEqual(at.said(), [SAID]);
    at.click('Stay here');
    assert.equal(at.dialog(), null);
    // the page applies what it was handed
    await at.route(link(OTHER, '123'));
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.went, []);
    // once: the same link pasted later is a new one
    await at.route(APP);
    await at.route(link(OTHER, '123'));
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.deepEqual(at.said(), [SAID]);

    // a kept link that was written into that address, when the switch did not happen
    const failed = shell('', { carried: 'content-builder/600/123', search: handed(APP) });
    await settle();
    failed.click('Stay here');
    await failed.route(link(OTHER, '123'));
    assert.deepEqual(await failed.send({ type: WANTED }), { asset: null });
    assert.equal(failed.dialog(), null);

    // this business unit: the asset is handed over once, also after the page wrote the address
    const here = shell('', { search: handed(link(MID, '123')) });
    assert.deepEqual(await here.send({ type: WANTED }), { asset: '123' });
    await here.route(link(MID, '123'));
    assert.deepEqual(await here.send({ type: WANTED }), { asset: null });
    // another link that the page did not write is decided as before
    const pasted = shell('', { search: handed(link(OTHER, '123')) });
    await settle();
    pasted.click('Stay here');
    await pasted.route(link(OTHER, '456'));
    assert.deepEqual(await pasted.send({ type: WANTED }), { asset: null });
    assert.deepEqual(pasted.said(), [SAID]);
});

test('a kept link that is not whole names no address, and nothing is written', async () => {
    const { landing } = shell().helpers;
    assert.equal(landing({ app: 'content-builder', mid: OTHER, what: '123' }), link(OTHER, '123'));
    assert.equal(landing({ app: 'email-studio', mid: OTHER, what: VIEW }), emailLink(OTHER, VIEW));
    assert.equal(
        landing({ app: 'email-studio', mid: OTHER, what: 'r.Content.email.12' }),
        emailLink(OTHER, 'r.Content.email.12', 'Content'),
    );
    for (const broken of [
        { app: 'content-builder', mid: OTHER, what: '12a' },
        { app: 'content-builder', mid: OTHER, what: '' },
        { app: 'content-builder', mid: OTHER, what: VIEW },
        { app: 'content-builder', mid: 'x', what: '123' },
        { app: 'content-builder', mid: '', what: '123' },
        { app: 'content-builder', mid: '1234567890123456', what: '123' },
        { app: 'content-builder', mid: OTHER, what: '123/../x' },
        { app: 'content-builder', mid: OTHER },
        { app: 'another-app', mid: OTHER, what: VIEW },
        { mid: OTHER, what: VIEW },
        { app: 'email-studio', mid: OTHER, what: '123' },
        { app: 'email-studio', mid: OTHER, what: 'r.a.b' },
        { app: 'email-studio', mid: OTHER, what: `${VIEW}&x=1` },
        { app: 'email-studio', mid: OTHER, what: `${VIEW}%23Other` },
        { app: 'email-studio', mid: OTHER, what: 'r.Sub/scribers.lists.12' },
        { app: 'email-studio', mid: OTHER },
    ]) {
        assert.equal(landing(broken), undefined, JSON.stringify(broken));
    }
    // a view of a business unit that is no id: the address names none
    for (const mid of ['x', '', '1234567890123456', undefined]) {
        assert.equal(
            landing({ app: 'email-studio', mid, what: VIEW }),
            `${EMAIL}%23Subscribers`,
            String(mid),
        );
    }

    // what the session storage holds in another form is thrown away and written nowhere
    for (const carried of [
        '',
        '600/123',
        'content-builder/600/12a',
        'content-builder/x/123',
        `content-builder/600/${VIEW}`,
        'email-studio/600/123',
        'email-studio/600/r.a.b',
        `email-studio/600/${VIEW}&h=https://example.com`,
        `email-studio/600/${VIEW}%23x`,
        'another-app/600/123',
        'https://example.com/',
        'javascript:alert(1)',
    ]) {
        const handedOver = shell('', { current: OTHER, carried, search: handed(APP) });
        assert.equal(handedOver.kept(), null, carried);
        assert.equal(handedOver.window.location.search, handed(APP), carried);
        assert.equal(handedOver.hash(), '', carried);
        const routed = shell(APP, { current: OTHER, carried });
        assert.equal(routed.kept(), null, carried);
        assert.equal(routed.window.location.href, `${SHELL}?x=1${APP}`, carried);
        for (const at of [handedOver, routed]) {
            assert.deepEqual(await at.send({ type: WANTED }), { asset: null }, carried);
            assert.deepEqual(await at.send({ type: EMAIL_WANTED }), { target: null }, carried);
            assert.equal(at.dialog(), null, carried);
            assert.deepEqual(at.went, []);
        }
    }
});

test('“Switch and open” goes to the plain address of the app, for both apps: the link itself travels in the tab’s session storage', async () => {
    const { switchAddress, emailSwitchAddress } = shell().helpers;
    // whatever the link names, the address is the same for one business unit and app
    for (const asset of ['1', '123', '123456789012345']) {
        assert.equal(switchAddress(ORIGIN, OTHER, asset), switchTo(PLAIN_CONTENT_BUILDER));
    }
    for (const target of [VIEW, FOLDER, 'r.Subscribers.lists.12']) {
        assert.equal(emailSwitchAddress(ORIGIN, OTHER, target), switchTo(PLAIN_EMAIL));
    }
    // seen live: the page that switches the business unit wrote the ? of the address it was
    // given as %3F, and Email Studio then answered "not found". That cannot happen any more:
    // the address it is given has no query at all, and nothing of the link
    const LINKS = [
        [link(OTHER, '123'), 'content-builder/600/123', PLAIN_CONTENT_BUILDER],
        [emailLink(OTHER, VIEW), `email-studio/600/${VIEW}`, PLAIN_EMAIL],
        [
            emailLink(OTHER, FOLDER, 'Subscribers/CustomObjects/4711'),
            `email-studio/600/${FOLDER}`,
            PLAIN_EMAIL,
        ],
    ];
    for (const [hash, kept, app] of LINKS) {
        const at = shell(hash);
        await settle();
        at.click('Switch and open');
        assert.equal(at.went.length, 1, hash);
        const to = new URL(at.went[0]);
        assert.equal(to.origin + to.pathname, SWITCH);
        assert.deepEqual(to.searchParams.keys().toArray(), ['m', 'h']);
        assert.equal(to.searchParams.get('m'), OTHER);
        const opened = to.searchParams.get('h');
        assert.equal(opened, app, hash);
        assert.equal(new URL(opened).search, '');
        assert.doesNotMatch(opened, /\?|%3F|ux-tools|Default\.aspx|asset/i);
        assert.doesNotMatch(at.went[0], /%3F|%253F|ux-tools|Default\.aspx|asset/i);
        // the link is kept for the page that opens after the switch
        assert.equal(at.kept(), kept);
    }
});

test('an address names a view of Email Studio only as one field of a fixed form in the address of its frame', () => {
    const { parseEmail, isEmailHash } = shell().helpers;
    const toView = parseEmail(emailLink(MID, VIEW));
    assert.deepEqual(plain(toView), { mid: MID, target: VIEW });
    const inFolder = parseEmail(emailLink(MID, FOLDER, 'Subscribers/CustomObjects/4711'));
    assert.deepEqual(plain(inFolder), { mid: MID, target: FOLDER });
    // wherever the field stands in the query, with or without a route inside Email Studio
    const PAGE = '#app/Email/C12/Default.aspx';
    for (const hash of [
        `${PAGE}?ux-tools=${MID}.${VIEW}`,
        `${PAGE}?ux-tools=${MID}.${VIEW}&ks=ks#Overview`,
        `${PAGE}?a=1&ux-tools=${MID}.${VIEW}&ks=ks%23Subscribers/customobject/1`,
    ]) {
        assert.deepEqual(plain(parseEmail(hash)), { mid: MID, target: VIEW }, hash);
    }
    for (const hash of [
        '',
        EMAIL,
        `${EMAIL}%23Subscribers`,
        // after the route inside Email Studio it is no field of the query
        `${EMAIL}%23Subscribers&ux-tools=${MID}.${VIEW}`,
        `${EMAIL}#Subscribers?ux-tools=${MID}.${VIEW}`,
        // another app, and other routes of Email Studio
        `#app/Content%20Builder/C12/Default.aspx?ux-tools=${MID}.${VIEW}`,
        `#app/Email/?ux-tools=${MID}.${VIEW}`,
        `#app/Email/C12/Other.aspx?ux-tools=${MID}.${VIEW}`,
        `${PAGE}x?ux-tools=${MID}.${VIEW}`,
        `${PAGE}/?ux-tools=${MID}.${VIEW}`,
        `app/Email/C12/Default.aspx?ux-tools=${MID}.${VIEW}`,
        // a page of Email Studio instead of a route, which no link may name
        field(`${MID}.p.Subscribers.customobject.1`),
        field(`${MID}.p./Content/Admin.aspx`),
        // not the fixed form
        field(''),
        field(MID),
        field(VIEW),
        field(`${MID}.r.Subscribers.customobject`),
        field(`${MID}.r.Subscribers.customobject.1.2`),
        field(`${MID}.r.Subscribers/customobject/1`),
        field(`${MID}.r..customobject.1`),
        field(`${MID}.r.Subscribers.customobject.-1`),
        field(`${MID}.r.Subscribers.customobject.xyz`),
        field(`${MID}.r.Subscribers.custom-object.1`),
        field(`${MID}.r.Subscribers.customobject.${'1'.repeat(37)}`),
        field(`${MID}.r.${'a'.repeat(31)}.customobject.1`),
        field(`${MID}.r.Sub<b>.customobject.1`),
        field(`${MID}.r.Subscribers.customobject.1/`),
        field(`${MID}.%72.Subscribers.customobject.1`),
        field(`5a.${VIEW}`),
        field(`.${VIEW}`),
        field(`1234567890123456.${VIEW}`),
        field(`${MID}.${VIEW} `),
        `${EMAIL}&ux-toolsx=${MID}.${VIEW}`,
        `${EMAIL}&xux-tools=${MID}.${VIEW}`,
        undefined,
        null,
        7,
    ]) {
        assert.equal(parseEmail(hash), null, String(hash));
    }
    for (const hash of ['#app/Email', '#app/Email/', EMAIL, emailLink(MID, VIEW)]) {
        assert.equal(isEmailHash(hash), true, hash);
    }
    for (const hash of ['', '#app/EmailX/', '#app/Emails', APP, '#home', undefined, null]) {
        assert.equal(isEmailHash(hash), false, String(hash));
    }
});

test('the address of a view of Email Studio keeps everything else of the address, and takes nothing but the fixed form', () => {
    const { emailAddress, emailSwitchAddress } = shell().helpers;
    const PAGE = '#app/Email/C12/Default.aspx';
    const INNER = 'Subscribers/customobject/1';
    assert.equal(
        emailAddress('/cloud/', '?x=1', `${EMAIL}%23Subscribers`, MID, VIEW),
        `/cloud/?x=1${emailLink(MID, VIEW)}`,
    );
    // instead of the one that was there, and with the route inside Email Studio as it is
    assert.equal(
        emailAddress('/cloud/', '', emailLink(OTHER, FOLDER, INNER), MID, VIEW),
        `/cloud/${emailLink(MID, VIEW, INNER)}`,
    );
    assert.equal(
        emailAddress('/cloud/', '', PAGE, MID, VIEW),
        `/cloud/${PAGE}?ux-tools=${MID}.${VIEW}`,
    );
    // no view: the field goes, and nothing else
    assert.equal(
        emailAddress('/cloud/', '', emailLink(MID, VIEW), MID, null),
        `/cloud/${EMAIL}%23Subscribers`,
    );
    assert.equal(
        emailAddress('/cloud/', '', `${PAGE}?ux-tools=1.r.a.b.1`, MID, null),
        `/cloud/${PAGE}`,
    );
    assert.equal(
        emailAddress('/cloud/', '', `${PAGE}?ux-tools=1&a=1&ux-tools=2#Overview`, MID, null),
        `/cloud/${PAGE}?a=1#Overview`,
    );
    for (const odd of [undefined, '', 'abc', '5a', 7, {}, `${MID}.${VIEW}`, 'r.a.b', 'p.a.b.1']) {
        // a view without its business unit is no link, and neither is anything of another form
        assert.equal(
            emailAddress('/cloud/', '', emailLink(MID, VIEW), odd, VIEW),
            `/cloud/${EMAIL}%23Subscribers`,
            String(odd),
        );
        assert.equal(
            emailAddress('/cloud/', '', emailLink(MID, VIEW), MID, odd),
            `/cloud/${EMAIL}%23Subscribers`,
            String(odd),
        );
        assert.equal(emailSwitchAddress(ORIGIN, odd, VIEW), undefined);
        assert.equal(emailSwitchAddress(ORIGIN, MID, odd), undefined);
    }
    // any other route is not written at all
    for (const hash of ['', APP, '#app/Email/', '#app/Email/other', `${PAGE}x`, undefined]) {
        assert.equal(emailAddress('/cloud/', '', hash, MID, VIEW), undefined, String(hash));
    }
    // to Email Studio itself, without the view
    assert.equal(
        emailSwitchAddress(ORIGIN, OTHER, VIEW),
        'https://mc.s7.exacttarget.com/cloud/context-switch.html?m=600&h=https%3A%2F%2Fmc.s7.exacttarget.com%2Fcloud%2F%23app%2FEmail',
    );
});

test('the page hands the view of a link of this business unit to Email Studio once, and to Email Studio only', async () => {
    const at = shell(emailLink(MID, VIEW));
    // Content Builder's frame does not get it and does not use it up
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.equal(await at.send({ type: EMAIL_WANTED }, { id: 'another-extension' }), undefined);
    assert.deepEqual(await at.send({ type: EMAIL_WANTED }), { target: VIEW });
    assert.deepEqual(await at.send({ type: EMAIL_WANTED }), { target: null });
    // asking changes nothing in the address, and no dialog is shown
    assert.equal(at.hash(), emailLink(MID, VIEW));
    assert.equal(at.dialog(), null);

    // a link to an asset is not handed to Email Studio
    const asset = shell(`${MARKER}123`);
    assert.deepEqual(await asset.send({ type: EMAIL_WANTED }), { target: null });
    assert.deepEqual(await asset.send({ type: WANTED }), { asset: '123' });
    // no link at all
    const none = shell(`${EMAIL}%23Overview`);
    assert.deepEqual(await none.send({ type: EMAIL_WANTED }), { target: null });
    assert.equal(none.dialog(), null);
    // the business unit cannot be read: not followed
    const blind = shell(emailLink(MID, VIEW), { isDown: true });
    await blind.elapse(CURRENT_WAIT);
    assert.deepEqual(await blind.send({ type: EMAIL_WANTED }), { target: null });
    assert.deepEqual(blind.buttons(), ['Close']);
});

test('a link into Email Studio of another business unit leads to the same dialog, which is shown once', async () => {
    const SAID =
        'This link belongs to the business unit Northwind France (600). You are in Northwind Germany (500).';
    const at = shell(emailLink(OTHER, VIEW));
    await settle();
    // before Email Studio asked anything
    assert.deepEqual(at.said(), [SAID]);
    // the dialog speaks of the link, not of an asset
    assert.equal(at.dialog().querySelector('h2').textContent, 'Link to another business unit');
    assert.doesNotMatch(at.dialog().textContent, /asset/i);
    assert.deepEqual(await at.send({ type: EMAIL_WANTED }), { target: null });
    assert.equal(at.window.document.querySelectorAll('dialog').length, 1);
    at.click('Stay here');
    assert.deepEqual(at.went, []);
    // the page writes the address of Email Studio's frame into its own, with the link that
    // frame was loaded with: that is no new link
    await at.route(emailLink(OTHER, VIEW, 'Overview'));
    assert.deepEqual(await at.send({ type: EMAIL_WANTED }), { target: null });
    assert.equal(at.dialog(), null);

    // another link pasted into the open page is decided anew
    await at.route(emailLink(OTHER, FOLDER));
    assert.deepEqual(await at.send({ type: EMAIL_WANTED }), { target: null });
    assert.deepEqual(at.said(), [SAID]);
    at.click('Switch and open');
    assert.deepEqual(at.went, [switchTo(PLAIN_EMAIL)]);
    assert.equal(at.kept(), `email-studio/600/${FOLDER}`);
    // and so is the first one, once the page was in another app in between
    const back = shell(emailLink(OTHER, VIEW));
    await settle();
    back.click('Stay here');
    await back.route(APP);
    await back.route(emailLink(OTHER, VIEW));
    assert.deepEqual(await back.send({ type: EMAIL_WANTED }), { target: null });
    assert.deepEqual(back.said(), [SAID]);

    const lost = shell(emailLink(NOWHERE, VIEW));
    await settle();
    assert.match(lost.said()[0], /^The business unit 999 of this link does not exist/);
    assert.deepEqual(lost.buttons(), ['Close']);
});

test('the view that Email Studio shows is written into its address with the business unit, and only there', async () => {
    const PLAIN = `${EMAIL}%23Subscribers`;
    const at = shell(PLAIN);
    let routed = 0;
    at.window.addEventListener('hashchange', () => routed++);
    const state = { kept: true };
    at.window.history.replaceState(state, '');

    // the frame is told what was written, to write the same into its own address
    assert.deepEqual(await at.send({ type: EMAIL_SHOWN, target: VIEW }), {
        parameter: `${MID}.${VIEW}`,
    });
    assert.equal(at.window.location.href, `${SHELL}?x=1${emailLink(MID, VIEW)}`);
    assert.deepEqual(await at.send({ type: EMAIL_SHOWN, target: FOLDER }), {
        parameter: `${MID}.${FOLDER}`,
    });
    assert.equal(at.hash(), emailLink(MID, FOLDER));
    // the business unit is read each time: it may have been switched in another tab
    // (and once for the load of the page)
    assert.equal(at.currentReads(), 3);
    at.account.current = OTHER;
    await at.send({ type: EMAIL_SHOWN, target: VIEW });
    assert.equal(at.hash(), emailLink(OTHER, VIEW));
    // a business unit that cannot be read: no link, because one without it would be wrong
    at.account.current = null;
    assert.deepEqual(await at.send({ type: EMAIL_SHOWN, target: FOLDER }), { parameter: null });
    assert.equal(at.hash(), PLAIN);
    at.account.current = MID;
    // nothing more specific than the section is open, for which nothing is read
    await at.send({ type: EMAIL_SHOWN, target: VIEW });
    const reads = at.currentReads();
    assert.deepEqual(await at.send({ type: EMAIL_SHOWN, target: null }), { parameter: null });
    assert.equal(at.hash(), PLAIN);
    assert.equal(at.currentReads(), reads);
    // whatever is not of the fixed form is no view
    for (const target of [
        'r.a.b',
        'p.Subscribers.customobject.1',
        'Subscribers/customobject/1',
        `${MID}.${VIEW}`,
        'r.Subscribers.customobject.<b>',
        7,
        {},
        undefined,
    ]) {
        await at.send({ type: EMAIL_SHOWN, target: VIEW });
        assert.deepEqual(await at.send({ type: EMAIL_SHOWN, target }), { parameter: null });
        assert.equal(at.hash(), PLAIN, String(target));
    }
    // from anyone but the background script nothing is written
    await at.send({ type: EMAIL_SHOWN, target: VIEW }, { id: 'another-extension' });
    await at.send({ type: EMAIL_SHOWN, target: VIEW }, { id: EXTENSION, tab: { id: 7 } });
    assert.equal(at.hash(), PLAIN);
    assert.equal(routed, 0);
    assert.deepEqual(at.window.history.state, state);

    // another app's address is never touched, and neither is a route of Email Studio that
    // does not hold the address of its frame
    for (const hash of [APP, '#app/Journey%20Builder/', '', '#app/Email/', '#app/Email/other']) {
        const other = shell(hash);
        assert.deepEqual(await other.send({ type: EMAIL_SHOWN, target: VIEW }), {
            parameter: null,
        });
        assert.equal(other.hash(), hash);
    }
});

test('the page keeps the view in the address when it writes the address of Email Studio’s frame over it', async () => {
    const INNER = 'Subscribers/customobject/1';
    const at = shell(`${EMAIL}%23Subscribers`);
    await at.send({ type: EMAIL_SHOWN, target: VIEW });
    // without the field, and with the route inside Email Studio that the frame has now
    await at.route(`${EMAIL}%23${INNER}`);
    assert.equal(at.hash(), emailLink(MID, VIEW, INNER));
    // with what this script wrote itself: left as it is, and no new link
    await at.route(emailLink(MID, VIEW, 'Overview'));
    assert.equal(at.hash(), emailLink(MID, VIEW, 'Overview'));
    assert.deepEqual(await at.send({ type: EMAIL_WANTED }), { target: null });
    // written again with the business unit as it is then
    at.account.current = OTHER;
    await at.route(`${EMAIL}%23Subscribers`);
    assert.equal(at.hash(), emailLink(OTHER, VIEW));
    at.account.current = MID;
    await at.route(`${EMAIL}%23Subscribers`);
    // a message of Content Builder's frame, which may still be going away, changes nothing
    await at.send({ type: SHOWN, asset: '123' });
    await at.send({ type: SHOWN, asset: null });
    await at.route(`${EMAIL}%23Overview`);
    assert.equal(at.hash(), emailLink(MID, VIEW, 'Overview'));

    // forgotten once nothing more specific than the section is shown
    await at.send({ type: EMAIL_SHOWN, target: null });
    await at.route(`${EMAIL}%23Admin`);
    assert.equal(at.hash(), `${EMAIL}%23Admin`);
    // forgotten once the page left Email Studio
    await at.send({ type: EMAIL_SHOWN, target: VIEW });
    await at.route(APP);
    assert.equal(at.hash(), APP);
    await at.route(`${EMAIL}%23Overview`);
    assert.equal(at.hash(), `${EMAIL}%23Overview`);
    // and Content Builder's asset is not kept in Email Studio's address either
    await at.route(APP);
    await at.send({ type: SHOWN, asset: '123' });
    assert.equal(at.hash(), `${MARKER}123`);
    await at.route(`${EMAIL}%23Overview`);
    assert.equal(at.hash(), `${EMAIL}%23Overview`);
    await at.route(APP);
    assert.equal(at.hash(), APP);
});

test('the background script passes Email Studio’s two messages from its frame only, with a view of the fixed form', async () => {
    const FRAME = {
        id: EXTENSION,
        tab: { id: 7 },
        frameId: 3,
        documentId: 'A1',
        url: 'https://members.s7.exacttarget.com/C12/Default.aspx?entityType=none&entityID=0&ks=ks#Subscribers',
    };
    const CONTENT_BUILDER = { ...FRAME, url: 'https://content-builder.s7.marketingcloudapps.com/' };
    const { send, passed } = background((message) =>
        message.type === EMAIL_WANTED ? { target: VIEW } : { parameter: `${MID}.${VIEW}` },
    );
    assert.deepEqual(await send({ type: EMAIL_WANTED, target: 'x', more: 1 }, FRAME), {
        target: VIEW,
    });
    assert.deepEqual(await send({ type: EMAIL_SHOWN, target: VIEW, more: 1 }, FRAME), {
        parameter: `${MID}.${VIEW}`,
    });
    // to the page only, and with nothing but the type and the view
    assert.deepEqual(passed, [
        { tabId: 7, message: { type: EMAIL_WANTED }, options: { frameId: 0 } },
        { tabId: 7, message: { type: EMAIL_SHOWN, target: VIEW }, options: { frameId: 0 } },
    ]);
    // what is not of the fixed form is passed on as no view
    for (const target of [
        null,
        undefined,
        '',
        'r.a.b',
        `${MID}.${VIEW}`,
        'p.Subscribers.customobject.1',
        'r.Subscribers.customobject.1/../x',
        'r.Subscribers.customobject.<img src=x>',
        `${VIEW}\n`,
        7,
        { r: 1 },
        [VIEW],
    ]) {
        await send({ type: EMAIL_SHOWN, target }, FRAME);
        assert.deepEqual(passed.at(-1).message, { type: EMAIL_SHOWN, target: null });
    }
    // and so is the asset of Content Builder's frame
    await send({ type: SHOWN, asset: '12a' }, CONTENT_BUILDER);
    assert.deepEqual(passed.at(-1).message, { type: SHOWN, asset: null });
    const count = passed.length;

    for (const other of [
        { id: 'another-extension' },
        { tab: undefined },
        { frameId: 0 },
        { frameId: undefined },
        { url: undefined },
        { url: 'not an address' },
        // Content Builder's frame, the Marketing Cloud page, and other pages of the same host
        { url: CONTENT_BUILDER.url },
        { url: 'https://mc.s7.exacttarget.com/C12/Default.aspx' },
        { url: 'https://members.s7.exacttarget.com/C12/Other.aspx' },
        { url: 'https://members.s7.exacttarget.com/cloud/C12/Default.aspx' },
        { url: 'https://members.s7.exacttarget.com/C12/Default.aspx/x' },
        { url: FRAME.url.replace('https:', 'http:') },
        { url: 'https://members.s7.exacttarget.com.example.org/C12/Default.aspx' },
        { url: 'https://example.org/C12/Default.aspx?x=members.s7.exacttarget.com' },
        { url: 'https://members.example.org/C12/Default.aspx#.exacttarget.com' },
    ]) {
        for (const type of [EMAIL_WANTED, EMAIL_SHOWN]) {
            const sender = { ...FRAME, ...other };
            assert.equal(send({ type, target: VIEW }, sender), false, JSON.stringify(other));
        }
    }
    // each app's messages are taken from that app's frame only
    assert.equal(send({ type: WANTED }, FRAME), false);
    assert.equal(send({ type: SHOWN, asset: '1' }, FRAME), false);
    assert.equal(send({ type: EMAIL_WANTED }, CONTENT_BUILDER), false);
    assert.equal(send({ type: EMAIL_SHOWN, target: VIEW }, CONTENT_BUILDER), false);
    assert.equal(passed.length, count);
});

// Contact Builder: the message of its frame, its plain route on the Marketing Cloud page, and the
// routes inside it of a made-up data extension and of the list of data extensions
const CONTACT_SHOWN = 'sfmc-ux-tools:deep-link:contact-shown';
const CONTACT = '#app/Contact%20Builder';
const PLAIN_CONTACT = `${SHELL}${CONTACT}`;
const CONTACT_PAGE = `${CONTACT}/contactsmeta/admin.html`;
const OPENED = 'admin/data-extension/0a1b2c3d-0000-4000-8000-00000000abcd/properties/';
const LISTED = 'admin/data-extension/';
// the longest route inside Contact Builder that is taken for one
const MOST_ROUTE = 200;
/**
 * Writes the route of the Marketing Cloud page that opens a route of Contact Builder, with the
 * business unit.
 *
 * @param {string} mid id of the business unit
 * @param {string} route the route inside Contact Builder
 * @returns {string} the route of the page
 */
const contactLink = (mid, route) => `${CONTACT_PAGE}?ux-tools=${mid}%23${route}`;
/**
 * Writes the same without a business unit, which is Marketing Cloud's own form.
 *
 * @param {string} route the route inside Contact Builder
 * @returns {string} the route of the page
 */
const contactBare = (route) => `${CONTACT_PAGE}%23${route}`;
// what is no route inside Contact Builder
const NO_ROUTES = [
    '',
    'admin/data extension',
    'admin?x=1',
    'admin&x=1',
    'admin#other',
    'admin%2Fx',
    'javascript:alert(1)',
    'https://example.com/',
    '<img src=x onerror=alert(1)>',
    'a'.repeat(MOST_ROUTE + 1),
];
const SAID_OTHER =
    'This link belongs to the business unit Northwind France (600). You are in Northwind Germany (500).';

test('an address names a route of Contact Builder with its business unit only in Marketing Cloud’s own form with one field', () => {
    const { parseContact, isContactBuilderHash, contactAddress, contactSwitchAddress } =
        shell().helpers;
    const WHOLE = contactLink(MID, OPENED);
    assert.deepEqual(plain(parseContact(WHOLE)), { mid: MID, route: OPENED });
    const LONGEST_MID = contactLink('123456789012345', 'a');
    assert.deepEqual(plain(parseContact(LONGEST_MID)), { mid: '123456789012345', route: 'a' });
    // as a person may type it
    assert.deepEqual(
        plain(parseContact('#app/Contact Builder/contactsmeta/admin.html?ux-tools=7#admin/x')),
        { mid: '7', route: 'admin/x' },
    );
    const LONGEST_ROUTE = contactLink(MID, 'a'.repeat(MOST_ROUTE));
    assert.equal(parseContact(LONGEST_ROUTE).route.length, MOST_ROUTE);
    for (const hash of [
        '',
        CONTACT,
        `${CONTACT}/`,
        CONTACT_PAGE,
        // Marketing Cloud's own form without the field: no link that is checked
        contactBare(OPENED),
        // no business unit of digits
        contactLink('', OPENED),
        contactLink('12a', OPENED),
        contactLink('-5', OPENED),
        contactLink('1234567890123456', OPENED),
        contactLink('<img src=x onerror=alert(1)>', OPENED),
        // no route of the form
        ...NO_ROUTES.map((route) => contactLink(MID, route)),
        // more fields, another field, another document, another app
        `${CONTACT_PAGE}?ux-tools=${MID}&x=1%23${OPENED}`,
        `${CONTACT_PAGE}?x=1&ux-tools=${MID}%23${OPENED}`,
        `${CONTACT_PAGE}?other=${MID}%23${OPENED}`,
        `${CONTACT}/contactsmeta/other.html?ux-tools=${MID}%23${OPENED}`,
        `${CONTACT}/contactsmeta/adminXhtml?ux-tools=${MID}%23${OPENED}`,
        `${CONTACT}/admin.html?ux-tools=${MID}%23${OPENED}`,
        `#app/Email/contactsmeta/admin.html?ux-tools=${MID}%23${OPENED}`,
        `#app/Contact%20BuilderX/contactsmeta/admin.html?ux-tools=${MID}%23${OPENED}`,
        contactLink(MID, OPENED).slice(1),
        ` ${contactLink(MID, OPENED)}`,
        `${contactLink(MID, OPENED)}\n`,
        undefined,
        null,
        5,
    ]) {
        assert.equal(parseContact(hash), null, String(hash));
    }

    for (const hash of [
        CONTACT,
        `${CONTACT}/`,
        '#app/Contact Builder',
        contactBare(OPENED),
        contactLink(MID, OPENED),
        `${CONTACT}/anything/else`,
    ]) {
        assert.equal(isContactBuilderHash(hash), true, hash);
    }
    for (const hash of [
        '',
        '#',
        APP,
        '#app/Email',
        '#app/Contact%20BuilderX',
        '#app/Contact%20Builder%20Two/',
        '#app/Contacts',
        `#app/Journey%20Builder/${CONTACT}`,
        undefined,
        null,
    ]) {
        assert.equal(isContactBuilderHash(hash), false, String(hash));
    }

    // the address keeps the path and the query of the page
    assert.equal(
        contactAddress('/cloud/', '?x=1', MID, OPENED),
        `/cloud/?x=1${CONTACT}/contactsmeta/admin.html?ux-tools=500%23${OPENED}`,
    );
    // without a business unit of digits: Marketing Cloud's own form, with the path of the frame
    for (const mid of [undefined, null, '', '12a', '1234567890123456', 500, {}]) {
        assert.equal(
            contactAddress('/cloud/', '', mid, OPENED),
            `/cloud/${CONTACT}/contactsmeta/admin.html%23${OPENED}`,
            String(mid),
        );
        assert.equal(contactSwitchAddress(ORIGIN, mid, OPENED), undefined);
    }
    // without a route of the form: Contact Builder's plain address
    for (const route of [...NO_ROUTES, undefined, null, 5, {}, ['admin']]) {
        assert.equal(contactAddress('/cloud/', '?x=1', MID, route), `/cloud/?x=1${CONTACT}`);
        assert.equal(contactSwitchAddress(ORIGIN, OTHER, route), undefined);
    }
    // to Contact Builder itself, without the route
    assert.equal(contactSwitchAddress(ORIGIN, OTHER, OPENED), switchTo(PLAIN_CONTACT));
});

test('the route that Contact Builder shows is written into its address with the business unit, without routing again, and only there', async () => {
    const at = shell(CONTACT);
    let routed = 0;
    at.window.addEventListener('hashchange', () => routed++);
    const state = { kept: true };
    at.window.history.replaceState(state, '');

    assert.deepEqual(await at.send({ type: CONTACT_SHOWN, route: OPENED }), {});
    assert.equal(
        at.window.location.href,
        `${SHELL}?x=1#app/Contact%20Builder/contactsmeta/admin.html?ux-tools=500%23${OPENED}`,
    );
    await at.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(at.hash(), contactLink(MID, LISTED));
    // the business unit is read each time: it may have been switched in another tab
    // (and once for the load of the page)
    assert.equal(at.currentReads(), 3);
    at.account.current = OTHER;
    await at.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(at.hash(), contactLink(OTHER, OPENED));
    // a business unit that cannot be read: the link is written without it, in Marketing
    // Cloud's own form
    at.account.current = null;
    await at.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(
        at.hash(),
        `#app/Contact%20Builder/contactsmeta/admin.html%23admin/data-extension/`,
    );
    at.account.current = MID;
    // no route any more, for which nothing is read
    const reads = at.currentReads();
    await at.send({ type: CONTACT_SHOWN, route: null });
    assert.equal(at.window.location.href, `${SHELL}?x=1${CONTACT}`);
    assert.equal(at.currentReads(), reads);
    // whatever is no route of the form resets the address
    for (const route of [...NO_ROUTES, undefined, 7, { route: OPENED }]) {
        await at.send({ type: CONTACT_SHOWN, route: OPENED });
        assert.equal(at.hash(), contactLink(MID, OPENED));
        await at.send({ type: CONTACT_SHOWN, route });
        assert.equal(at.hash(), CONTACT, String(route));
    }
    // a route that was left before its business unit was read is not written
    const first = at.send({ type: CONTACT_SHOWN, route: OPENED });
    const second = at.send({ type: CONTACT_SHOWN, route: null });
    await Promise.all([first, second]);
    assert.equal(at.hash(), CONTACT);
    // from anyone but the background script nothing is written
    await at.send({ type: CONTACT_SHOWN, route: OPENED }, { id: 'another-extension' });
    await at.send({ type: CONTACT_SHOWN, route: OPENED }, { id: EXTENSION, tab: { id: 7 } });
    assert.equal(at.hash(), CONTACT);
    assert.equal(routed, 0);
    assert.deepEqual(at.window.history.state, state);

    // whatever follows Contact Builder's route in the address, the route is written
    for (const start of [
        `${CONTACT}/`,
        '#app/Contact Builder',
        contactBare(LISTED),
        `${CONTACT}/anything`,
    ]) {
        const other = shell(start);
        await other.send({ type: CONTACT_SHOWN, route: OPENED });
        assert.equal(other.hash(), contactLink(MID, OPENED), start);
    }

    // another app's address is never touched, and nothing is read for it
    for (const hash of [
        APP,
        `${APP}something`,
        `${EMAIL}%23Subscribers`,
        '#app/Journey%20Builder/',
        '#app/Contact%20BuilderX',
        '',
        '#home',
    ]) {
        const other = shell(hash);
        await other.send({ type: CONTACT_SHOWN, route: OPENED });
        await other.send({ type: CONTACT_SHOWN, route: null });
        assert.equal(other.hash(), hash);
        // (read for the load of the page only)
        assert.equal(other.currentReads(), 1);
    }
    // and what the other two apps tell never touches Contact Builder's address
    const contact = shell(contactBare(LISTED));
    assert.deepEqual(await contact.send({ type: SHOWN, asset: '123' }), {});
    assert.deepEqual(await contact.send({ type: EMAIL_SHOWN, target: VIEW }), { parameter: null });
    assert.deepEqual(await contact.send({ type: WANTED }), { asset: null });
    assert.deepEqual(await contact.send({ type: EMAIL_WANTED }), { target: null });
    assert.equal(contact.hash(), contactBare(LISTED));
    assert.equal(contact.dialog(), null);
});

test('the page keeps the route in Contact Builder’s address when it resets that address, and forgets it with the app', async () => {
    const at = shell(CONTACT);
    // the reset before any route is shown stays as it is
    await at.route(`${CONTACT}/`);
    assert.equal(at.hash(), `${CONTACT}/`);

    await at.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(at.hash(), contactLink(MID, OPENED));
    await at.route(CONTACT);
    assert.equal(at.hash(), contactLink(MID, OPENED));
    await at.route(`${CONTACT}/`);
    assert.equal(at.hash(), contactLink(MID, OPENED));
    // written again with the business unit as it is then
    at.account.current = OTHER;
    await at.route(CONTACT);
    assert.equal(at.hash(), contactLink(OTHER, OPENED));
    at.account.current = MID;
    // another route of Contact Builder on the page is the page's own business
    await at.route(contactBare(LISTED));
    assert.equal(at.hash(), contactBare(LISTED));
    await at.route(`${CONTACT}/something`);
    assert.equal(at.hash(), `${CONTACT}/something`);

    // forgotten once no route is shown
    await at.send({ type: CONTACT_SHOWN, route: null });
    await at.route(`${CONTACT}/`);
    assert.equal(at.hash(), `${CONTACT}/`);

    // forgotten once the page left Contact Builder, for either of the other apps
    for (const other of [APP, '#app/Email', '#app/Journey%20Builder']) {
        await at.route(CONTACT);
        await at.send({ type: CONTACT_SHOWN, route: OPENED });
        assert.equal(at.hash(), contactLink(MID, OPENED));
        await at.route(other);
        assert.equal(at.hash(), other);
        // told while another app is open: nothing is written, and nothing kept for later
        await at.send({ type: CONTACT_SHOWN, route: OPENED });
        assert.equal(at.hash(), other);
        await at.route(CONTACT);
        assert.equal(at.hash(), CONTACT);
    }
    // an asset that Content Builder showed is not written into Contact Builder's address
    await at.route(APP);
    await at.send({ type: SHOWN, asset: '123' });
    assert.equal(at.hash(), `${MARKER}123`);
    await at.route(CONTACT);
    assert.equal(at.hash(), CONTACT);
    await at.send({ type: SHOWN, asset: '456' });
    assert.equal(at.hash(), CONTACT);
});

test('a link into Contact Builder that was left in the address and is of another business unit after all leads to the dialog, and its address is not written over', async () => {
    // the business unit that was read last is the link's, which it is no longer: the address
    // was left alone
    const STALE = { remembered: OTHER };
    const at = shell(contactLink(OTHER, OPENED), STALE);
    await settle();
    assert.deepEqual(at.said(), [SAID_OTHER]);
    assert.deepEqual(at.buttons(), ['Switch and open', 'Stay here']);
    assert.equal(at.window.document.querySelectorAll('dialog').length, 1);
    // seen live: Marketing Cloud opens the route in the business unit the user is in, and
    // Contact Builder's frame then tells it. The link keeps its own business unit meanwhile
    const reads = at.currentReads();
    await at.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(at.hash(), contactLink(OTHER, OPENED));
    assert.equal(at.currentReads(), reads);
    assert.deepEqual(at.went, []);
    // nothing is handed to any app
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.deepEqual(await at.send({ type: EMAIL_WANTED }), { target: null });
    // refused: the same route still does not get the business unit the user is in
    at.click('Stay here');
    assert.equal(at.dialog(), null);
    await at.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(at.hash(), contactLink(OTHER, OPENED));
    assert.equal(at.dialog(), null);
    // a later, different route is written as any other, and so is the first one after it
    await at.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(at.hash(), contactLink(MID, LISTED));
    await at.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(at.hash(), contactLink(MID, OPENED));
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.went, []);

    // told before the business unit the user is in is known: the link is not written over
    // either, and nothing is read for it
    const pending = shell(contactLink(OTHER, OPENED), { isCurrentHanging: true, ...STALE });
    await settle();
    assert.equal(pending.dialog(), null);
    await pending.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(pending.hash(), contactLink(OTHER, OPENED));
    // (asked for the load of the page and for the link only)
    assert.equal(pending.currentReads(), 2);
    await pending.elapse(CURRENT_WAIT);
    assert.deepEqual(pending.said(), [
        'This link belongs to the business unit Northwind France (600). The business unit you are in could not be read.',
    ]);
    assert.equal(pending.hash(), contactLink(OTHER, OPENED));

    // a business unit that the account does not have: the same dialog as for the other apps
    const nowhere = shell(contactLink(NOWHERE, OPENED), { remembered: NOWHERE });
    await settle();
    assert.match(nowhere.said()[0], /^The business unit 999 of this link does not exist/);
    assert.deepEqual(nowhere.buttons(), ['Close']);
    await nowhere.send({ type: CONTACT_SHOWN, route: OPENED });
    nowhere.click('Close');
    await nowhere.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(nowhere.hash(), contactLink(NOWHERE, OPENED));

    // the page drops the refused link from its address: what is shown is written again
    const dropped = shell(contactLink(OTHER, OPENED), STALE);
    await settle();
    await dropped.send({ type: CONTACT_SHOWN, route: OPENED });
    dropped.click('Stay here');
    await dropped.route(CONTACT);
    assert.equal(dropped.hash(), contactLink(MID, OPENED));
    // and leaving Contact Builder lets go of the link too
    const left = shell(contactLink(OTHER, OPENED), STALE);
    await settle();
    left.click('Stay here');
    await left.route(APP);
    await left.route(CONTACT);
    await left.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(left.hash(), contactLink(MID, OPENED));
});

test('a link into Contact Builder of this business unit, or without a business unit, is never asked about', async () => {
    const here = shell(contactLink(MID, OPENED), { remembered: MID });
    // the business unit that was read last is the link's: the address is left alone
    assert.equal(here.hash(), contactLink(MID, OPENED));
    await settle();
    assert.equal(here.reloads(), 0);
    assert.equal(here.pass(), null);
    assert.equal(here.dialog(), null);
    // read for the load of the page and for the link
    assert.equal(here.currentReads(), 2);
    assert.equal(here.waits(), 0);
    // nothing is handed over: Marketing Cloud opens the route itself
    assert.deepEqual(await here.send({ type: WANTED }), { asset: null });
    assert.deepEqual(await here.send({ type: EMAIL_WANTED }), { target: null });
    await here.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(here.hash(), contactLink(MID, OPENED));
    // from here on the address follows with the business unit as it is then
    here.account.current = OTHER;
    await here.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(here.hash(), contactLink(OTHER, LISTED));
    assert.equal(here.dialog(), null);
    // told before the business unit was known: left as it is, which is the same address
    const early = shell(contactLink(MID, OPENED), {
        isCurrentHanging: true,
        header: HEADER,
        remembered: MID,
    });
    await early.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(early.hash(), contactLink(MID, OPENED));
    assert.equal(early.dialog(), null);

    // Marketing Cloud's own form, and whatever is no link of the fixed form: not checked
    for (const hash of [
        contactBare(OPENED),
        contactLink('12a', OPENED),
        contactLink(OTHER, 'admin?x=1'),
        `${CONTACT_PAGE}?ux-tools=${OTHER}&x=1%23${OPENED}`,
        `${CONTACT_PAGE}?other=${OTHER}%23${OPENED}`,
    ]) {
        const bare = shell(hash);
        await bare.elapse(CURRENT_WAIT);
        assert.equal(bare.dialog(), null, hash);
        // (read for the load of the page only)
        assert.equal(bare.currentReads(), 1, hash);
        assert.deepEqual(bare.went, []);
        assert.equal(bare.hash(), hash);
    }
    // the address that the page was handed to open: decided as any other
    const handedOver = shell('', {
        search: handed(contactLink(OTHER, OPENED)),
        remembered: OTHER,
    });
    await settle();
    assert.deepEqual(handedOver.buttons(), ['Switch and open', 'Stay here']);
    handedOver.click('Stay here');
    // the page writes that address itself: no new link, and it is not written over
    await handedOver.route(contactLink(OTHER, OPENED));
    await settle();
    assert.equal(handedOver.dialog(), null);
    await handedOver.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(handedOver.hash(), contactLink(OTHER, OPENED));
    const own = shell('', { search: handed(contactLink(MID, OPENED)), remembered: MID });
    await settle();
    assert.equal(own.reloads(), 0);
    assert.equal(own.dialog(), null);
    assert.equal(own.window.location.search, handed(contactLink(MID, OPENED)));
});

test('a link into Contact Builder that is pasted into the open page is decided the same way, once', async () => {
    const at = shell(CONTACT);
    await at.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(at.hash(), contactLink(MID, LISTED));
    // another business unit: the dialog, and the route that was shown before is not written
    // over the link
    await at.route(contactLink(OTHER, OPENED));
    await settle();
    assert.deepEqual(at.said(), [SAID_OTHER]);
    assert.equal(at.hash(), contactLink(OTHER, OPENED));
    await at.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(at.hash(), contactLink(OTHER, OPENED));
    at.click('Stay here');
    // what this script wrote itself is no new link
    await at.send({ type: CONTACT_SHOWN, route: LISTED });
    await at.route(`${CONTACT}/`);
    await settle();
    assert.equal(at.hash(), contactLink(MID, LISTED));
    assert.equal(at.dialog(), null);
    // this business unit: no dialog
    await at.route(contactLink(MID, OPENED));
    await settle();
    assert.equal(at.dialog(), null);
    assert.equal(at.hash(), contactLink(MID, OPENED));
    // the business unit was switched in another tab: the link of the other one is fine now
    at.account.current = OTHER;
    await at.route(contactLink(OTHER, LISTED));
    await settle();
    assert.equal(at.dialog(), null);
    await at.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(at.hash(), contactLink(OTHER, LISTED));
    assert.deepEqual(at.went, []);
});

test('“Switch and open” carries a link into Contact Builder as a route, and the page after the switch writes it back', async () => {
    const KEPT = `contact-builder/600/${OPENED}`;
    const { landing } = shell().helpers;
    const at = shell(contactLink(OTHER, OPENED));
    await settle();
    assert.equal(at.kept(), null);
    at.click('Switch and open');
    assert.equal(at.kept(), KEPT);
    // to Contact Builder's plain address: the link itself travels in the session storage
    assert.deepEqual(at.went, [
        'https://mc.s7.exacttarget.com/cloud/context-switch.html?m=600&h=https%3A%2F%2Fmc.s7.exacttarget.com%2Fcloud%2F%23app%2FContact%2520Builder',
    ]);
    assert.doesNotMatch(at.went[0], /undefined|ux-tools|contactsmeta|admin/);

    assert.equal(
        landing({ app: 'contact-builder', mid: OTHER, what: OPENED }),
        contactLink(OTHER, OPENED),
    );
    for (const broken of [
        { app: 'contact-builder', mid: OTHER, what: '' },
        { app: 'contact-builder', mid: OTHER, what: 'admin?x=1' },
        { app: 'contact-builder', mid: OTHER, what: 'a'.repeat(MOST_ROUTE + 1) },
        { app: 'contact-builder', mid: OTHER },
        { app: 'contact-builder', mid: 'x', what: OPENED },
        { app: 'contact-builder', mid: '', what: OPENED },
        { app: 'contact-builder', what: OPENED },
        // no app of the three names no address, whatever it holds
        { app: 'contacts', mid: OTHER, what: OPENED },
        { app: 'another-app', mid: OTHER, what: '123' },
        { mid: OTHER, what: '123' },
    ]) {
        assert.equal(landing(broken), undefined, JSON.stringify(broken));
    }

    // the page after the switch was handed Contact Builder's plain address: the link is
    // written into it before the page reads it, and Marketing Cloud opens the route itself
    // (the business unit that was read last is the link's already; otherwise see the test below)
    const arrived = shell('', {
        current: OTHER,
        carried: KEPT,
        search: handed(CONTACT),
        remembered: OTHER,
    });
    assert.equal(arrived.window.location.search, handed(contactLink(OTHER, OPENED)));
    assert.equal(arrived.hash(), '');
    assert.equal(arrived.kept(), null);
    await settle();
    assert.equal(arrived.dialog(), null);
    // not handed an address: the link goes into the route
    const routed = shell(CONTACT, { current: OTHER, carried: KEPT, remembered: OTHER });
    assert.equal(routed.hash(), contactLink(OTHER, OPENED));
    assert.equal(routed.window.location.search, '?x=1');
    assert.equal(routed.kept(), null);
    await settle();
    assert.equal(routed.dialog(), null);
    await routed.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(routed.hash(), contactLink(OTHER, OPENED));
    assert.deepEqual(await routed.send({ type: WANTED }), { asset: null });
    assert.deepEqual(await routed.send({ type: EMAIL_WANTED }), { target: null });
    // the switch did not happen: the link that was written is decided as any other
    const failed = shell(CONTACT, { carried: KEPT, remembered: OTHER });
    await settle();
    assert.deepEqual(failed.buttons(), ['Switch and open', 'Stay here']);
    assert.equal(failed.hash(), contactLink(OTHER, OPENED));
    // the page that switches leaves the kept link for the page after it
    const switching = shell('', { path: '/cloud/context-switch.html', carried: KEPT });
    await settle();
    assert.equal(switching.kept(), KEPT);

    // a kept link is written into the address of its own app only
    for (const other of [APP, '#app/Email', '#app/Journey%20Builder']) {
        const crossed = shell(other, { current: OTHER, carried: KEPT });
        assert.equal(crossed.window.location.href, `${SHELL}?x=1${other}`);
        assert.equal(crossed.kept(), null);
        const handedOver = shell('', { current: OTHER, carried: KEPT, search: handed(other) });
        assert.equal(handedOver.window.location.search, handed(other));
        for (const page of [crossed, handedOver]) {
            await settle();
            assert.equal(page.dialog(), null, other);
            assert.deepEqual(await page.send({ type: WANTED }), { asset: null });
            assert.deepEqual(await page.send({ type: EMAIL_WANTED }), { target: null });
        }
    }
    for (const carried of ['content-builder/600/123', `email-studio/600/${VIEW}`]) {
        const crossed = shell(CONTACT, { current: OTHER, carried });
        assert.equal(crossed.hash(), CONTACT, carried);
        assert.equal(crossed.kept(), null);
        await settle();
        assert.equal(crossed.dialog(), null);
    }
    // what is kept is a link only with a route of the form; anything else is thrown away
    for (const carried of [
        'contact-builder/600/',
        'contact-builder/600/admin?x=1',
        'contact-builder/600/admin%23x',
        'contact-builder/600/admin data',
        'contact-builder/600/<img src=x>',
        `contact-builder/600/${'a'.repeat(MOST_ROUTE + 1)}`,
        'contact-builder/x/admin',
        'contact-builder//admin',
        'contacts/600/admin',
        ` ${KEPT}`,
        `${KEPT}\n`,
    ]) {
        const odd = shell(CONTACT, { current: OTHER, carried });
        assert.equal(odd.kept(), null, carried);
        assert.equal(odd.hash(), CONTACT, carried);
        await settle();
        assert.equal(odd.dialog(), null, carried);
    }
});

// the route that Contact Builder's frame tells on its start page
const START = 'admin/schema';

test('the route of a link into Contact Builder is taken out of the address unless the business unit that was read last is the link’s', async () => {
    const LINK = contactLink(OTHER, OPENED);
    // the same one: the address is left alone, in the route and in the address that was handed
    const same = shell(LINK, { remembered: OTHER, current: OTHER });
    assert.equal(same.window.location.href, `${SHELL}?x=1${LINK}`);
    const sameHanded = shell('', { search: handed(LINK), remembered: OTHER, current: OTHER });
    assert.equal(sameHanded.window.location.href, `${SHELL}${handed(LINK)}`);
    for (const page of [same, sameHanded]) {
        await settle();
        assert.equal(page.dialog(), null);
        assert.equal(page.reloads(), 0);
        assert.equal(page.pass(), null);
    }

    // another one, none, or what is no id: the route is taken out before the page reads it
    for (const remembered of [
        MID,
        undefined,
        '',
        '60',
        '6000',
        ' 600',
        '600\n',
        '6e2',
        '-600',
        '1234567890123456',
        'null',
        '{"mid":"600"}',
    ]) {
        const routed = shell(LINK, { remembered, isCurrentHanging: true });
        assert.equal(
            routed.window.location.href,
            'https://mc.s7.exacttarget.com/cloud/?x=1#app/Contact%20Builder',
            String(remembered),
        );
        const arrived = shell('', { search: handed(LINK), remembered, isCurrentHanging: true });
        assert.equal(
            arrived.window.location.href,
            'https://mc.s7.exacttarget.com/cloud/?hash=logged-inI2FwcC9Db250YWN0JTIwQnVpbGRlcg%3D%3D',
            String(remembered),
        );
        assert.equal(arrived.window.location.search, handed(CONTACT));
        // what else the query holds stays
        const more = shell('', {
            search: `?x=1&hash=logged-in${encode(LINK)}`,
            remembered,
            isCurrentHanging: true,
        });
        assert.equal(more.window.location.search, `?x=1&hash=logged-in${encode(CONTACT)}`);
    }
    // only a link with a business unit, and only Contact Builder's
    for (const hash of [
        contactBare(OPENED),
        contactLink('12a', OPENED),
        `${CONTACT_PAGE}?ux-tools=${OTHER}&x=1%23${OPENED}`,
        link(OTHER, '123'),
        emailLink(OTHER, VIEW),
    ]) {
        const other = shell(hash, { isCurrentHanging: true });
        assert.equal(other.hash(), hash);
        const arrived = shell('', { search: handed(hash), isCurrentHanging: true });
        assert.equal(arrived.window.location.search, handed(hash));
    }
    // the page that switches the business unit takes nothing out
    const switching = shell(LINK, { path: '/cloud/context-switch.html' });
    assert.equal(switching.hash(), LINK);

    // the business unit is kept whenever it was read: by the API, and by the page's header
    const read = shell(CONTACT);
    assert.equal(read.remembered(), null);
    await read.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(read.remembered(), MID);
    read.account.current = OTHER;
    await read.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(read.remembered(), OTHER);
    // one that could not be read leaves what was kept
    read.account.current = null;
    await read.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(read.remembered(), OTHER);
    const header = shell(link(MID, '123'), { isCurrentHanging: true, header: HEADER });
    await settle();
    assert.equal(header.remembered(), MID);
});

test('a link into Contact Builder of another business unit opens Contact Builder’s start page behind the dialog', async () => {
    const at = shell(contactLink(OTHER, OPENED), { remembered: MID });
    assert.equal(at.hash(), CONTACT);
    // seen live: Contact Builder opens its start page and its frame tells that route. Until
    // the user decided, nothing is written and nothing is read for it
    await at.send({ type: CONTACT_SHOWN, route: START });
    assert.equal(at.hash(), CONTACT);
    // the dialog comes after the business unit was read anew: for the load of the page and
    // for the link, not for what Contact Builder's frame told
    assert.equal(at.currentReads(), 2);
    assert.deepEqual(at.said(), [SAID_OTHER]);
    assert.deepEqual(at.buttons(), ['Switch and open', 'Stay here']);
    // the page writes its plain route: the link is still held
    await at.route(`${CONTACT}/`);
    assert.equal(at.hash(), `${CONTACT}/`);
    assert.equal(at.currentReads(), 2);
    assert.deepEqual(at.buttons(), ['Switch and open', 'Stay here']);
    // “Stay here” leaves Contact Builder as it is, and its address follows it from then on
    at.click('Stay here');
    await settle();
    assert.equal(at.dialog(), null);
    assert.equal(at.hash(), contactLink(MID, START));
    await at.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(at.hash(), contactLink(MID, LISTED));
    // also for the route of the link, which is now a route of the business unit the user is in
    await at.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(at.hash(), contactLink(MID, OPENED));
    assert.equal(at.reloads(), 0);
    assert.equal(at.pass(), null);
    assert.equal(at.kept(), null);
    assert.deepEqual(at.went, []);

    // nothing told yet: plain Contact Builder stays, and what is told later is followed
    const quiet = shell(contactLink(OTHER, OPENED));
    await settle();
    quiet.click('Stay here');
    await settle();
    assert.equal(quiet.window.location.href, `${SHELL}?x=1${CONTACT}`);
    await quiet.send({ type: CONTACT_SHOWN, route: START });
    assert.equal(quiet.hash(), contactLink(MID, START));

    // “Switch and open” carries the link, and nothing is written meanwhile
    const switched = shell(contactLink(OTHER, OPENED), { remembered: MID });
    await switched.send({ type: CONTACT_SHOWN, route: START });
    switched.click('Switch and open');
    assert.equal(switched.kept(), `contact-builder/600/${OPENED}`);
    assert.deepEqual(switched.went, [switchTo(PLAIN_CONTACT)]);
    await switched.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(switched.hash(), CONTACT);
    assert.equal(switched.reloads(), 0);

    // handed to the page to open: the same, in the query
    const arrived = shell('', { search: handed(contactLink(OTHER, OPENED)), remembered: MID });
    assert.equal(arrived.window.location.search, handed(CONTACT));
    await settle();
    assert.deepEqual(arrived.buttons(), ['Switch and open', 'Stay here']);
    // the page writes the address it was handed, which is no link
    await arrived.route(CONTACT);
    await arrived.send({ type: CONTACT_SHOWN, route: START });
    assert.equal(arrived.hash(), CONTACT);
    arrived.click('Stay here');
    await settle();
    assert.equal(arrived.hash(), contactLink(MID, START));
    // the same link pasted later is a new one
    await arrived.route(contactLink(OTHER, OPENED));
    await settle();
    assert.deepEqual(arrived.buttons(), ['Switch and open', 'Stay here']);

    // the address copied from a tab that arrived by login: a link in the route and one of
    // another business unit in the address that was handed over, which is what the page opens.
    // Both are plain before the page reads them, and the link that was handed over is held
    const both = shell(contactLink(MID, LISTED), {
        search: handed(contactLink(OTHER, OPENED)),
        remembered: MID,
    });
    assert.equal(both.window.location.search, handed(CONTACT));
    assert.equal(both.hash(), CONTACT);
    // the dialog comes after the business unit was read anew
    assert.equal(both.dialog(), null);
    await settle();
    assert.deepEqual(both.said(), [SAID_OTHER]);
    assert.deepEqual(both.buttons(), ['Switch and open', 'Stay here']);
    // the page writes the address it was handed, which is plain now: the link is still held
    await both.route(`${CONTACT}/`);
    await both.send({ type: CONTACT_SHOWN, route: START });
    assert.equal(both.hash(), `${CONTACT}/`);
    assert.deepEqual(both.buttons(), ['Switch and open', 'Stay here']);
    assert.equal(both.reloads(), 0);
    both.click('Switch and open');
    assert.equal(both.kept(), `contact-builder/600/${OPENED}`);

    // a business unit that the account does not have: “Close” lets go of the link too
    const nowhere = shell(contactLink(NOWHERE, OPENED), { remembered: MID });
    await nowhere.send({ type: CONTACT_SHOWN, route: START });
    assert.deepEqual(nowhere.buttons(), ['Close']);
    assert.equal(nowhere.hash(), CONTACT);
    nowhere.click('Close');
    await settle();
    assert.equal(nowhere.hash(), contactLink(MID, START));

    // the business unit cannot be read in time: held until then, and the dialog says so
    const pending = shell(contactLink(OTHER, OPENED), { isCurrentHanging: true });
    await pending.send({ type: CONTACT_SHOWN, route: START });
    assert.equal(pending.dialog(), null);
    assert.equal(pending.hash(), CONTACT);
    await pending.elapse(CURRENT_WAIT);
    assert.deepEqual(pending.buttons(), ['Switch and open', 'Stay here']);
    assert.equal(pending.hash(), CONTACT);
    assert.equal(pending.reloads(), 0);

    // the page leaves Contact Builder before the link is decided: the link is done with
    const left = shell(contactLink(OTHER, OPENED), { isCurrentHanging: true });
    await left.route(APP);
    await left.elapse(CURRENT_WAIT);
    assert.equal(left.dialog(), null);
    assert.equal(left.reloads(), 0);
    await left.route(CONTACT);
    left.account.isCurrentHanging = false;
    await left.send({ type: CONTACT_SHOWN, route: START });
    assert.equal(left.hash(), contactLink(MID, START));
});

test('a link into Contact Builder that turns out to be of this business unit is opened by loading the page again, once, with a pass', async () => {
    const LINK = contactLink(MID, OPENED);
    const KEY = `contact-builder/500/${OPENED}`;
    // nothing kept, or another business unit kept, of which the user is no longer in
    for (const remembered of [undefined, OTHER, 'x']) {
        const at = shell(LINK, { remembered });
        assert.equal(at.hash(), CONTACT);
        assert.equal(at.reloads(), 0);
        // told before the business unit was read: nothing is written
        const told = at.send({ type: CONTACT_SHOWN, route: START });
        assert.equal(at.hash(), CONTACT);
        await told;
        assert.equal(at.pass(), KEY);
        assert.equal(
            at.window.location.href,
            `https://mc.s7.exacttarget.com/cloud/?x=1#app/Contact%20Builder/contactsmeta/admin.html?ux-tools=500%23${OPENED}`,
        );
        assert.equal(at.reloads(), 1);
        assert.equal(at.remembered(), MID);
        assert.equal(at.dialog(), null);
        // until the page is gone nothing writes over the link, and it is loaded again once
        await at.send({ type: CONTACT_SHOWN, route: START });
        await at.route(LINK);
        await settle();
        assert.equal(at.hash(), LINK);
        assert.equal(at.reloads(), 1);
        // (read for the load of the page and for the link only)
        assert.equal(at.currentReads(), 2);
    }
    // handed to the page to open: the link goes back where it came from
    const arrived = shell('', { search: handed(LINK) });
    assert.equal(arrived.window.location.search, handed(CONTACT));
    await settle();
    assert.equal(arrived.window.location.href, `${SHELL}${handed(LINK)}`);
    assert.equal(arrived.pass(), KEY);
    assert.equal(arrived.reloads(), 1);
    // the page wrote its plain route meanwhile: that stays, the query is what it opens
    const written = shell('', { search: handed(LINK), isCurrentHanging: true, header: '' });
    await written.route(CONTACT);
    written.window.document.body.innerHTML = HEADER;
    await settle();
    assert.equal(written.window.location.href, `${SHELL}${handed(LINK)}${CONTACT}`);
    assert.equal(written.reloads(), 1);

    // the page that is loaded with the pass: the address is left alone and the pass is gone,
    // even when the business unit that is kept is another one
    for (const has of [
        { pass: KEY },
        { pass: KEY, remembered: OTHER },
        { pass: KEY, search: handed(LINK), hash: '' },
        { pass: KEY, search: handed(LINK), hash: CONTACT },
    ]) {
        const next = shell(has.hash ?? LINK, has);
        const before = `${SHELL}${has.search ?? '?x=1'}${has.hash ?? LINK}`;
        assert.equal(next.window.location.href, before);
        assert.equal(next.pass(), null);
        await settle();
        assert.equal(next.window.location.href, before);
        assert.equal(next.reloads(), 0);
        assert.equal(next.pass(), null);
        assert.equal(next.dialog(), null);
    }
    // from then on the address follows Contact Builder
    const next = shell(LINK, { pass: KEY });
    await next.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(next.hash(), LINK);
    await next.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(next.hash(), contactLink(MID, LISTED));
    // the business unit was switched meanwhile: the dialog, and never a second load
    const late = shell(LINK, { pass: KEY, current: OTHER });
    await settle();
    assert.equal(late.hash(), LINK);
    assert.equal(late.reloads(), 0);
    assert.equal(late.dialog() === null, false);

    // a pass for another link, or what is no pass, is removed and ignored
    for (const pass of [
        `contact-builder/500/${LISTED}`,
        `contact-builder/600/${OPENED}`,
        `content-builder/500/${OPENED}`,
        `${KEY} `,
        ` ${KEY}`,
        KEY.slice(0, -1),
        LINK,
        '',
        'true',
        '500',
        '<img src=x onerror=alert(1)>',
    ]) {
        const odd = shell(LINK, { pass, isCurrentHanging: true });
        assert.equal(odd.hash(), CONTACT, pass);
        assert.equal(odd.pass(), null, pass);
    }
    // a pass is used up by whatever page comes next, also one without a link
    for (const hash of [CONTACT, APP, '']) {
        const plainPage = shell(hash, { pass: KEY });
        assert.equal(plainPage.pass(), null);
        assert.equal(plainPage.hash(), hash);
    }
    // the page that switches the business unit leaves it
    const switching = shell(LINK, { path: '/cloud/context-switch.html', pass: KEY });
    assert.equal(switching.pass(), KEY);

    // after “Switch and open”: the link that was carried stays out of the address until the
    // switch is known to have happened, and is then opened the same way
    const KEPT = `contact-builder/600/${OPENED}`;
    const SWITCHED = contactLink(OTHER, OPENED);
    const carried = shell('', { current: OTHER, carried: KEPT, search: handed(CONTACT) });
    assert.equal(carried.window.location.search, handed(CONTACT));
    assert.equal(carried.kept(), null);
    await settle();
    assert.equal(carried.window.location.search, handed(SWITCHED));
    assert.equal(carried.pass(), KEPT);
    assert.equal(carried.reloads(), 1);
    const routed = shell(CONTACT, { current: OTHER, carried: KEPT, remembered: MID });
    assert.equal(routed.hash(), CONTACT);
    await settle();
    assert.equal(routed.hash(), SWITCHED);
    assert.equal(routed.reloads(), 1);
    // the switch did not happen: the dialog, over plain Contact Builder
    const failed = shell(CONTACT, { carried: KEPT, remembered: MID });
    await settle();
    assert.deepEqual(failed.buttons(), ['Switch and open', 'Stay here']);
    assert.equal(failed.hash(), CONTACT);
    assert.equal(failed.reloads(), 0);
});

test('the background script passes the route from Contact Builder’s frame only, and only a route of the form', async () => {
    const FRAME = {
        id: EXTENSION,
        tab: { id: 7 },
        frameId: 3,
        documentId: 'A1',
        url: 'https://mc.s7.marketingcloudapps.com/contactsmeta/admin.html?hub=1&ks=ks#admin/data-extension/',
    };
    const { send, passed } = background();
    assert.deepEqual(await send({ type: CONTACT_SHOWN, route: OPENED, more: 1 }, FRAME), {});
    assert.deepEqual(await send({ type: CONTACT_SHOWN, route: null }, FRAME), {});
    // to the page only, and with nothing but the type and the route
    assert.deepEqual(passed, [
        { tabId: 7, message: { type: CONTACT_SHOWN, route: OPENED }, options: { frameId: 0 } },
        { tabId: 7, message: { type: CONTACT_SHOWN, route: null }, options: { frameId: 0 } },
    ]);
    // the business unit the frame was loaded with changes nothing
    const linked = { ...FRAME, url: FRAME.url.replace('?', '?ux-tools=500&') };
    assert.deepEqual(await send({ type: CONTACT_SHOWN, route: LISTED }, linked), {});
    assert.deepEqual(passed.at(-1).message, { type: CONTACT_SHOWN, route: LISTED });
    // whatever is no route of the form is passed as none
    for (const route of [...NO_ROUTES, undefined, 7, {}, ['admin']]) {
        await send({ type: CONTACT_SHOWN, route }, FRAME);
        assert.deepEqual(
            passed.at(-1).message,
            { type: CONTACT_SHOWN, route: null },
            String(route),
        );
    }
    const count = passed.length;

    for (const other of [
        { id: 'another-extension' },
        { tab: undefined },
        { tab: {} },
        // the page itself, and a sender without a frame
        { frameId: 0 },
        { frameId: undefined },
        { url: undefined },
        { url: 'not an address' },
        // the right host, but not below Contact Builder's path
        { url: 'https://mc.s7.marketingcloudapps.com/' },
        { url: 'https://mc.s7.marketingcloudapps.com/contactsmeta' },
        { url: 'https://mc.s7.marketingcloudapps.com/contactsmetaX/admin.html' },
        { url: 'https://mc.s7.marketingcloudapps.com/x/contactsmeta/admin.html' },
        { url: 'https://mc.s7.marketingcloudapps.com/AutomationStudioFuel3/' },
        { url: 'https://mc.s7.marketingcloudapps.com/?x=/contactsmeta/admin.html' },
        { url: 'https://mc.s7.marketingcloudapps.com/#/contactsmeta/admin.html' },
        { url: 'https://content-builder.s7.marketingcloudapps.com/' },
        // the right path on another host, and without encryption
        { url: FRAME.url.replace('https:', 'http:') },
        { url: 'https://mc.s7.marketingcloudapps.com.example.org/contactsmeta/admin.html' },
        { url: 'https://example.org/contactsmeta/admin.html?x=.marketingcloudapps.com' },
        { url: 'https://mc.s7.exacttarget.com/contactsmeta/admin.html' },
        { url: 'https://members.s7.exacttarget.com/C12/Default.aspx' },
        { url: 'https://mc.s7.exacttarget.com/cloud/' },
    ]) {
        const sender = { ...FRAME, ...other };
        assert.equal(
            send({ type: CONTACT_SHOWN, route: OPENED }, sender),
            false,
            JSON.stringify(other),
        );
    }
    // Contact Builder's frame cannot speak for the other two apps
    for (const type of [WANTED, SHOWN, EMAIL_WANTED, EMAIL_SHOWN]) {
        assert.equal(send({ type, asset: '1', target: VIEW }, FRAME), false, type);
    }
    assert.equal(passed.length, count);

    // a page that does not listen: the frame gets no answer, and nothing breaks
    const deaf = background(() => {
        throw new Error('Could not establish connection');
    });
    assert.equal(await deaf.send({ type: CONTACT_SHOWN, route: OPENED }, FRAME), undefined);
});

// what the Marketing Cloud page asks of Content Builder's frame, and its own address up to the #
const CLOSE = 'sfmc-ux-tools:deep-link:close';
// and what it asks of the frames for a step through the history to an entry with a link
const OPEN = 'sfmc-ux-tools:deep-link:open';
const CONTACT_OPEN = 'sfmc-ux-tools:deep-link:contact-open';
const PAGE = '/cloud/?x=1';
// the page of the open asset 123 with its own close button
const CLOSABLE =
    '<div class="contentproperties-detailsview"><div class="contentproperties-close"><button data-action="close">x</button></div><div data-content-field="id"><input class="contentinput-copyvalue" value="123"></div></div>';

test('in Content Builder an address gets an entry of its own in the history only when the user opened something else', async () => {
    const at = shell(APP);
    const state = { kept: true };
    at.window.history.replaceState(state, '');
    at.writes.length = 0;
    // the first address of the visit is written over the entry that is there, also after a click
    at.input('pointerdown');
    await at.send({ type: SHOWN, asset: null });
    assert.deepEqual(at.writes, [`replace ${PAGE}${APP}`]);
    // the user opened an asset in the frame: an entry of its own, with the exact address
    await at.send({ type: SHOWN, asset: '123', byUser: true });
    assert.deepEqual(at.pushes(), [`${PAGE}${MARKER}123`]);
    assert.equal(at.hash(), `${MARKER}123`);
    assert.deepEqual(at.window.history.state, state);
    // nobody clicked: Content Builder went on by itself, which adds none
    await at.send({ type: SHOWN, asset: '456' });
    assert.equal(at.hash(), `${MARKER}456`);
    assert.equal(at.pushes().length, 1);
    // only the one value says that the user did it
    for (const byUser of [false, 'true', 1, {}, null]) {
        await at.send({ type: SHOWN, asset: '457', byUser });
        await at.send({ type: SHOWN, asset: '456', byUser });
    }
    assert.equal(at.pushes().length, 1);
    // a click or a key on the page itself counts the same, for the one address that follows
    for (const [type, asset] of [
        ['pointerdown', '789'],
        ['keydown', '790'],
    ]) {
        at.input(type);
        await at.send({ type: SHOWN, asset });
        assert.equal(at.pushes().at(-1), `${PAGE}${MARKER}${asset}`);
        await at.send({ type: SHOWN, asset: '456' });
    }
    assert.equal(at.pushes().length, 3);
    // what a script of the page makes up is nobody's click or key
    for (const type of ['pointerdown', 'keydown']) {
        at.window.dispatchEvent(new at.window.Event(type, { bubbles: true }));
    }
    await at.send({ type: SHOWN, asset: '791' });
    assert.equal(at.pushes().length, 3);
    // the same asset again names nothing else, and uses the click up
    at.input('pointerdown');
    await at.send({ type: SHOWN, asset: '791' });
    await at.send({ type: SHOWN, asset: '792' });
    await at.send({ type: SHOWN, asset: '792', byUser: true });
    assert.equal(at.pushes().length, 3);
    // closing the asset is something else than the asset: the plain address gets an entry
    await at.send({ type: SHOWN, asset: null, byUser: true });
    assert.equal(at.pushes().at(-1), `${PAGE}${APP}`);
    await at.send({ type: SHOWN, asset: null, byUser: true });
    assert.equal(at.pushes().length, 4);
    // a click whose telling came to nothing is used up too
    at.input('pointerdown');
    const first = at.send({ type: SHOWN, asset: '123' });
    const second = at.send({ type: SHOWN, asset: null });
    await Promise.all([first, second]);
    await at.send({ type: SHOWN, asset: '123' });
    assert.equal(at.pushes().length, 4);

    // another app in between: the click that led there is forgotten, and what Content Builder
    // shows first when the page comes back adds no entry
    at.input('pointerdown');
    await at.route('#app/Email/');
    await at.route(APP);
    await at.send({ type: SHOWN, asset: '5', byUser: true });
    assert.equal(at.pushes().length, 4);
    await at.send({ type: SHOWN, asset: '6', byUser: true });
    assert.equal(at.pushes().length, 5);
    at.input('pointerdown');
    await at.route('#home');
    await at.route(APP);
    await at.send({ type: SHOWN, asset: '7' });
    await at.send({ type: SHOWN, asset: '8' });
    assert.equal(at.pushes().length, 5);

    // the address that the page reset is written again over the entry that is there
    const reset = shell(APP);
    await reset.send({ type: SHOWN, asset: null });
    await reset.send({ type: SHOWN, asset: '123', byUser: true });
    reset.input('pointerdown');
    await reset.route(APP);
    assert.equal(reset.hash(), `${MARKER}123`);
    assert.equal(reset.pushes().length, 1);

    // Email Studio adds entries of its own: its address is always written over
    const email = shell(`${EMAIL}%23Subscribers`);
    await email.send({ type: EMAIL_SHOWN, target: VIEW });
    email.input('pointerdown');
    await email.send({ type: EMAIL_SHOWN, target: FOLDER, byUser: true });
    assert.equal(email.hash(), emailLink(MID, FOLDER));
    assert.deepEqual(email.pushes(), []);
});

test('in Contact Builder a route that the user opened gets an entry of its own, and one that Contact Builder went on to does not', async () => {
    const at = shell(CONTACT);
    at.writes.length = 0;
    // the route Contact Builder starts with, after the click in Marketing Cloud's menu
    at.input('pointerdown');
    await at.send({ type: CONTACT_SHOWN, route: START });
    assert.deepEqual(at.writes, [`replace ${PAGE}${contactLink(MID, START)}`]);
    // a click on one of Contact Builder's tabs, which are links of the Marketing Cloud page
    at.input('pointerdown');
    await at.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.deepEqual(at.pushes(), [`${PAGE}${contactLink(MID, LISTED)}`]);
    // Contact Builder went on by itself
    await at.send({ type: CONTACT_SHOWN, route: OPENED });
    assert.equal(at.hash(), contactLink(MID, OPENED));
    assert.equal(at.pushes().length, 1);
    // a click inside Contact Builder's frame
    await at.send({ type: CONTACT_SHOWN, route: LISTED, byUser: true });
    assert.deepEqual(at.pushes().slice(1), [`${PAGE}${contactLink(MID, LISTED)}`]);
    assert.deepEqual(at.asked, []);

    // “Stay here” writes over the entry that is there, and its click is used up by that
    const stayed = shell(contactLink(OTHER, OPENED), { remembered: MID });
    await stayed.send({ type: CONTACT_SHOWN, route: START });
    stayed.input('pointerdown');
    stayed.click('Stay here');
    await settle();
    assert.equal(stayed.hash(), contactLink(MID, START));
    await stayed.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(stayed.hash(), contactLink(MID, LISTED));
    assert.deepEqual(stayed.pushes(), []);
    await stayed.send({ type: CONTACT_SHOWN, route: OPENED, byUser: true });
    assert.equal(stayed.pushes().length, 1);
});

test('a step through the history is never written over, and closes the asset for Content Builder’s plain address', async () => {
    const at = shell(APP, { hasNavigation: true });
    await at.send({ type: SHOWN, asset: null });
    await at.send({ type: SHOWN, asset: '123', byUser: true });
    assert.equal(at.pushes().length, 1);
    at.writes.length = 0;
    // back to the plain address while the asset is shown: the frame is asked to close it,
    // once, and the asset's link is not written over the entry
    at.input('keydown');
    await at.step(APP);
    assert.deepEqual(at.asked, [{ type: CLOSE }]);
    assert.equal(at.hash(), APP);
    assert.deepEqual(at.writes, []);
    // the frame closed it and tells so: the same address, and no entry, whoever clicked before
    await at.send({ type: SHOWN, asset: null, byUser: true });
    assert.deepEqual(at.writes, [`replace ${PAGE}${APP}`]);
    // forward to the asset: the frame is asked to open it, and the entry is left as it is
    await at.step(`${MARKER}123`);
    assert.deepEqual(at.asked.slice(1), [{ type: OPEN, asset: '123' }]);
    await at.send({ type: SHOWN, asset: null });
    assert.equal(at.hash(), `${MARKER}123`);
    assert.deepEqual(at.writes, [`replace ${PAGE}${APP}`]);
    await at.send({ type: SHOWN, asset: '123' });
    assert.equal(at.hash(), `${MARKER}123`);
    assert.deepEqual(at.pushes(), []);
    // a step to a link of another business unit leads to the dialog
    await at.step(link(OTHER, '9'));
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.deepEqual(at.buttons(), ['Switch and open', 'Stay here']);
    at.click('Stay here');
    assert.equal(at.asked.length, 2);
    assert.deepEqual(at.pushes(), []);

    // a change of the address that is no step is treated as ever: the address gets the asset back
    const other = shell(APP, { hasNavigation: true });
    await other.send({ type: SHOWN, asset: '123' });
    other.navigate('push');
    await other.route(APP);
    assert.equal(other.hash(), `${MARKER}123`);
    other.navigate('replace');
    await other.route('#app/Content%20Builder');
    assert.equal(other.hash(), `${MARKER}123`);
    assert.deepEqual(other.asked, []);
    // and a step is one change of the address only
    await other.step(APP);
    assert.equal(other.hash(), APP);
    assert.equal(other.asked.length, 1);
    await other.send({ type: SHOWN, asset: '123' });
    await other.route(APP);
    assert.equal(other.hash(), `${MARKER}123`);
    assert.equal(other.asked.length, 1);

    // a browser that does not tell its steps: as before
    const old = shell(APP);
    await old.send({ type: SHOWN, asset: '123' });
    await old.route(APP);
    assert.equal(old.hash(), `${MARKER}123`);
    assert.deepEqual(old.asked, []);

    // Contact Builder's frame is asked to show the route of the entry: nothing is written
    const contact = shell(CONTACT, { hasNavigation: true });
    await contact.send({ type: CONTACT_SHOWN, route: START });
    contact.input('pointerdown');
    await contact.send({ type: CONTACT_SHOWN, route: LISTED });
    assert.equal(contact.pushes().length, 1);
    contact.writes.length = 0;
    contact.input('keydown');
    await contact.step(contactLink(MID, START));
    assert.equal(contact.hash(), contactLink(MID, START));
    await contact.send({ type: CONTACT_SHOWN, route: START });
    assert.equal(contact.hash(), contactLink(MID, START));
    assert.deepEqual(contact.pushes(), []);
    assert.equal(contact.dialog(), null);
    // its plain address is left as it is too
    contact.writes.length = 0;
    await contact.step(CONTACT);
    assert.equal(contact.hash(), CONTACT);
    assert.deepEqual(contact.writes, []);
    assert.deepEqual(contact.asked, [{ type: CONTACT_OPEN, route: START }]);
});

test('a step within Content Builder to its plain address or to a link of this business unit is shown by the script and kept from Marketing Cloud', async () => {
    /**
     * Loads the page in Content Builder, whose frame told what it shows, and counts the
     * changes of the address that Marketing Cloud's own router gets to see.
     *
     * @returns {Promise.<object>} the page, with seen() for that count
     */
    const start = async () => {
        const at = shell(APP, { hasNavigation: true });
        let seen = 0;
        // added after the script's own listener, as Marketing Cloud's is
        at.window.addEventListener('hashchange', () => seen++);
        await at.send({ type: SHOWN, asset: null });
        at.writes.length = 0;
        at.seen = () => seen;
        return at;
    };
    const at = await start();
    const reads = at.currentReads();
    // to a link of this business unit: the frame is asked to open the asset, at once
    at.input('keydown');
    await at.step(`${MARKER}123`);
    assert.deepEqual(at.asked, [{ type: OPEN, asset: '123' }]);
    assert.equal(at.seen(), 0);
    // the link is not decided again: the business unit is not read, nothing waits for the frame
    assert.equal(at.currentReads(), reads);
    assert.equal(at.waits(), 0);
    assert.equal(at.dialog(), null);
    // “nothing open”, told while the asset is being opened, is not written over the entry
    await at.send({ type: SHOWN, asset: null });
    assert.equal(at.hash(), `${MARKER}123`);
    assert.deepEqual(at.writes, []);
    // the asset is open: the same address over the same entry, and the key of the step adds none
    await at.send({ type: SHOWN, asset: '123' });
    assert.deepEqual(at.writes, [`replace ${PAGE}${MARKER}123`]);
    // to another asset while one is shown: asked again, whatever is shown
    await at.step(`${MARKER}456`);
    assert.deepEqual(at.asked.at(-1), { type: OPEN, asset: '456' });
    // the frame closes the first one before it opens the other: not written either
    await at.send({ type: SHOWN, asset: null });
    assert.equal(at.hash(), `${MARKER}456`);
    // to the asset that is shown, as far as the page knows: asked all the same
    await at.send({ type: SHOWN, asset: '456' });
    await at.step(`${MARKER}123`);
    await at.step(`${MARKER}456`);
    assert.deepEqual(at.asked.slice(-2), [
        { type: OPEN, asset: '123' },
        { type: OPEN, asset: '456' },
    ]);
    // to the plain address: asked to close, and “nothing open” is written from then on
    await at.step(APP);
    assert.deepEqual(at.asked.at(-1), { type: CLOSE });
    await at.send({ type: SHOWN, asset: null });
    assert.equal(at.hash(), APP);
    // also when nothing is shown as far as the page knows: the frame knows what is open
    await at.step(`${MARKER}123`);
    const count = at.asked.length;
    await at.step(APP);
    assert.deepEqual(at.asked.slice(count), [{ type: CLOSE }]);
    assert.equal(at.seen(), 0);
    assert.deepEqual(at.pushes(), []);
    // what the user opens afterwards gets an entry as ever
    await at.send({ type: SHOWN, asset: '789', byUser: true });
    assert.deepEqual(at.pushes(), [`${PAGE}${MARKER}789`]);
    // a link that was waited for is done with by such a step: a frame that asks is given the
    // asset of the entry
    await at.route(`${MARKER}5`);
    assert.equal(at.seen(), 1);
    await at.step(`${MARKER}123`);
    assert.deepEqual(await at.send({ type: WANTED }), { asset: '123' });

    // a link of another business unit, and one while no business unit was read: left to
    // Marketing Cloud, and decided as any link
    const foreign = await start();
    await foreign.step(link(OTHER, '9'));
    assert.equal(foreign.seen(), 1);
    assert.deepEqual(foreign.asked, []);
    assert.deepEqual(foreign.buttons(), ['Switch and open', 'Stay here']);
    const unread = await start();
    unread.window.localStorage.removeItem(LAST_UNIT);
    await unread.step(`${MARKER}123`);
    assert.equal(unread.seen(), 1);
    assert.deepEqual(unread.asked, []);
    assert.deepEqual(await unread.send({ type: WANTED }), { asset: '123' });

    // a frame that told nothing yet is not there to be asked
    const silent = shell(APP, { hasNavigation: true });
    let silentSeen = 0;
    silent.window.addEventListener('hashchange', () => silentSeen++);
    await settle();
    assert.equal(silent.remembered(), MID);
    await silent.step(`${MARKER}123`);
    assert.equal(silentSeen, 1);
    assert.deepEqual(silent.asked, []);
    assert.deepEqual(await silent.send({ type: WANTED }), { asset: '123' });
    // nor is it for the first address after another app
    const back = await start();
    await back.route('#app/Email/');
    await back.step(`${MARKER}123`);
    assert.equal(back.seen(), 2);
    assert.deepEqual(back.asked, []);
    assert.deepEqual(await back.send({ type: WANTED }), { asset: '123' });

    // a change of the address that is no step, and a browser that does not tell its steps
    const pasted = await start();
    pasted.navigate('push', true);
    await pasted.route(`${MARKER}123`);
    assert.equal(pasted.seen(), 1);
    assert.deepEqual(pasted.asked, []);
    const old = shell(APP);
    let oldSeen = 0;
    old.window.addEventListener('hashchange', () => oldSeen++);
    await old.send({ type: SHOWN, asset: null });
    await old.route(`${MARKER}123`);
    assert.equal(oldSeen, 1);
    assert.deepEqual(old.asked, []);

    // a frame that cannot be asked breaks nothing
    const lost = await start();
    lost.window.chrome.runtime.sendMessage = async () => {
        throw new Error('Extension context invalidated.');
    };
    await lost.step(`${MARKER}123`);
    await lost.step(APP);
    assert.equal(lost.seen(), 0);
    // the script listens before the page's own listeners can keep the step to themselves
    assert.match(shellScript, /follow\(app, isStepped\);\n {8}\},\n.*\n {8}true,\n {4}\);/);
});

test('Content Builder’s frame that is loaded anew during a step to an asset is given that asset when it asks', async () => {
    /**
     * Loads the page in Content Builder, whose frame told what it shows, and steps to an asset.
     *
     * @returns {Promise.<object>} the page
     */
    const start = async () => {
        const at = shell(APP, { hasNavigation: true });
        await at.send({ type: SHOWN, asset: null });
        await at.step(`${MARKER}123`);
        assert.deepEqual(at.asked, [{ type: OPEN, asset: '123' }]);
        at.writes.length = 0;
        return at;
    };
    // the new frame never got the request: it tells “nothing open” and asks, as often as it is
    // loaded, and the entry keeps its link
    const at = await start();
    const reads = at.currentReads();
    for (const load of ['first', 'second']) {
        await at.send({ type: SHOWN, asset: null });
        assert.deepEqual(await at.send({ type: WANTED }), { asset: '123' }, load);
        assert.equal(at.hash(), `${MARKER}123`, load);
    }
    assert.deepEqual(at.writes, []);
    // the link is not decided again
    assert.equal(at.currentReads(), reads);
    assert.equal(at.dialog(), null);
    // the asset is open: written over the same entry, and a frame that asks later is given nothing
    await at.send({ type: SHOWN, asset: '123' });
    assert.deepEqual(at.writes, [`replace ${PAGE}${MARKER}123`]);
    assert.deepEqual(await at.send({ type: WANTED }), { asset: null });
    assert.deepEqual(at.pushes(), []);

    // another step takes its place
    const replaced = await start();
    await replaced.step(`${MARKER}456`);
    assert.deepEqual(await replaced.send({ type: WANTED }), { asset: '456' });
    // a step to the plain address ends it, and so does any address that does not name the link
    const closed = await start();
    await closed.step(APP);
    assert.deepEqual(await closed.send({ type: WANTED }), { asset: null });
    assert.equal(closed.hash(), APP);
    const routed = await start();
    await routed.route(APP);
    assert.deepEqual(await routed.send({ type: WANTED }), { asset: null });
    const renamed = await start();
    renamed.window.history.replaceState(null, '', `${PAGE}${MARKER}456`);
    assert.deepEqual(await renamed.send({ type: WANTED }), { asset: null });
    // the user went on by hand, on the page or in the frame
    const clicked = await start();
    clicked.input('pointerdown');
    assert.deepEqual(await clicked.send({ type: WANTED }), { asset: null });
    const typed = await start();
    await typed.send({ type: SHOWN, asset: null, byUser: true });
    assert.deepEqual(await typed.send({ type: WANTED }), { asset: null });
    // only Content Builder's frame is given it
    const email = await start();
    assert.deepEqual(await email.send({ type: EMAIL_WANTED }), { target: null });
    assert.deepEqual(await email.send({ type: WANTED }), { asset: '123' });
});

test('a step within Contact Builder to a route of this business unit is shown by its frame and kept from Marketing Cloud', async () => {
    const at = shell(CONTACT, { hasNavigation: true });
    let seen = 0;
    at.window.addEventListener('hashchange', () => seen++);
    await at.send({ type: CONTACT_SHOWN, route: START });
    at.input('pointerdown');
    await at.send({ type: CONTACT_SHOWN, route: LISTED });
    await at.send({ type: CONTACT_SHOWN, route: OPENED, byUser: true });
    assert.equal(at.pushes().length, 2);
    at.writes.length = 0;
    // back twice and forward again: each entry is shown by the frame, and stays as it is
    for (const route of [LISTED, START, LISTED, OPENED]) {
        const reads = at.currentReads();
        at.input('keydown');
        await at.step(contactLink(MID, route));
        assert.deepEqual(at.asked.at(-1), { type: CONTACT_OPEN, route });
        assert.equal(at.hash(), contactLink(MID, route));
        assert.deepEqual(at.writes, []);
        // the link is not decided again
        assert.equal(at.currentReads(), reads);
        // the frame tells the route it was given: the same address over the same entry
        await at.send({ type: CONTACT_SHOWN, route });
        assert.deepEqual(at.writes, [`replace ${PAGE}${contactLink(MID, route)}`]);
        at.writes.length = 0;
    }
    assert.equal(at.asked.length, 4);
    assert.equal(seen, 0);
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.pushes(), []);

    // Contact Builder's plain address, a route without a business unit and a link of another
    // one are left to Marketing Cloud
    for (const [to, isAsked] of [
        [CONTACT, false],
        [contactBare(LISTED), false],
        [contactLink(OTHER, LISTED), true],
    ]) {
        const other = shell(CONTACT, { hasNavigation: true });
        let otherSeen = 0;
        other.window.addEventListener('hashchange', () => otherSeen++);
        await other.send({ type: CONTACT_SHOWN, route: START });
        await other.send({ type: CONTACT_SHOWN, route: OPENED, byUser: true });
        await other.step(to);
        assert.equal(otherSeen, 1, to);
        assert.deepEqual(other.asked, [], to);
        assert.equal(other.dialog() !== null, isAsked, to);
    }
    // and so is a step while the frame told nothing yet, or no business unit was read
    const silent = shell(CONTACT, { hasNavigation: true });
    await settle();
    await silent.step(contactLink(MID, LISTED));
    assert.deepEqual(silent.asked, []);
    const unread = shell(CONTACT, { hasNavigation: true });
    await unread.send({ type: CONTACT_SHOWN, route: START });
    unread.window.localStorage.removeItem(LAST_UNIT);
    await unread.step(contactLink(MID, LISTED));
    assert.deepEqual(unread.asked, []);
});

test('a step within Contact Builder that the script shows chooses the tab that was chosen when the frame told that route', async () => {
    // Contact Builder's tabs on the Marketing Cloud page, the first one chosen
    const TABS = ['Data Designer', 'All Contacts', 'Data Extensions']
        .map(
            (name) =>
                `<div class="top-level-nav-item-wrapper"><ul class="top-level-nav js-app-menu-link"><li><a class="title">${name}</a></li></ul></div>`,
        )
        .join('');
    const MARKED = ':scope > ul, :scope > ul > li > a';
    // a route that the frame tells only as the answer to a step, at first
    const LATE = 'admin/all-contacts';
    const at = shell(CONTACT, { hasNavigation: true, header: TABS });
    const wrappers = () => [...at.window.document.querySelectorAll('.top-level-nav-item-wrapper')];
    /**
     * Chooses a tab as Marketing Cloud does: the class on the tab, its list and its link.
     *
     * @param {number} [place] which tab; none for no tab at all
     */
    const choose = (place) => {
        for (const item of at.window.document.querySelectorAll('.selected')) {
            item.classList.remove('selected');
        }
        const tab = wrappers()[place];
        const marked = tab ? [tab, ...tab.querySelectorAll(MARKED)] : [];
        for (const item of marked) {
            item.classList.add('selected');
        }
    };
    // per tab, which of its elements have the class
    const chosen = () =>
        wrappers().map((tab) =>
            [tab, ...tab.querySelectorAll('*')]
                .filter((item) => item.classList.contains('selected'))
                .map((item) => item.tagName)
                .join(' '),
        );
    const FIRST = ['DIV UL A', '', ''];
    const SECOND = ['', 'DIV UL A', ''];
    const THIRD = ['', '', 'DIV UL A'];
    choose(0);
    await at.send({ type: CONTACT_SHOWN, route: START });
    // the user clicked the second tab, and went on inside the frame
    choose(1);
    at.input('pointerdown');
    await at.send({ type: CONTACT_SHOWN, route: LISTED });
    await at.send({ type: CONTACT_SHOWN, route: OPENED, byUser: true });
    assert.equal(at.pushes().length, 2);
    // back to a route of the same tab: nothing moves
    at.input('keydown');
    await at.step(contactLink(MID, LISTED));
    assert.deepEqual(chosen(), SECOND);
    await at.send({ type: CONTACT_SHOWN, route: LISTED });
    // back to the route of the first tab: the class moves, on each element that had it
    await at.step(contactLink(MID, START));
    assert.deepEqual(chosen(), FIRST);
    await at.send({ type: CONTACT_SHOWN, route: START });
    // and forward again
    await at.step(contactLink(MID, OPENED));
    assert.deepEqual(chosen(), SECOND);

    // the route that answers such a step is not remembered with the tab that is chosen then,
    // which may be a stale one: a step to it later leaves the tabs as they are
    choose(2);
    await at.send({ type: CONTACT_SHOWN, route: LATE });
    assert.equal(at.hash(), contactLink(MID, LATE));
    await at.step(contactLink(MID, START));
    assert.deepEqual(chosen(), FIRST);
    await at.step(contactLink(MID, LATE));
    assert.deepEqual(chosen(), FIRST);
    // once the user clicked or typed on the page, what the frame tells is remembered again
    choose(2);
    at.input('pointerdown');
    await at.send({ type: CONTACT_SHOWN, route: LATE });
    await at.step(contactLink(MID, START));
    assert.deepEqual(chosen(), FIRST);
    await at.step(contactLink(MID, LATE));
    assert.deepEqual(chosen(), THIRD);

    // no tab chosen, or two: nothing is known to move, and nothing is remembered
    choose();
    await at.step(contactLink(MID, START));
    assert.deepEqual(chosen(), ['', '', '']);
    choose(0);
    wrappers()[1].classList.add('selected');
    at.input('pointerdown');
    await at.send({ type: CONTACT_SHOWN, route: OPENED });
    choose(0);
    await at.step(contactLink(MID, LATE));
    assert.deepEqual(chosen(), THIRD);
    await at.step(contactLink(MID, OPENED));
    assert.deepEqual(chosen(), SECOND);
    // the frame is asked for each of these steps all the same
    assert.equal(at.asked.length, 10);
    assert.equal(at.dialog(), null);
});

test('a step that changes no address is not taken for one when the address changes later', async () => {
    // cancelled, to another document, or to an entry with the same address: no change of the
    // route follows, so the next one is the page's own and the address gets the asset back
    for (const hashChange of [false, undefined, 'true', 1]) {
        const at = shell(APP, { hasNavigation: true });
        await at.send({ type: SHOWN, asset: '123' });
        at.navigate('traverse', hashChange);
        await at.route(APP);
        assert.equal(at.hash(), `${MARKER}123`, String(hashChange));
        assert.deepEqual(at.asked, [], String(hashChange));
    }
});

test('in Email Studio a step through the history is treated as any change of the address', async () => {
    const INNER = 'Subscribers/customobject/1';
    const at = shell(`${EMAIL}%23Subscribers`, { hasNavigation: true });
    await at.send({ type: EMAIL_SHOWN, target: VIEW });
    // the entry holds the address of Email Studio's frame without the field: it gets the view back
    await at.step(`${EMAIL}%23${INNER}`);
    assert.equal(at.hash(), emailLink(MID, VIEW, INNER));
    assert.deepEqual(at.asked, []);
    assert.deepEqual(at.pushes(), []);
    // the step was used up by that: Content Builder's address is the page's own, not a step
    await at.route(APP);
    await at.send({ type: SHOWN, asset: '123' });
    await at.route(APP);
    assert.equal(at.hash(), `${MARKER}123`);
    assert.deepEqual(at.asked, []);
});

test('a click on a button of the dialog adds no entry to the history, whatever link the dialog was about', async () => {
    for (const [mid, button] of [
        [OTHER, 'Stay here'],
        [NOWHERE, 'Close'],
    ]) {
        const at = shell(APP);
        await at.send({ type: SHOWN, asset: null });
        await at.send({ type: SHOWN, asset: '123', byUser: true });
        assert.equal(at.pushes().length, 1);
        // a link of another business unit, pasted into the open page
        await at.route(link(mid, '9'));
        assert.equal(at.buttons().includes(button), true);
        at.input('pointerdown');
        at.click(button);
        await settle();
        // what Content Builder goes on to by itself afterwards is nobody's click
        await at.send({ type: SHOWN, asset: '456' });
        assert.equal(at.hash(), `${MARKER}456`, button);
        assert.equal(at.pushes().length, 1, button);
    }
});

test('Content Builder’s frame clicks the close button of the open asset only when the button itself is drawn', async () => {
    // the button, or what holds it, is taken off the page while the asset's page is drawn
    const hidden = frame({
        html:
            SEARCH_BOX +
            CLOSABLE.replace('<button data-action', '<button style="display:none" data-action'),
    });
    const within = frame({
        html:
            SEARCH_BOX +
            CLOSABLE.replace(
                'class="contentproperties-close"',
                'class="contentproperties-close" style="display:none"',
            ),
    });
    for (const one of [hidden, within]) {
        await one.pass();
        assert.deepEqual(one.shown(), ['123']);
        one.receive({ type: CLOSE });
        await one.pass();
        assert.deepEqual(one.clicked, []);
    }
});

test('while a link into Content Builder is followed, “nothing open” does not take it out of the address', async () => {
    // the frame asks and tells “nothing open” at once; it is answered after the business unit
    // was read
    const at = shell(`${MARKER}123`);
    at.writes.length = 0;
    await at.send({ type: SHOWN, asset: null });
    assert.equal(at.hash(), `${MARKER}123`);
    assert.deepEqual(await at.send({ type: WANTED }), { asset: '123' });
    await at.send({ type: SHOWN, asset: null });
    assert.equal(at.hash(), `${MARKER}123`);
    assert.deepEqual(at.writes, []);
    // the asset is open: from then on the address follows again
    await at.send({ type: SHOWN, asset: '123' });
    assert.deepEqual(at.writes, [`replace ${PAGE}${MARKER}123`]);
    await at.send({ type: SHOWN, asset: null });
    assert.equal(at.hash(), APP);
    assert.deepEqual(at.pushes(), []);

    // a link that is pasted into the open page: the same
    const pasted = shell(APP);
    await pasted.send({ type: SHOWN, asset: null });
    await pasted.route(`${MARKER}456`);
    await pasted.send({ type: SHOWN, asset: null });
    assert.equal(pasted.hash(), `${MARKER}456`);

    // a link that is not followed holds nothing: what was told meanwhile is written
    const refused = shell(link(OTHER, '123'));
    await refused.send({ type: SHOWN, asset: null });
    assert.deepEqual(refused.buttons(), ['Switch and open', 'Stay here']);
    assert.equal(refused.hash(), APP);
    await refused.send({ type: SHOWN, asset: '5' });
    assert.equal(refused.hash(), `${MARKER}5`);
    // refused only when the frame asks, because the business unit was switched meanwhile
    const late = shell(`${MARKER}123`);
    await settle();
    late.account.current = OTHER;
    await late.send({ type: SHOWN, asset: null });
    assert.equal(late.hash(), `${MARKER}123`);
    assert.deepEqual(await late.send({ type: WANTED }), { asset: null });
    assert.equal(late.hash(), APP);
    // asked a second time, for a link that was handed out already
    const again = shell(`${MARKER}123`);
    await again.send({ type: WANTED });
    await again.send({ type: SHOWN, asset: null });
    assert.equal(again.hash(), `${MARKER}123`);
    assert.deepEqual(await again.send({ type: WANTED }), { asset: null });
    assert.equal(again.hash(), APP);

    // the user went on by hand, on the page or in the frame: the link no longer holds
    const clicked = shell(`${MARKER}123`);
    await clicked.send({ type: SHOWN, asset: null });
    clicked.input('pointerdown');
    assert.equal(clicked.hash(), `${MARKER}123`);
    await clicked.send({ type: SHOWN, asset: null });
    assert.equal(clicked.hash(), APP);
    const typed = shell(`${MARKER}123`);
    await typed.send({ type: SHOWN, asset: null, byUser: true });
    assert.equal(typed.hash(), APP);
    // and so does leaving Content Builder
    const left = shell(`${MARKER}123`);
    await left.route('#app/Email/');
    await left.route(APP);
    await left.send({ type: SHOWN, asset: null });
    assert.equal(left.hash(), APP);
    for (const one of [pasted, refused, late, again, clicked, typed, left]) {
        assert.deepEqual(one.pushes(), []);
    }
});

test('Content Builder’s frame says with what it tells whether the user clicked or typed, and only then', async () => {
    const at = frame({ html: SEARCH_BOX + list('1', '2') });
    assert.deepEqual(at.told(), [{ type: SHOWN, asset: null }]);
    for (const type of ['pointerdown', 'keydown']) {
        at.input(type);
        at.document.body.insertAdjacentHTML('beforeend', DETAILS);
        await at.pass();
        assert.deepEqual(at.told().at(-1), { type: SHOWN, asset: '123', byUser: true }, type);
        // said once: what changes afterwards is not the user's doing
        at.document.querySelector('.contentproperties-detailsview').remove();
        await at.pass();
        assert.deepEqual(at.told().at(-1), { type: SHOWN, asset: null }, type);
    }
    // what a script of the page makes up is nobody's click or key
    for (const type of ['pointerdown', 'keydown']) {
        at.document.body.dispatchEvent(new at.document.defaultView.Event(type, { bubbles: true }));
    }
    at.document.body.insertAdjacentHTML('beforeend', DETAILS);
    await at.pass();
    assert.deepEqual(at.told().at(-1), { type: SHOWN, asset: '123' });

    // the row of a link is clicked by the script, whatever the user clicked or typed before
    const linked = frame({
        html: SEARCH_BOX + list('1'),
        wanted: '123',
        assets: { 123: { body: { id: 123, name: 'Welcome' } } },
    });
    await linked.pass();
    linked.input('pointerdown');
    linked.input('keydown');
    linked.document.querySelector('tbody').innerHTML = row('123');
    await linked.pass();
    assert.deepEqual(linked.clicked, ['cb:repeater:list:123']);
    linked.document.body.insertAdjacentHTML('beforeend', DETAILS);
    await linked.pass();
    assert.deepEqual(linked.told(), [
        { type: SHOWN, asset: null },
        { type: SHOWN, asset: '123' },
    ]);
});

test('Content Builder’s frame closes the open asset when the page asks, by its own close button and nothing else', async () => {
    const at = frame({ html: SEARCH_BOX + list('1') + CLOSABLE });
    assert.deepEqual(at.shown(), ['123']);
    // from anyone but the background script, and for any other message, nothing is clicked
    at.receive({ type: CLOSE }, { id: 'another-extension' });
    at.receive({ type: CLOSE }, { id: EXTENSION, tab: { id: 7 } });
    at.receive({ type: SHOWN, asset: null });
    at.receive(null);
    assert.deepEqual(at.clicked, []);
    at.input('pointerdown');
    assert.deepEqual(at.receive({ type: CLOSE }), [false]);
    assert.deepEqual(at.clicked, ['BUTTON']);
    // once per request, and what follows is not the user's doing
    await at.pass(ROW_WAIT);
    assert.deepEqual(at.clicked, ['BUTTON']);
    at.document.querySelector('.contentproperties-detailsview').remove();
    await at.pass();
    assert.deepEqual(at.told().at(-1), { type: SHOWN, asset: null });

    // an asset's page that is not drawn, one without the button, and the button without it
    const hidden = frame({ html: `${SEARCH_BOX}<div style="display:none">${CLOSABLE}</div>` });
    const bare = frame({ html: SEARCH_BOX + DETAILS });
    const lone = frame({
        html: `${SEARCH_BOX}<div class="contentproperties-close"><button data-action="close">x</button></div>`,
    });
    // a button of the asset's page that does something else
    const wrong = frame({
        html: SEARCH_BOX + CLOSABLE.replace('data-action="close"', 'data-action="save"'),
    });
    // a document that was not seen to hold the list, Content Builder by itself, a frame in it
    const other = frame({ html: CLOSABLE });
    const alone = frame({ html: SEARCH_BOX + CLOSABLE, depth: 'top' });
    const nested = frame({ html: SEARCH_BOX + CLOSABLE, depth: 'nested' });
    for (const one of [hidden, bare, lone, wrong, other, alone, nested]) {
        await one.pass();
        one.receive({ type: CLOSE });
        await one.pass();
        assert.deepEqual(one.clicked, []);
    }
    // the two things the script ever clicks go through one place
    assert.equal(frameScript.match(/\bpress\(/g).length, 3);
});

test('Content Builder’s frame opens the asset that the page asks for as it follows a link, after closing another one', async () => {
    const assets = {
        123: { body: { id: 123, name: 'Welcome' } },
        456: { body: { id: 456, name: 'Goodbye' } },
    };
    const at = frame({ html: SEARCH_BOX + list('1'), assets });
    // from anyone but the background script, and for what is no id, nothing is read
    at.receive({ type: OPEN, asset: '123' }, { id: 'another-extension' });
    at.receive({ type: OPEN, asset: '123' }, { id: EXTENSION, tab: { id: 7 } });
    for (const asset of [null, undefined, '', '12a', '1234567890123456', 123, '../x', {}]) {
        at.receive({ type: OPEN, asset });
    }
    await at.pass();
    assert.deepEqual(at.calls, []);
    // whatever the user clicked before, on the browser's Back for one
    at.input('pointerdown');
    assert.deepEqual(at.receive({ type: OPEN, asset: '123' }), [false]);
    await at.pass();
    assert.deepEqual(at.calls, ['GET /fuelapi/asset/v1/content/assets/123?$fields=id,name']);
    assert.equal(at.searched.length, 5);
    assert.equal(at.searched[0], 'input Welcome');
    assert.deepEqual(at.clicked, []);
    at.document.querySelector('tbody').innerHTML = row('12') + row('123');
    await at.pass();
    assert.deepEqual(at.clicked, ['cb:repeater:list:123']);
    at.document.body.insertAdjacentHTML('beforeend', CLOSABLE);
    await at.pass();
    // told as nobody's click, and the search is emptied as after a link
    assert.deepEqual(at.told().at(-1), { type: SHOWN, asset: '123' });
    assert.equal(at.document.querySelector('input[placeholder="Search"]').value, '');
    assert.equal(at.searched.length, 10);

    // the asset that is open already is left as it is
    at.receive({ type: OPEN, asset: '123' });
    await at.pass();
    assert.equal(at.calls.length, 1);
    assert.deepEqual(at.clicked, ['cb:repeater:list:123']);
    // another one is open: that one is closed first, by its own button, then the search
    at.receive({ type: OPEN, asset: '456' });
    assert.deepEqual(at.clicked.slice(1), ['BUTTON']);
    at.document.querySelector('.contentproperties-detailsview').remove();
    at.document.querySelector('tbody').innerHTML = row('123') + row('456');
    await at.pass();
    assert.equal(at.calls.length, 2);
    assert.equal(at.searched[10], 'input Goodbye');
    assert.deepEqual(at.clicked.slice(2), ['cb:repeater:list:456']);
    assert.deepEqual(at.told().at(-1), { type: SHOWN, asset: null });
    assert.equal(at.notice(), null);

    // an asset that cannot be read, or that the search does not list, ends in the notice
    const unread = frame({ html: SEARCH_BOX + list('1') });
    unread.receive({ type: OPEN, asset: '123' });
    await unread.pass();
    assert.match(unread.notice().textContent, /could not open asset 123/);
    const unlisted = frame({ html: SEARCH_BOX + list('1'), assets });
    unlisted.receive({ type: OPEN, asset: '123' });
    await unlisted.pass();
    await unlisted.pass(ROW_WAIT);
    assert.match(unlisted.notice().textContent, /search did not list it/);

    // a document that was not seen to hold the list, Content Builder by itself, a frame in it
    const other = frame({ html: list('123'), assets });
    const alone = frame({ html: SEARCH_BOX + list('123'), assets, depth: 'top' });
    const nested = frame({ html: SEARCH_BOX + list('123'), assets, depth: 'nested' });
    for (const one of [other, alone, nested]) {
        await one.pass();
        one.receive({ type: OPEN, asset: '123' });
        await one.pass();
        assert.deepEqual(one.calls, []);
        assert.deepEqual(one.clicked, []);
    }
});

/**
 * Runs the frame script in Content Builder's list, in an account with the assets 123 and 456.
 *
 * @param {object} [first] what else the API's answer for the asset 123 holds
 * @returns {object} what frame() returns
 */
const twoAssets = (first = {}) =>
    frame({
        html: SEARCH_BOX + list('1'),
        assets: {
            123: { body: { id: 123, name: 'Welcome' }, ...first },
            456: { body: { id: 456, name: 'Goodbye' } },
        },
    });

test('an asset that the page asks Content Builder’s frame to open takes the place of the one that was being opened', async () => {
    // the row of the first one was waited for: its wait ends with the second request
    const waited = twoAssets();
    waited.receive({ type: OPEN, asset: '123' });
    await waited.pass();
    waited.receive({ type: OPEN, asset: '456' });
    await waited.pass(0);
    assert.equal(waited.searched.at(-5), 'input Goodbye');
    // the row of the first one comes late: only the second one's is clicked
    waited.document.querySelector('tbody').innerHTML = row('123') + row('456');
    await waited.pass();
    assert.deepEqual(waited.clicked, ['cb:repeater:list:456']);
    // and when the time the first one had is up, no notice says that it was not listed
    await waited.pass(ROW_WAIT);
    assert.equal(waited.notice(), null);

    // the name of the first one was still being read: it is dropped when it comes
    const { promise, resolve } = Promise.withResolvers();
    const slow = twoAssets({ until: promise });
    slow.receive({ type: OPEN, asset: '123' });
    await slow.pass();
    slow.receive({ type: OPEN, asset: '456' });
    await slow.pass();
    assert.equal(slow.searched.length, 5);
    resolve();
    await slow.pass();
    assert.equal(slow.calls.length, 2);
    assert.equal(slow.searched.length, 5);
    assert.equal(slow.document.querySelector('input').value, 'Goodbye');
    slow.document.querySelector('tbody').innerHTML = row('123') + row('456');
    await slow.pass();
    assert.deepEqual(slow.clicked, ['cb:repeater:list:456']);
    // and so is a name that cannot be read: no notice about an asset nobody waits for
    const failing = Promise.withResolvers();
    const failed = twoAssets({ until: failing.promise, status: 404 });
    failed.receive({ type: OPEN, asset: '123' });
    failed.receive({ type: OPEN, asset: '456' });
    failing.resolve();
    await failed.pass();
    assert.equal(failed.notice(), null);
});

test('Content Builder’s frame clicks the row of the asset that the page asks for only once the other asset is closed', async () => {
    const at = frame({
        html: SEARCH_BOX + list('1', '456') + CLOSABLE,
        assets: { 456: { body: { id: 456, name: 'Goodbye' } } },
    });
    assert.deepEqual(at.shown(), ['123']);
    at.receive({ type: OPEN, asset: '456' });
    assert.deepEqual(at.clicked, ['BUTTON']);
    // the row is listed already, but the page of the other asset is still drawn
    await at.pass();
    assert.equal(at.searched[0], 'input Goodbye');
    assert.deepEqual(at.clicked, ['BUTTON']);
    // the list is drawn again meanwhile: still nothing
    at.document.querySelector('tbody').innerHTML = row('456');
    await at.pass();
    assert.deepEqual(at.clicked, ['BUTTON']);
    // the page of the other asset is gone: the row is clicked, once
    at.document.querySelector('.contentproperties-detailsview').remove();
    await at.pass();
    assert.deepEqual(at.clicked, ['BUTTON', 'cb:repeater:list:456']);
    at.document.querySelector('tbody').innerHTML = row('456');
    await at.pass();
    assert.equal(at.clicked.length, 2);
    assert.equal(at.notice(), null);

    // the other asset never closes: when the wait is up, the notice names that, not the search,
    // and the row that was listed all along was never clicked
    const stuck = frame({
        html: SEARCH_BOX + list('1', '456') + CLOSABLE,
        assets: { 456: { body: { id: 456, name: 'Goodbye' } } },
    });
    stuck.receive({ type: OPEN, asset: '456' });
    await stuck.pass();
    await stuck.pass(ROW_WAIT);
    assert.equal(
        stuck.notice().querySelector('span').textContent,
        'SFMC UX Tools: could not open asset 456 from the link (another asset is still open).',
    );
    assert.deepEqual(stuck.clicked, ['BUTTON']);

    // a page of the other asset that is only taken off the page counts as closed
    const hidden = frame({
        html: `${SEARCH_BOX}${list('456')}<div id="holder">${CLOSABLE}</div>`,
        assets: { 456: { body: { id: 456, name: 'Goodbye' } } },
    });
    hidden.receive({ type: OPEN, asset: '456' });
    await hidden.pass();
    assert.deepEqual(hidden.clicked, ['BUTTON']);
    hidden.document.querySelector('#holder').style.display = 'none';
    await hidden.pass();
    assert.deepEqual(hidden.clicked, ['BUTTON', 'cb:repeater:list:456']);
});

test('a second request to open the asset that Content Builder’s frame is opening already starts nothing anew', async () => {
    const { promise, resolve } = Promise.withResolvers();
    const at = twoAssets({ until: promise });
    // while the name is read
    at.receive({ type: OPEN, asset: '123' });
    await at.pass();
    at.receive({ type: OPEN, asset: '123' });
    resolve();
    await at.pass();
    assert.equal(at.calls.length, 1);
    assert.equal(at.searched.length, 5);
    // while the row is waited for
    at.receive({ type: OPEN, asset: '123' });
    await at.pass();
    assert.equal(at.calls.length, 1);
    assert.equal(at.searched.length, 5);
    at.document.querySelector('tbody').innerHTML = row('123');
    await at.pass();
    assert.deepEqual(at.clicked, ['cb:repeater:list:123']);
    // after the click on the row, until the asset is open
    at.receive({ type: OPEN, asset: '123' });
    at.document.querySelector('tbody').innerHTML = row('123');
    await at.pass();
    assert.equal(at.calls.length, 1);
    assert.equal(at.searched.length, 5);
    assert.deepEqual(at.clicked, ['cb:repeater:list:123']);
    // the search is still emptied once the asset is open, as for the first request
    at.document.body.insertAdjacentHTML('beforeend', CLOSABLE);
    await at.pass();
    assert.equal(at.document.querySelector('input').value, '');
    assert.equal(at.notice(), null);

    // the first request's wait for the row goes on: its time is not started anew
    const late = twoAssets();
    late.receive({ type: OPEN, asset: '123' });
    await late.pass(ROW_WAIT - LOOK_DELAY);
    late.receive({ type: OPEN, asset: '123' });
    await late.pass();
    assert.match(late.notice().textContent, /search did not list it/);
    assert.equal(late.calls.length, 1);

    // another asset in between is a new request each time
    const other = twoAssets();
    other.receive({ type: OPEN, asset: '123' });
    await other.pass();
    other.receive({ type: OPEN, asset: '456' });
    await other.pass();
    other.receive({ type: OPEN, asset: '123' });
    await other.pass();
    assert.equal(other.calls.length, 3);
    other.document.querySelector('tbody').innerHTML = row('123') + row('456');
    await other.pass();
    assert.deepEqual(other.clicked, ['cb:repeater:list:123']);

    // an asset that is open already ends the opening of another one
    const open = frame({
        html: SEARCH_BOX + list('1') + CLOSABLE,
        assets: { 456: { body: { id: 456, name: 'Goodbye' } } },
    });
    open.receive({ type: OPEN, asset: '456' });
    open.receive({ type: OPEN, asset: '123' });
    await open.pass();
    open.document.querySelector('.contentproperties-detailsview').remove();
    open.document.querySelector('tbody').innerHTML = row('456');
    await open.pass();
    assert.deepEqual(open.searched, []);
    assert.deepEqual(open.clicked, ['BUTTON']);
});

test('an asset whose page is drawn late, during the opening of another one, is closed by Content Builder’s frame, and one that the user opened stays', async () => {
    // the row of the first one was clicked for an earlier request, and its page is not drawn yet
    const late = twoAssets();
    late.receive({ type: OPEN, asset: '123' });
    await late.pass();
    late.document.querySelector('tbody').innerHTML = row('123');
    await late.pass();
    assert.deepEqual(late.clicked, ['cb:repeater:list:123']);
    late.receive({ type: OPEN, asset: '456' });
    await late.pass();
    assert.equal(late.searched.at(-5), 'input Goodbye');
    assert.deepEqual(late.clicked, ['cb:repeater:list:123']);
    // now it is drawn: it is asked to close, by nobody's click
    late.document.body.insertAdjacentHTML('beforeend', CLOSABLE);
    await late.pass();
    assert.deepEqual(late.clicked.slice(1), ['BUTTON']);
    assert.deepEqual(late.told().at(-1), { type: SHOWN, asset: '123' });
    // asked once, however many times the page changes while it is still drawn
    late.document.querySelector('tbody').innerHTML = row('456');
    await late.pass();
    assert.deepEqual(late.clicked.slice(1), ['BUTTON']);
    // its page is gone: the row of the second one is clicked, once
    late.document.querySelector('.contentproperties-detailsview').remove();
    await late.pass();
    assert.deepEqual(late.clicked.slice(2), ['cb:repeater:list:456']);
    late.document.querySelector('tbody').innerHTML = row('456');
    await late.pass(ROW_WAIT);
    assert.equal(late.clicked.length, 3);
    assert.equal(late.notice(), null);

    // the user opened another asset by hand while the row was waited for: it stays open
    const byHand = twoAssets();
    byHand.receive({ type: OPEN, asset: '456' });
    await byHand.pass();
    assert.equal(byHand.searched[0], 'input Goodbye');
    byHand.input('pointerdown');
    byHand.document.body.insertAdjacentHTML('beforeend', CLOSABLE);
    await byHand.pass();
    assert.deepEqual(byHand.told().at(-1), { type: SHOWN, asset: '123', byUser: true });
    assert.deepEqual(byHand.clicked, []);
    // and the asset that was asked for is given up: its row is not clicked, and no notice follows
    byHand.document.querySelector('tbody').innerHTML = row('456');
    await byHand.pass();
    byHand.document.querySelector('.contentproperties-detailsview').remove();
    byHand.document.querySelector('tbody').innerHTML = row('456');
    await byHand.pass();
    await byHand.pass(ROW_WAIT);
    assert.deepEqual(byHand.clicked, []);
    assert.equal(byHand.notice(), null);

    // what the user clicked before the request, on the browser's Back for one, is no opening by
    // hand: the asset that is drawn late is closed, and the one that was asked for is opened
    const before = twoAssets();
    before.input('pointerdown');
    before.receive({ type: OPEN, asset: '456' });
    await before.pass();
    assert.equal(before.searched[0], 'input Goodbye');
    before.document.body.insertAdjacentHTML('beforeend', CLOSABLE);
    await before.pass();
    assert.deepEqual(before.told().at(-1), { type: SHOWN, asset: '123' });
    assert.deepEqual(before.clicked, ['BUTTON']);
    before.document.querySelector('.contentproperties-detailsview').remove();
    before.document.querySelector('tbody').innerHTML = row('456');
    await before.pass();
    assert.deepEqual(before.clicked, ['BUTTON', 'cb:repeater:list:456']);
    await before.pass(ROW_WAIT);
    assert.equal(before.notice(), null);

    // the same while the name of the asset was still being read: nothing is searched afterwards
    const { promise, resolve } = Promise.withResolvers();
    const slow = frame({
        html: SEARCH_BOX + list('1'),
        assets: { 456: { body: { id: 456, name: 'Goodbye' }, until: promise } },
    });
    slow.receive({ type: OPEN, asset: '456' });
    await slow.pass();
    slow.input('keydown');
    slow.document.body.insertAdjacentHTML('beforeend', CLOSABLE);
    await slow.pass();
    resolve();
    await slow.pass();
    assert.deepEqual(slow.searched, []);
    assert.deepEqual(slow.clicked, []);
});

test('a request to close ends the opening of an asset in Content Builder’s frame', async () => {
    const assets = { 123: { body: { id: 123, name: 'Welcome' } } };
    // the row was waited for: it is not clicked when it comes, and no notice follows
    const waited = frame({ html: SEARCH_BOX + list('1'), assets });
    waited.receive({ type: OPEN, asset: '123' });
    await waited.pass();
    assert.equal(waited.searched.length, 5);
    waited.receive({ type: CLOSE });
    waited.document.querySelector('tbody').innerHTML = row('123');
    await waited.pass();
    await waited.pass(ROW_WAIT);
    assert.deepEqual(waited.clicked, []);
    assert.equal(waited.notice(), null);

    // the name was still being read: nothing is searched when it comes
    const { promise, resolve } = Promise.withResolvers();
    const slow = frame({
        html: SEARCH_BOX + list('123'),
        assets: { 123: { ...assets[123], until: promise } },
    });
    slow.receive({ type: OPEN, asset: '123' });
    await slow.pass();
    slow.receive({ type: CLOSE });
    resolve();
    await slow.pass();
    await slow.pass(ROW_WAIT);
    assert.deepEqual(slow.searched, []);
    assert.deepEqual(slow.clicked, []);
    assert.equal(slow.notice(), null);

    // the same for the asset of a link that the frame asked for itself
    const linked = frame({ html: SEARCH_BOX + list('1'), wanted: '123', assets });
    await linked.pass();
    assert.equal(linked.searched.length, 5);
    linked.receive({ type: CLOSE });
    linked.document.querySelector('tbody').innerHTML = row('123');
    await linked.pass();
    assert.deepEqual(linked.clicked, []);
});

test('the background script passes the requests to close and to open on from the Marketing Cloud page only, and what the user caused as one value', async () => {
    const PAGE_SENDER = { id: EXTENSION, tab: { id: 7 }, frameId: 0, documentId: 'A0', url: SHELL };
    const { send, passed } = background();
    // nobody waits for an answer
    assert.equal(send({ type: CLOSE, more: 1 }, PAGE_SENDER), false);
    assert.equal(send({ type: CLOSE }, { ...PAGE_SENDER, url: `${SHELL}?x=1${MARKER}123` }), false);
    // to the frames of the tab, with nothing but the type
    assert.deepEqual(passed, [
        { tabId: 7, message: { type: CLOSE }, options: undefined },
        { tabId: 7, message: { type: CLOSE }, options: undefined },
    ]);
    for (const other of [
        { id: 'another-extension' },
        { tab: undefined },
        { tab: {} },
        // a frame of the page, and a sender without a frame
        { frameId: 3 },
        { frameId: undefined },
        { url: undefined },
        { url: 'not an address' },
        // another page under the same path, and other hosts
        { url: `${ORIGIN}/cloud/context-switch.html` },
        { url: `${ORIGIN}/` },
        { url: SHELL.replace('https:', 'http:') },
        { url: 'https://members.s7.exacttarget.com/cloud/' },
        { url: 'https://mc.s7.exacttarget.com.example.org/cloud/' },
        { url: 'https://example.org/cloud/?x=mc.s7.exacttarget.com' },
        { url: 'https://content-builder.s7.marketingcloudapps.com/' },
        { url: 'https://mc.s7.marketingcloudapps.com/cloud/' },
    ]) {
        assert.equal(send({ type: CLOSE }, { ...PAGE_SENDER, ...other }), false);
    }
    assert.equal(passed.length, 2);
    // a tab in which nothing listens breaks nothing
    const deaf = background(() => {
        throw new Error('Could not establish connection');
    });
    assert.equal(deaf.send({ type: CLOSE }, PAGE_SENDER), false);
    assert.equal(deaf.send({ type: OPEN, asset: '123' }, PAGE_SENDER), false);
    assert.equal(deaf.send({ type: CONTACT_OPEN, route: LISTED }, PAGE_SENDER), false);
    await settle();

    // the two requests to open are passed on the same way, with one id or one route of the form
    const down = background();
    assert.equal(
        down.send({ type: OPEN, asset: '123', route: LISTED, more: 1 }, PAGE_SENDER),
        false,
    );
    assert.equal(
        down.send({ type: CONTACT_OPEN, route: OPENED, asset: '1', more: 1 }, PAGE_SENDER),
        false,
    );
    assert.deepEqual(down.passed, [
        { tabId: 7, message: { type: OPEN, asset: '123' }, options: undefined },
        { tabId: 7, message: { type: CONTACT_OPEN, route: OPENED }, options: undefined },
    ]);
    // whatever is no id or no route of the form is not passed on at all
    for (const asset of [null, undefined, '', '12a', '1234567890123456', 123, '../x', {}, ['1']]) {
        assert.equal(down.send({ type: OPEN, asset }, PAGE_SENDER), false, String(asset));
    }
    for (const route of [...NO_ROUTES, undefined, null, 7, {}, ['admin']]) {
        assert.equal(down.send({ type: CONTACT_OPEN, route }, PAGE_SENDER), false, String(route));
    }
    // and from anyone but the Marketing Cloud page nothing is
    for (const other of [
        { id: 'another-extension' },
        { tab: undefined },
        { frameId: 3 },
        { frameId: undefined },
        { url: undefined },
        { url: `${ORIGIN}/cloud/context-switch.html` },
        { url: 'https://mc.s7.exacttarget.com.example.org/cloud/' },
        { url: 'https://content-builder.s7.marketingcloudapps.com/' },
        { url: 'https://mc.s7.marketingcloudapps.com/contactsmeta/admin.html' },
    ]) {
        const sender = { ...PAGE_SENDER, ...other };
        assert.equal(down.send({ type: OPEN, asset: '123' }, sender), false);
        assert.equal(down.send({ type: CONTACT_OPEN, route: LISTED }, sender), false);
    }
    assert.equal(down.passed.length, 2);

    // what the user caused is passed on for the two apps that get entries, as true or not at all
    const CONTENT = {
        id: EXTENSION,
        tab: { id: 7 },
        frameId: 3,
        url: 'https://content-builder.s7.marketingcloudapps.com/',
    };
    const CONTACTS = {
        ...CONTENT,
        url: 'https://mc.s7.marketingcloudapps.com/contactsmeta/admin.html',
    };
    const EMAILS = { ...CONTENT, url: 'https://members.s7.exacttarget.com/C12/Default.aspx' };
    const relay = background();
    await relay.send({ type: SHOWN, asset: '1', byUser: true }, CONTENT);
    await relay.send({ type: CONTACT_SHOWN, route: LISTED, byUser: true }, CONTACTS);
    assert.deepEqual(
        relay.passed.map((item) => item.message),
        [
            { type: SHOWN, asset: '1', byUser: true },
            { type: CONTACT_SHOWN, route: LISTED, byUser: true },
        ],
    );
    for (const byUser of [false, 'true', 1, {}, [true], null, undefined]) {
        await relay.send({ type: SHOWN, asset: '1', byUser }, CONTENT);
        assert.deepEqual(relay.passed.at(-1).message, { type: SHOWN, asset: '1' });
        await relay.send({ type: CONTACT_SHOWN, route: LISTED, byUser }, CONTACTS);
        assert.deepEqual(relay.passed.at(-1).message, { type: CONTACT_SHOWN, route: LISTED });
    }
    // not for a question, and not for Email Studio
    await relay.send({ type: WANTED, byUser: true }, CONTENT);
    assert.deepEqual(relay.passed.at(-1).message, { type: WANTED });
    await relay.send({ type: EMAIL_SHOWN, target: VIEW, byUser: true }, EMAILS);
    assert.deepEqual(relay.passed.at(-1).message, { type: EMAIL_SHOWN, target: VIEW });
    // a frame cannot ask to close or to open
    const count = relay.passed.length;
    for (const sender of [CONTENT, CONTACTS, EMAILS]) {
        assert.equal(relay.send({ type: CLOSE }, sender), false);
        assert.equal(relay.send({ type: OPEN, asset: '123' }, sender), false);
        assert.equal(relay.send({ type: CONTACT_OPEN, route: LISTED }, sender), false);
    }
    assert.equal(relay.passed.length, count);
});

test('the background script passes MobilePush’s requests to the page, and the page’s note down to the frames', async () => {
    const PANEL_OPEN = 'sfmc-ux-tools:mobile:panel-open';
    const JOURNEYS = 'sfmc-ux-tools:mobile:journeys';
    const PANEL_CLOSED = 'sfmc-ux-tools:mobile:panel-closed';
    const FRAME = {
        id: EXTENSION,
        tab: { id: 7 },
        frameId: 3,
        documentId: 'A1',
        url: 'https://mc.s7.marketingcloudapps.com/mobilepush/',
    };
    const { send, passed } = background((message) =>
        message.type === JOURNEYS ? { isOk: true, journeys: [] } : undefined,
    );
    // only the type, the one kind and a key or a page of the expected form
    assert.equal(
        await send({ type: PANEL_OPEN, kind: 'sms', key: 'my key', more: 1 }, FRAME),
        undefined,
    );
    assert.deepEqual(await send({ type: JOURNEYS, page: 3, more: 1 }, FRAME), {
        isOk: true,
        journeys: [],
    });
    // Marketing Cloud writes the path with capitals at times
    const capitals = { ...FRAME, url: 'https://mc.s7.marketingcloudapps.com/MobilePush/' };
    await send({ type: PANEL_OPEN, kind: 'push', key: 'k' }, capitals);
    // MobileConnect asks the same, from the app of its list and from the older one
    for (const path of ['MobileConnectFuel3', 'mobileconnectfuel3', 'Mobile', 'mobile']) {
        const connect = { ...FRAME, url: `https://mc.s7.marketingcloudapps.com/${path}/` };
        assert.notEqual(send({ type: JOURNEYS, page: 1 }, connect), false, path);
    }
    passed.length = 3;
    // a kind that is none is passed on as none
    await send({ type: PANEL_OPEN, kind: 'ott', key: 'k' }, FRAME);
    assert.deepEqual(passed.pop().message, { type: PANEL_OPEN, kind: null, key: 'k' });
    assert.deepEqual(passed, [
        {
            tabId: 7,
            message: { type: PANEL_OPEN, kind: 'sms', key: 'my key' },
            options: { frameId: 0 },
        },
        { tabId: 7, message: { type: JOURNEYS, page: 3 }, options: { frameId: 0 } },
        {
            tabId: 7,
            message: { type: PANEL_OPEN, kind: 'push', key: 'k' },
            options: { frameId: 0 },
        },
    ]);
    passed.length = 0;
    for (const key of [undefined, null, 5, '', 'a\nb', 'x'.repeat(201)]) {
        await send({ type: PANEL_OPEN, kind: 'push', key }, FRAME);
    }
    for (const page of [undefined, '1', 0, -1, 1.5, 1001]) {
        await send({ type: JOURNEYS, page }, FRAME);
    }
    for (const { message } of passed) {
        assert.equal(message.type === PANEL_OPEN ? message.key : message.page, null);
    }
    assert.equal(passed.length, 12);
    passed.length = 0;

    for (const other of [
        { id: 'another-extension' },
        { tab: undefined },
        // the page itself
        { frameId: 0 },
        { url: undefined },
        { url: 'https://mc.s7.marketingcloudapps.com/AutomationStudioFuel3/' },
        { url: 'https://mc.s7.marketingcloudapps.com/mobiles/' },
        {
            url: 'https://content-builder.s7.marketingcloudapps.com/mobilepush/x'.replace(
                '/mobilepush/x',
                '/',
            ),
        },
        { url: FRAME.url.replace('https:', 'http:') },
        { url: 'https://mc.s7.marketingcloudapps.com.example.org/mobilepush/' },
        { url: 'https://example.org/mobilepush/' },
    ]) {
        for (const type of [PANEL_OPEN, JOURNEYS]) {
            const sender = { ...FRAME, ...other };
            assert.equal(send({ type, key: 'k', page: 1 }, sender), false, JSON.stringify(other));
        }
    }
    assert.equal(passed.length, 0);

    // downward: from the Marketing Cloud page only, to every frame of its tab, the kind alone
    const PAGE_SENDER = { id: EXTENSION, tab: { id: 7 }, frameId: 0, documentId: 'A0', url: SHELL };
    assert.equal(send({ type: PANEL_CLOSED, kind: 'push', more: 1 }, PAGE_SENDER), false);
    assert.equal(send({ type: PANEL_CLOSED, kind: 'sms' }, PAGE_SENDER), false);
    assert.equal(send({ type: PANEL_CLOSED, kind: 'ott' }, PAGE_SENDER), false);
    // a frame cannot send the page's note, and no other frame can ask what MobilePush asks
    assert.equal(send({ type: PANEL_CLOSED, kind: 'push' }, FRAME), false);
    assert.equal(send({ type: PANEL_CLOSED, kind: 'push' }, { ...PAGE_SENDER, id: 'x' }), false);
    assert.deepEqual(passed, [
        { tabId: 7, message: { type: PANEL_CLOSED, kind: 'push' }, options: undefined },
        { tabId: 7, message: { type: PANEL_CLOSED, kind: 'sms' }, options: undefined },
    ]);
});
