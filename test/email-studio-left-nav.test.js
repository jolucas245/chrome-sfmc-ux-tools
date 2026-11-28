import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../src/email-studio-left-nav.js');
const css = read('../src/email-studio-left-nav.css');
const KEY = 'emailStudioLeftNavWidth';
const MENU =
    '<div id="divLeftNav" class="legacy-left-nav"><div id="collapseLeftNav" class="toggle-bar"></div><iframe id="fraLeftNav"></iframe></div><div id="divContent" class="legacy-content"></div>';
const LAYOUT = `<div><div id="expandLeftNav" class="toggle-bar" style="display: none;"></div></div>${MENU}`;
const EXTENSION = 'chrome-extension://extension-id/';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const fail = () => Promise.reject(new Error('broken'));
const isSet = (element, name) => Object.hasOwn(element.dataset, name);
const inner = (document) => document.querySelector('#fraLeftNav').contentDocument;

/**
 * Runs the script in a page of Email Studio, with a window 1000px wide.
 *
 * @param {object} [options] how the page starts
 * @param {string} [options.html] the body of the page
 * @param {Object.<string, unknown>} [options.stored] what chrome.storage.local holds
 * @param {boolean} [options.isBroken] true makes every read and write of the storage fail
 * @param {(document: Document) => void} [options.prepare] changes the page before the script runs
 * @param {(document: Document) => void} [options.beforeLoad] changes the page after the script ran, before it has loaded
 * @param {boolean} [options.isLate] true runs the script only once the page has loaded
 * @returns {Promise.<object>} the window, its document, the storage and helpers
 */
async function page({
    html = LAYOUT,
    stored = {},
    isBroken = false,
    prepare,
    beforeLoad,
    isLate = false,
} = {}) {
    const { window } = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
        runScripts: 'outside-only',
        url: 'https://members.s7.exacttarget.com/C12/Default.aspx#Subscribers',
    });
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    const storage = { ...stored };
    const listeners = [];
    let reads = 0;
    window.chrome = {
        runtime: { getURL: (path) => EXTENSION + path },
        storage: {
            local: {
                get: (defaults) => {
                    reads += 1;
                    return isBroken
                        ? fail()
                        : Promise.resolve(
                              Object.fromEntries(
                                  Object.entries(defaults).map(([key, value]) => [
                                      key,
                                      Object.hasOwn(storage, key) ? storage[key] : value,
                                  ]),
                              ),
                          );
                },
                set: (values) => {
                    if (isBroken) {
                        return fail();
                    }
                    Object.assign(storage, values);
                    return Promise.resolve();
                },
                remove: (key) => {
                    if (isBroken) {
                        return fail();
                    }
                    delete storage[key];
                    return Promise.resolve();
                },
            },
            onChanged: {
                addListener: (listener) => {
                    listeners.push(listener);
                },
            },
        },
    };
    const timers = [];
    window.setTimeout = (callback, delay) => {
        timers.push({ callback, delay, isCleared: false });
        return timers.length;
    };
    window.clearTimeout = (id) => {
        const timer = timers.at(id - 1);
        if (timer !== undefined && id > 0) {
            timer.isCleared = true;
        }
    };
    let resizes = 0;
    window.addEventListener('resize', () => {
        resizes += 1;
    });
    const loaded = new Promise((resolve) => {
        window.addEventListener('load', resolve, { once: true });
    });
    if (isLate) {
        await loaded;
    }
    let collapses = 0;
    let expands = 0;
    window.document.querySelector('#collapseLeftNav')?.addEventListener('click', () => {
        collapses += 1;
    });
    window.document.querySelector('#expandLeftNav')?.addEventListener('click', () => {
        expands += 1;
    });
    prepare?.(window.document);
    window.eval(script);
    beforeLoad?.(window.document);
    if (!isLate) {
        await loaded;
    }
    await tick();
    const { document } = window;
    const root = document.documentElement;
    const handle = () => document.querySelector('[data-sfmc-ux-tools-left-nav-handle]');
    const pointer = (type, clientX) =>
        handle().dispatchEvent(new window.MouseEvent(type, { clientX, button: 0, bubbles: true }));
    return {
        window,
        document,
        storage,
        handle,
        guide: () => document.querySelector('[data-sfmc-ux-tools-left-nav-guide]'),
        pointer,
        resizes: () => resizes,
        collapses: () => collapses,
        expands: () => expands,
        showButton: () => document.querySelector('[data-sfmc-ux-tools-left-nav-show]'),
        areBarsReplaced: () => isSet(root, 'sfmcUxToolsLeftNavBars'),
        reads: () => reads,
        waits: () => timers.filter((timer) => !timer.isCleared).map((timer) => timer.delay),
        expire: () => {
            for (const timer of timers) {
                if (timer.isCleared) {
                    continue;
                }
                timer.isCleared = true;
                timer.callback();
            }
        },
        listeners: () => listeners.length,
        width: () => root.style.getPropertyValue('--sfmc-ux-tools-left-nav-width'),
        isWidened: () => isSet(root, 'sfmcUxToolsLeftNav'),
        drag: (from, to) => {
            pointer('pointerdown', from);
            pointer('pointermove', (from + to) / 2);
            pointer('pointermove', to);
            pointer('pointerup', to);
        },
        key: (key) =>
            handle().dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })),
        change: (change) => {
            for (const listener of listeners) {
                listener({ [KEY]: change }, 'local');
            }
        },
    };
}

test('the menu gets one handle that tells what it is and can be reached with the keyboard', async () => {
    const { handle, document } = await page();
    const element = handle();
    assert.ok(element);
    assert.equal(element.parentElement, document.querySelector('#divLeftNav'));
    assert.equal(element.getAttribute('role'), 'separator');
    assert.equal(element.getAttribute('aria-orientation'), 'vertical');
    assert.equal(element.getAttribute('aria-valuemin'), '170');
    assert.equal(element.getAttribute('aria-valuenow'), '236');
    assert.equal(element.getAttribute('aria-valuemax'), '600');
    assert.equal(element.tabIndex, 0);
    assert.match(element.title, /^SFMC UX Tools: /);
    assert.equal(document.querySelectorAll('[data-sfmc-ux-tools-left-nav-handle]').length, 1);
});

test('nothing changes before the handle is used', async () => {
    const { isWidened, width } = await page();
    assert.equal(isWidened(), false);
    assert.equal(width(), '');
});

test('dragging the handle widens the menu and keeps the width', async () => {
    const { drag, width, isWidened, storage, document, handle } = await page();
    drag(250, 414);
    assert.equal(isWidened(), true);
    assert.equal(width(), '400px');
    assert.equal(handle().getAttribute('aria-valuenow'), '400');
    assert.equal(isSet(document.documentElement, 'sfmcUxToolsLeftNavDragging'), false);
    await tick();
    assert.equal(storage[KEY], 400);
});

test('the frames do not take the moves while the handle is dragged', async () => {
    const { window, document, handle } = await page();
    handle().dispatchEvent(
        new window.MouseEvent('pointerdown', { clientX: 250, button: 0, bubbles: true }),
    );
    assert.equal(isSet(document.documentElement, 'sfmcUxToolsLeftNavDragging'), true);
    handle().dispatchEvent(new window.MouseEvent('pointercancel', { bubbles: true }));
    assert.equal(isSet(document.documentElement, 'sfmcUxToolsLeftNavDragging'), false);
});

test('only the main button drags', async () => {
    const { window, handle, isWidened } = await page();
    handle().dispatchEvent(
        new window.MouseEvent('pointerdown', { clientX: 250, button: 2, bubbles: true }),
    );
    handle().dispatchEvent(new window.MouseEvent('pointermove', { clientX: 500, bubbles: true }));
    assert.equal(isWidened(), false);
});

test('the width stays between 170 pixels and 60% of the window', async () => {
    const { drag, width, key, storage } = await page();
    drag(250, 2000);
    assert.equal(width(), '600px');
    key('Home');
    drag(250, 184);
    assert.equal(width(), '170px');
    await tick();
    assert.equal(storage[KEY], 170);
});

test('a drag that ends left of the least width hides the menu and keeps its width', async () => {
    const { pointer, guide, width, collapses, resizes, storage, handle } = await page({
        stored: { [KEY]: 400 },
    });
    const told = resizes();
    pointer('pointerdown', 414);
    pointer('pointermove', 185);
    assert.equal(guide().style.left, '-223px');
    assert.equal(collapses(), 0);
    pointer('pointermove', 183);
    assert.equal(guide().style.left, '0px');
    pointer('pointerup', 183);
    assert.equal(guide(), null);
    assert.equal(collapses(), 1);
    assert.equal(width(), '400px');
    assert.equal(handle().getAttribute('aria-valuenow'), '400');
    assert.equal(resizes(), told);
    await tick();
    assert.equal(storage[KEY], 400);
});

test('a drag that comes back from left of the least width does not hide the menu', async () => {
    const { pointer, width, collapses } = await page();
    pointer('pointerdown', 250);
    pointer('pointermove', 100);
    pointer('pointermove', 200);
    pointer('pointerup', 200);
    assert.equal(collapses(), 0);
    assert.equal(width(), '186px');
});

test('Email Studio’s two bars are replaced once the handle and the button that shows the menu exist', async () => {
    const { showButton, areBarsReplaced, expands, document } = await page();
    assert.equal(areBarsReplaced(), true);
    const button = showButton();
    assert.ok(button);
    assert.equal(button.previousElementSibling, document.querySelector('#divLeftNav'));
    assert.match(button.title, /^SFMC UX Tools: /);
    assert.equal(button.getAttribute('aria-label'), 'Show the menu');
    assert.equal(button.querySelector('img').src, `${EXTENSION}icons/sidebar-show.svg`);
    assert.equal(document.querySelectorAll('[data-sfmc-ux-tools-left-nav-show]').length, 1);
    button.click();
    assert.equal(expands(), 1);
});

test('a press on the handle without a move neither hides the menu nor changes its width', async () => {
    const { pointer, collapses, isWidened, resizes } = await page();
    pointer('pointerdown', 250);
    pointer('pointerup', 250);
    assert.equal(collapses(), 0);
    assert.equal(isWidened(), false);
    assert.equal(resizes(), 0);
});

test('the focus follows what is left to use: the button of a menu hidden by a drag, the handle of a shown one', async () => {
    const { pointer, showButton, handle, document } = await page();
    pointer('pointerdown', 250);
    pointer('pointermove', 100);
    pointer('pointerup', 100);
    assert.equal(document.activeElement, showButton());
    showButton().click();
    assert.equal(document.activeElement, handle());
});

test('without one of Email Studio’s bars both stay as they are, and the handle still works', async () => {
    for (const html of [MENU, LAYOUT.replace('id="collapseLeftNav"', 'id="other"')]) {
        const { showButton, areBarsReplaced, drag, width } = await page({ html });
        assert.equal(areBarsReplaced(), false);
        assert.equal(showButton(), null);
        drag(250, 350);
        assert.equal(width(), '336px');
    }
});

test('the button above the menu gets the icon of a side bar, again after the menu’s content is loaded again', async () => {
    const BUTTON = '<img alt="Toggle Navigation" src="arrows-collapse.png">';
    const { document, window } = await page({
        prepare: (document) => {
            inner(document).body.innerHTML = BUTTON;
        },
    });
    const image = () => inner(document).querySelector('img');
    assert.equal(image().src, `${EXTENSION}icons/sidebar-hide.svg`);
    assert.match(image().title, /^SFMC UX Tools: /);
    inner(document).body.innerHTML = BUTTON;
    document.querySelector('#fraLeftNav').dispatchEvent(new window.Event('load'));
    assert.equal(image().src, `${EXTENSION}icons/sidebar-hide.svg`);
    const plain = await page();
    assert.ok(plain.handle());
});

test('a double-click gives the menu its own width back and forgets the kept one', async () => {
    const { window, handle, isWidened, storage } = await page({ stored: { [KEY]: 420 } });
    assert.equal(isWidened(), true);
    handle().dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    assert.equal(isWidened(), false);
    await tick();
    assert.equal(Object.hasOwn(storage, KEY), false);
});

test('the arrow keys, Home and End change the width', async () => {
    const { key, width, isWidened } = await page();
    key('ArrowRight');
    assert.equal(width(), '252px');
    key('ArrowRight');
    key('ArrowLeft');
    assert.equal(width(), '252px');
    key('End');
    assert.equal(width(), '600px');
    key('Home');
    assert.equal(isWidened(), false);
    key('ArrowLeft');
    assert.equal(width(), '220px');
    for (let press = 0; press < 5; press += 1) {
        key('ArrowLeft');
    }
    assert.equal(width(), '170px');
});

test('the keys never hide the menu', async () => {
    const { key, collapses } = await page({ stored: { [KEY]: 170 } });
    key('ArrowLeft');
    key('Home');
    assert.equal(collapses(), 0);
});

test('other keys are left to the page', async () => {
    const { window, handle, isWidened } = await page();
    const event = new window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
    });
    handle().dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(isWidened(), false);
});

test('the kept width is shown when the page opens, and an odd one is not', async () => {
    assert.equal((await page({ stored: { [KEY]: 380 } })).width(), '380px');
    assert.equal((await page({ stored: { [KEY]: 'wide' } })).isWidened(), false);
    assert.equal((await page({ stored: { [KEY]: 5000 } })).width(), '600px');
    assert.equal((await page({ stored: { [KEY]: 50 } })).width(), '170px');
});

test('a width kept in another tab is taken over', async () => {
    const { change, width, isWidened } = await page();
    change({ newValue: 450 });
    assert.equal(width(), '450px');
    change({ oldValue: 450 });
    assert.equal(isWidened(), false);
});

test('a narrower window narrows the menu, and a wider one gives the kept width back', async () => {
    const { window, width } = await page({ stored: { [KEY]: 550 } });
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(width(), '480px');
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(width(), '550px');
});

test('a menu that Email Studio draws while the page loads gets its handle too', async () => {
    const { handle, width, waits } = await page({
        html: '<div id="legacy"></div>',
        stored: { [KEY]: 420 },
        beforeLoad: (document) => {
            document.querySelector('#legacy').insertAdjacentHTML('beforeend', LAYOUT);
        },
    });
    assert.ok(handle());
    assert.equal(width(), '420px');
    assert.deepEqual(waits(), []);
});

test('a menu that Email Studio draws a while after the page has loaded gets its handle too', async () => {
    const { document, handle, width, waits, reads } = await page({
        html: '<div id="legacy"></div>',
        stored: { [KEY]: 420 },
    });
    assert.equal(document.readyState, 'complete');
    assert.deepEqual(waits(), [10_000]);
    assert.equal(reads(), 0);
    document.querySelector('#legacy').insertAdjacentHTML('beforeend', LAYOUT);
    await tick();
    assert.ok(handle());
    assert.equal(width(), '420px');
    assert.deepEqual(waits(), []);
});

test('a frame without the menu reads nothing, listens for nothing and stops watching 10 seconds after it loaded', async () => {
    const { window, document, handle, reads, listeners, resizes, isWidened, expire } = await page({
        html: '<div id="legacy"></div>',
        stored: { [KEY]: 420 },
    });
    expire();
    document.querySelector('#legacy').insertAdjacentHTML('beforeend', LAYOUT);
    await tick();
    assert.equal(handle(), null);
    assert.equal(reads(), 0);
    assert.equal(listeners(), 0);
    assert.equal(resizes(), 0);
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(resizes(), 1);
    assert.equal(isWidened(), false);
});

test('a frame that had loaded already when the script came waits the same while', async () => {
    const late = await page({ html: '<div id="legacy"></div>', isLate: true });
    assert.deepEqual(late.waits(), [10_000]);
    late.document.querySelector('#legacy').insertAdjacentHTML('beforeend', LAYOUT);
    await tick();
    assert.ok(late.handle());

    const empty = await page({ html: '<div id="legacy"></div>', isLate: true });
    empty.expire();
    empty.document.querySelector('#legacy').insertAdjacentHTML('beforeend', LAYOUT);
    await tick();
    assert.equal(empty.handle(), null);
    assert.equal(empty.reads(), 0);
    assert.equal(empty.listeners(), 0);
});

test('without its storage the menu can still be dragged', async () => {
    const { drag, width } = await page({ isBroken: true });
    drag(250, 350);
    await tick();
    assert.equal(width(), '336px');
});

test('the stylesheet follows the width only while the menu is widened, and leaves a collapsed menu to Email Studio', () => {
    assert.match(css, /html\[data-sfmc-ux-tools-left-nav\] #divLeftNav \{/);
    assert.match(css, /html\[data-sfmc-ux-tools-left-nav\] #collapseLeftNav \{/);
    assert.match(css, /html\[data-sfmc-ux-tools-left-nav\] #divContent:not\(\.expanded\) \{/);
});

test('the stylesheet hides Email Studio’s bars only once the script has replaced them', () => {
    const rules = css
        .split('}')
        .filter((rule) => /#(?:collapse|expand)LeftNav[^{]*\{\s*display: none/.test(rule));
    assert.equal(rules.length, 1);
    const selectors = rules[0].split('{', 1)[0].split(',');
    for (const selector of selectors) {
        assert.match(
            selector.trim(),
            /^html\[data-sfmc-ux-tools-left-nav-bars\] #(?:collapse|expand)LeftNav$/,
        );
    }
    assert.match(css, /html\[data-sfmc-ux-tools-left-nav-bars\] #divContent\.expanded \{/);
    assert.match(css, /\[data-sfmc-ux-tools-left-nav-show\] \{[^}]*display: none;/);
    // a hidden menu always has its button: it is shown under the same mark that hides the bars
    assert.match(
        css,
        /html\[data-sfmc-ux-tools-left-nav-bars\]:has\(#divContent\.expanded\)\s+\[data-sfmc-ux-tools-left-nav-show\] \{\s*display: block;/,
    );
});

test('the handle shows a grip and the pointer of a width that can be dragged', () => {
    assert.match(css, /\[data-sfmc-ux-tools-left-nav-handle\] \{[^}]*cursor: col-resize;/);
    assert.match(css, /\[data-sfmc-ux-tools-left-nav-handle\]::after \{[^}]*radial-gradient/);
});

test('the manifest runs the script and its stylesheet in Email Studio’s frame, without a new permission', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entries = manifest.content_scripts.filter((item) =>
        item.js.includes('email-studio-left-nav.js'),
    );
    assert.deepEqual(entries, [
        {
            matches: ['https://*.exacttarget.com/C12/Default.aspx*'],
            js: ['email-studio-left-nav.js'],
            css: ['email-studio-left-nav.css'],
            all_frames: true,
            run_at: 'document_idle',
        },
    ]);
    assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
    assert.deepEqual(manifest.host_permissions, ['https://*.marketingcloudapps.com/*']);
    const icons = manifest.web_accessible_resources.filter((item) =>
        item.resources.some((resource) => resource.startsWith('icons/sidebar-')),
    );
    assert.deepEqual(icons, [
        {
            resources: ['icons/sidebar-hide.svg', 'icons/sidebar-show.svg'],
            matches: ['https://*.exacttarget.com/*'],
        },
    ]);
});

test('while the handle is dragged only a line moves, and the width changes once it is let go', async () => {
    const { pointer, guide, width, isWidened, resizes, storage, handle } = await page();
    pointer('pointerdown', 250);
    assert.ok(guide());
    assert.equal(guide().style.left, '6px');
    pointer('pointermove', 300);
    pointer('pointermove', 414);
    assert.equal(guide().style.left, '170px');
    assert.equal(handle().getAttribute('aria-valuenow'), '400');
    assert.equal(isWidened(), false);
    assert.equal(width(), '');
    assert.equal(resizes(), 0);
    pointer('pointermove', 5000);
    assert.equal(guide().style.left, '370px');
    pointer('pointermove', 414);
    pointer('pointerup', 414);
    assert.equal(guide(), null);
    assert.equal(width(), '400px');
    assert.equal(resizes(), 1);
    await tick();
    assert.equal(storage[KEY], 400);
});

test('a drag that is cancelled, or ends where it began, changes nothing', async () => {
    const { pointer, guide, isWidened, resizes, storage, handle } = await page();
    pointer('pointerdown', 250);
    pointer('pointermove', 400);
    pointer('pointercancel', 400);
    assert.equal(guide(), null);
    assert.equal(isWidened(), false);
    assert.equal(handle().getAttribute('aria-valuenow'), '236');
    pointer('pointerdown', 250);
    pointer('pointermove', 400);
    pointer('pointermove', 250);
    pointer('pointerup', 250);
    assert.equal(isWidened(), false);
    assert.equal(resizes(), 0);
    await tick();
    assert.equal(Object.hasOwn(storage, KEY), false);
});

test('the keys, a double-click and a width from another tab tell Email Studio too, but only when the width changed', async () => {
    const { window, handle, key, change, resizes } = await page();
    key('ArrowRight');
    assert.equal(resizes(), 1);
    handle().dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    assert.equal(resizes(), 2);
    handle().dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    key('Home');
    assert.equal(resizes(), 2);
    change({ newValue: 300 });
    assert.equal(resizes(), 3);
});

test('a kept width tells Email Studio once when the page opens, and Email Studio’s own width does not', async () => {
    assert.equal((await page({ stored: { [KEY]: 380 } })).resizes(), 1);
    assert.equal((await page()).resizes(), 0);
});

test('a resize of the window does not start a loop, and a menu narrowed by it tells Email Studio once more', async () => {
    const { window, resizes } = await page({ stored: { [KEY]: 550 } });
    assert.equal(resizes(), 1);
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(resizes(), 2);
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(resizes(), 4);
});
