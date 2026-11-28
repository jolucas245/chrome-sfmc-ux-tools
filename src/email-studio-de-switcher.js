/*
 * SFMC UX Tools — content script for the list of the other data extensions of a folder, opened
 * from the path above an open data extension in Email Studio.
 *
 * deep-link-email-studio-page.js tells which view Email Studio shows. While it is a data
 * extension, the last step of the path above it, its name, and a button after that step open a
 * list of the data extensions of the same folder, which the Marketing Cloud page reads on each
 * opening through the background script. A data extension that is picked is opened by Email
 * Studio's own route, through the same script. Only while a data extension is open does the
 * script watch Email Studio's content for the path to be drawn.
 */
(() => {
    'use strict';

    const STATE_EVENT = 'sfmc-ux-tools:email-studio:state';
    const GO_EVENT = 'sfmc-ux-tools:email-studio:go';
    const LIST_MESSAGE = 'sfmc-ux-tools:de-switcher:list';
    const OPEN_DE =
        /^de-pages\/de\/([\dA-Fa-f]{8}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{12})$/;
    const NO_VIEW = new Set(['none', 'cleared']);
    const ROUTE = 'Subscribers/customobject/';
    const STEPS = '.op-head .lg-head-breadcrumb > .breadcrumb-step';
    const CONTENT = '#carbon-legacy-dynamic';
    const TRIGGER = 'data-sfmc-ux-tools-de-switcher';
    // what the script sets on the step of the path, and gives back as it was
    const MARKS = [TRIGGER, 'role', 'tabindex', 'aria-haspopup', 'title'];
    const BUTTON = 'sfmc-ux-tools-de-switcher-button';
    const PANEL = 'sfmc-ux-tools-de-switcher-panel';
    const ITEM = 'sfmc-ux-tools-de-switcher-item';
    // pixels between the path and the list, and between the list and the edge of the window
    const PANEL_GAP = 6;
    const PANEL_MARGIN = 8;
    // the width in email-studio-de-switcher.css, for when the list has not been laid out yet
    const PANEL_WIDTH = 360;
    const MADE_BY = 'SFMC UX Tools';
    const TITLE = `${MADE_BY}: the other data extensions of this folder. Pick one to open it.`;
    const LOADING = 'Loading…';
    const FAILED = 'The data extensions of this folder could not be read.';
    const EMPTY = 'No data extension matches.';
    let current;
    let step;
    let button;
    let panel;
    let entries = [];
    let asked = 0;
    let before = new Map();
    let watched;

    /**
     * Makes the extension's icon, which says what the extension added here.
     *
     * @returns {HTMLImageElement} the icon
     */
    function icon() {
        const image = document.createElement('img');
        image.src = chrome.runtime.getURL('icons/icon16.png');
        image.alt = '';
        image.width = 16;
        image.height = 16;
        return image;
    }

    /**
     * Writes how many data extensions are listed, or why none are.
     *
     * @param {string} text what to say
     */
    function say(text) {
        const status = panel?.querySelector('[role="status"]');
        if (status) {
            status.textContent = text;
        }
    }

    /**
     * Opens a data extension by Email Studio's own route.
     *
     * @param {string} id id of the data extension
     */
    function go(id) {
        close();
        if (id === current) {
            return;
        }
        document.dispatchEvent(new CustomEvent(GO_EVENT, { detail: ROUTE + id }));
    }

    /**
     * Shows the data extensions whose name holds the text of the search box.
     */
    function render() {
        const list = panel?.querySelector('ul');
        if (!list) {
            return;
        }
        const search = panel.querySelector('input').value.trim().toLowerCase();
        const shown = entries.filter((entry) => entry.name.toLowerCase().includes(search));
        list.replaceChildren(
            ...shown.map((entry) => {
                const item = document.createElement('li');
                const choice = document.createElement('button');
                choice.type = 'button';
                choice.className = ITEM;
                choice.textContent = entry.name;
                if (entry.id === current) {
                    choice.setAttribute('aria-current', 'true');
                }
                choice.addEventListener('click', () => go(entry.id));
                item.append(choice);
                return item;
            }),
        );
        if (entries.length > 0) {
            say(shown.length === 0 ? EMPTY : `${shown.length} of ${entries.length}`);
        }
    }

    /**
     * Moves the focus between the search box and the data extensions with the arrow keys.
     *
     * @param {KeyboardEvent} event a key pressed in the list
     */
    function onKey(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            (step ?? button)?.focus();
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }
        event.preventDefault();
        const places = [panel.querySelector('input'), ...panel.querySelectorAll(`.${ITEM}`)];
        const at = places.indexOf(document.activeElement);
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        places[Math.min(places.length - 1, Math.max(0, at + direction))].focus();
    }

    /**
     * Closes the list when the user clicks anywhere else.
     *
     * @param {PointerEvent} event a press somewhere on the page
     */
    function onOutside(event) {
        const isOurs = [panel, button, step].some((element) => element?.contains(event.target));
        if (!isOurs) {
            close();
        }
    }

    /**
     * Closes the list.
     */
    function close() {
        if (!panel) {
            return;
        }
        panel.remove();
        panel = undefined;
        entries = [];
        button?.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onOutside, { capture: true });
    }

    /**
     * Opens the list below the button and asks for the data extensions of the folder.
     */
    async function open() {
        if (panel || !button || !current) {
            return;
        }
        panel = document.createElement('div');
        panel.className = PANEL;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Data extensions of this folder');
        const head = document.createElement('div');
        head.title = TITLE;
        head.append(icon(), 'Data extensions of this folder');
        const search = document.createElement('input');
        search.type = 'search';
        search.placeholder = 'Search';
        search.setAttribute('aria-label', 'Search the data extensions of this folder');
        search.addEventListener('input', render);
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        const list = document.createElement('ul');
        panel.append(head, search, status, list);
        panel.addEventListener('keydown', onKey);
        const { left } = (step ?? button).getBoundingClientRect();
        const bottom = Math.max(
            ...[step, button].map((element) => element?.getBoundingClientRect().bottom ?? 0),
        );
        panel.style.top = `${Math.round(bottom + PANEL_GAP)}px`;
        document.body.append(panel);
        const width = panel.getBoundingClientRect().width || PANEL_WIDTH;
        const inside = Math.min(left, innerWidth - width - PANEL_MARGIN);
        panel.style.left = `${Math.round(Math.max(PANEL_MARGIN, inside))}px`;
        button.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', onOutside, { capture: true });
        search.focus();
        say(LOADING);

        asked += 1;
        const question = asked;
        const asking = current;
        let answer;
        try {
            answer = await chrome.runtime.sendMessage({ type: LIST_MESSAGE, id: asking });
        } catch {
            // no answer: told below
        }
        if (question !== asked || !panel || asking !== current) {
            return;
        }
        if (!Array.isArray(answer?.items) || answer.items.length === 0) {
            say(FAILED);
            return;
        }
        entries = answer.items;
        render();
        list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
        if (answer.isCut === true) {
            say(`${panel.querySelector('[role="status"]').textContent}; the folder has more`);
        }
    }

    /**
     * Opens the list, or closes it when it is open.
     */
    function toggle() {
        if (panel) {
            close();
        } else {
            open();
        }
    }

    /**
     * Opens the list from the step of the path with Enter or Space.
     *
     * @param {KeyboardEvent} event a key pressed on the step
     */
    function onStepKey(event) {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        event.preventDefault();
        toggle();
    }

    /**
     * Gives the step of the path back to Email Studio as it was.
     */
    function release() {
        if (!step) {
            return;
        }
        for (const [name, value] of before) {
            if (value === null) {
                step.removeAttribute(name);
                continue;
            }
            step.setAttribute(name, value);
        }
        before = new Map();
        step.removeEventListener('click', toggle);
        step.removeEventListener('keydown', onStepKey);
        step = undefined;
    }

    /**
     * Makes the name of the data extension in the path open the list, and puts the button after
     * it, or takes both away when no data extension is open.
     */
    function sync() {
        const found = current ? [...document.querySelectorAll(STEPS)].at(-1) : undefined;
        if (!found) {
            close();
            release();
            button?.remove();
            button = undefined;
            return;
        }
        if (found === step && button?.isConnected && button.previousElementSibling === found) {
            return;
        }
        release();
        button?.remove();
        step = found;
        before = new Map(MARKS.map((name) => [name, step.getAttribute(name)]));
        step.setAttribute(TRIGGER, '');
        step.setAttribute('role', 'button');
        step.setAttribute('tabindex', '0');
        step.setAttribute('aria-haspopup', 'dialog');
        step.title = TITLE;
        step.addEventListener('click', toggle);
        step.addEventListener('keydown', onStepKey);
        button = document.createElement('button');
        button.type = 'button';
        button.className = BUTTON;
        button.title = TITLE;
        button.setAttribute('aria-label', 'Other data extensions of this folder');
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', toggle);
        step.after(button);
    }

    document.addEventListener(STATE_EVENT, (event) => {
        const text = event.detail;
        if (typeof text !== 'string') {
            return;
        }
        const id = OPEN_DE.exec(text)?.[1];
        if (id === undefined && !NO_VIEW.has(text) && !text.includes('/')) {
            return;
        }
        if (id !== current) {
            close();
        }
        current = id;
        sync();
        watch();
    });

    const observer = new MutationObserver(() => {
        sync();
        watch();
    });

    /**
     * Watches Email Studio's content while a data extension is open, so that a path that is drawn
     * again gets the list again, and nothing at all otherwise. Until the content is there, the
     * whole document is watched.
     */
    function watch() {
        const target = current
            ? (document.querySelector(CONTENT) ?? document.documentElement)
            : undefined;
        if (target === watched) {
            return;
        }
        observer.disconnect();
        watched = target;
        if (target) {
            observer.observe(target, { childList: true, subtree: true });
        }
    }
})();
