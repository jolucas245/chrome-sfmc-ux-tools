/*
 * SFMC UX Tools — content script for the width of the menu on the left of Email Studio.
 *
 * Adds a handle to the right edge of the menu that can be dragged, or moved with the arrow keys.
 * The width is kept in chrome.storage.local and written to a custom property of the html element,
 * where email-studio-left-nav.css reads it.
 *
 * The handle takes the place of the bar with which Email Studio collapses the menu, so that there
 * is one control for the width and one for hiding: the button above the menu, which Email Studio
 * has already and which gets the icon known from other apps here. A drag that ends left of the
 * least width hides the menu, as in VS Code. A hidden menu gets a button with the same icon in
 * the place of Email Studio's bar that expands it. Hiding and showing itself stays Email Studio's:
 * the script only clicks its two bars.
 * Only the frame that has the menu does any of this; any other frame stops watching a while after
 * it has loaded.
 * Email Studio only lays its tables out again when the window is resized, so once the width has
 * changed, the window is told that it was.
 */
(() => {
    'use strict';

    const STORAGE_KEY = 'emailStudioLeftNavWidth';
    const PROPERTY = '--sfmc-ux-tools-left-nav-width';
    const WIDENED = 'data-sfmc-ux-tools-left-nav';
    const DRAGGING = 'data-sfmc-ux-tools-left-nav-dragging';
    const HANDLE = 'data-sfmc-ux-tools-left-nav-handle';
    const GUIDE = 'data-sfmc-ux-tools-left-nav-guide';
    // the middle of the handle, which is 12px wide
    const GUIDE_OFFSET = 6;
    // set on the html element once the handle and the button that shows a hidden menu exist; only
    // then does the stylesheet hide Email Studio's two bars, so the menu can always be brought back
    const REPLACED = 'data-sfmc-ux-tools-left-nav-bars';
    const SHOW = 'data-sfmc-ux-tools-left-nav-show';
    const TOGGLED = 'data-sfmc-ux-tools-left-nav-toggle';
    // Email Studio's own: the bar in the menu that collapses it, the bar that expands a collapsed
    // one, the frame with the menu's content, and the button above the menu that collapses it
    const COLLAPSE_BAR = '#collapseLeftNav';
    const EXPAND_BAR = '#expandLeftNav';
    const MENU_FRAME = '#fraLeftNav';
    const TOGGLE_IMAGE = 'img[alt="Toggle Navigation"]';
    const HIDE_ICON = 'icons/sidebar-hide.svg';
    const SHOW_ICON = 'icons/sidebar-show.svg';
    const HANDLE_SELECTOR = '[data-sfmc-ux-tools-left-nav-handle]';
    const NAV = '#divLeftNav';
    const NATIVE_WIDTH = 236;
    // the least width of the side bar of VS Code, whose drag this one follows: a drag that ends
    // left of it hides the menu. Seen live: Email Studio's menu still draws well at this width
    const LEAST_WIDTH = 170;
    const MOST_SHARE = 0.6;
    const STEP = 16;
    // seen live: Email Studio draws the menu about a second after its frame has loaded
    const LOADED_WAIT = 10_000;
    const TITLE =
        'SFMC UX Tools: drag to change the width of the menu, or far to the left to hide it. Double-click for its original width.';
    const HIDE_TITLE = 'SFMC UX Tools: hide the menu';
    const SHOW_TITLE = 'SFMC UX Tools: show the menu';
    let wanted = NATIVE_WIDTH;
    let shown = NATIVE_WIDTH;
    let settled = NATIVE_WIDTH;
    let handle;
    let showButton;

    /**
     * Tells how wide the menu may be in the window as it is now.
     *
     * @returns {number} the widest width in pixels, never below Email Studio's own
     */
    function widest() {
        return Math.max(NATIVE_WIDTH, Math.round(innerWidth * MOST_SHARE));
    }

    /**
     * Keeps a width between the least and the widest one.
     *
     * @param {unknown} value a width in pixels
     * @returns {number} the width that is used; Email Studio's own for anything but a number
     */
    function clamp(value) {
        const number = Number(value);
        return Number.isFinite(number)
            ? Math.min(widest(), Math.max(LEAST_WIDTH, Math.round(number)))
            : NATIVE_WIDTH;
    }

    /**
     * Hides the menu the way Email Studio does it, by a click on its own bar.
     */
    function hide() {
        document.querySelector(COLLAPSE_BAR)?.click();
    }

    /**
     * Shows the wanted width, as far as the window allows it.
     */
    function show() {
        const width = clamp(wanted);
        shown = width;
        const root = document.documentElement;
        if (width === NATIVE_WIDTH) {
            root.removeAttribute(WIDENED);
            root.style.removeProperty(PROPERTY);
        } else {
            root.setAttribute(WIDENED, '');
            root.style.setProperty(PROPERTY, `${width}px`);
        }
        if (!handle) {
            return;
        }
        handle.setAttribute('aria-valuenow', String(width));
        handle.setAttribute('aria-valuemax', String(widest()));
    }

    /**
     * Takes a new width and shows it.
     *
     * @param {unknown} value a width in pixels
     */
    function want(value) {
        wanted = clamp(value);
        show();
    }

    /**
     * Has Email Studio lay the page out again for the width that is shown, once per change.
     */
    function settle() {
        if (shown === settled) {
            return;
        }
        settled = shown;
        dispatchEvent(new Event('resize'));
    }

    /**
     * Keeps the wanted width for the next visit; Email Studio's own width is not kept.
     */
    async function save() {
        try {
            await (wanted === NATIVE_WIDTH
                ? chrome.storage.local.remove(STORAGE_KEY)
                : chrome.storage.local.set({ [STORAGE_KEY]: wanted }));
        } catch {
            // the width stays for this page only
        }
    }

    /**
     * Reads the width that was kept.
     */
    async function load() {
        try {
            const values = await chrome.storage.local.get({ [STORAGE_KEY]: NATIVE_WIDTH });
            want(values[STORAGE_KEY]);
            settle();
        } catch {
            // Email Studio's own width stays
        }
    }

    /**
     * Lets the handle be dragged; the pointer is captured, so the frames do not take the moves.
     * While it is dragged, only a line shows where the edge will be: seen live, Email Studio's
     * tables lose their rows for a moment whenever the room for them gets smaller, also when the
     * window itself is made narrower. The width changes once, when the handle is let go. Left of
     * the least width the line jumps to the left edge of the menu: let go there, the menu is
     * hidden and keeps the width it had.
     *
     * @param {PointerEvent} event the press on the handle
     */
    function startDrag(event) {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = clamp(wanted);
        const startLeft = handle.getBoundingClientRect().left;
        const menuLeft = handle.parentElement.getBoundingClientRect().left;
        let width = startWidth;
        let isHiding = false;
        try {
            handle.setPointerCapture(event.pointerId);
        } catch {
            // the root's attribute keeps the frames from taking the moves
        }
        document.documentElement.setAttribute(DRAGGING, '');
        const guide = document.createElement('div');
        guide.setAttribute(GUIDE, '');

        /**
         * Puts the line where the edge will be.
         */
        const place = () => {
            const left = isHiding ? menuLeft : startLeft + width - startWidth + GUIDE_OFFSET;
            guide.style.left = `${Math.round(left)}px`;
        };
        place();
        document.body.append(guide);

        /**
         * Follows the pointer with the line.
         *
         * @param {PointerEvent} move a move of the pointer
         */
        const follow = (move) => {
            const asked = startWidth + move.clientX - startX;
            isHiding = asked < LEAST_WIDTH;
            width = clamp(asked);
            place();
            handle.setAttribute('aria-valuenow', String(width));
        };

        /**
         * Ends the drag: a let-go handle takes the width of the line, or hides the menu when it
         * was let go left of the least width; a cancelled drag keeps the width it had.
         *
         * @param {PointerEvent} end the end of the drag
         */
        const stop = (end) => {
            handle.removeEventListener('pointermove', follow);
            handle.removeEventListener('pointerup', stop);
            handle.removeEventListener('pointercancel', stop);
            document.documentElement.removeAttribute(DRAGGING);
            guide.remove();
            if (end.type !== 'pointerup') {
                show();
                return;
            }
            if (isHiding) {
                show();
                hide();
                // the handle is hidden with the menu: the focus goes to what shows it again
                showButton?.focus();
                return;
            }
            want(width);
            settle();
            save();
        };
        handle.addEventListener('pointermove', follow);
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
    }

    /**
     * Changes the width with the arrow keys, Home and End.
     *
     * @param {KeyboardEvent} event a key pressed on the handle
     */
    function onKey(event) {
        const widths = {
            ArrowLeft: wanted - STEP,
            ArrowRight: wanted + STEP,
            Home: NATIVE_WIDTH,
            End: widest(),
        };
        if (!Object.hasOwn(widths, event.key)) {
            return;
        }
        event.preventDefault();
        want(widths[event.key]);
        settle();
        save();
    }

    /**
     * Gives the menu its handle, once.
     *
     * @param {Element} nav the menu on the left
     */
    function addHandle(nav) {
        if (nav.querySelector(HANDLE_SELECTOR)) {
            return;
        }
        handle = document.createElement('div');
        handle.setAttribute(HANDLE, '');
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', 'Width of the menu');
        handle.setAttribute('aria-valuemin', String(LEAST_WIDTH));
        handle.tabIndex = 0;
        handle.title = TITLE;
        handle.addEventListener('pointerdown', startDrag);
        handle.addEventListener('dblclick', () => {
            want(NATIVE_WIDTH);
            settle();
            save();
        });
        handle.addEventListener('keydown', onKey);
        nav.append(handle);
        show();
    }

    /**
     * Gives the button above the menu, which collapses it, the icon of a side bar. Email Studio
     * loads the content of the menu again for every section, so this runs after each load. When
     * the button is not there, or the extension was updated meanwhile, Email Studio's own stays.
     *
     * @param {HTMLIFrameElement} frame the frame with the content of the menu
     */
    function dress(frame) {
        try {
            const image = frame.contentDocument?.querySelector(TOGGLE_IMAGE);
            if (!image || image.hasAttribute(TOGGLED)) {
                return;
            }
            image.src = chrome.runtime.getURL(HIDE_ICON);
            image.title = HIDE_TITLE;
            image.setAttribute(TOGGLED, '');
        } catch {
            // Email Studio's own button stays
        }
    }

    /**
     * Adds the button that shows a hidden menu, in the place of Email Studio's bar for it, and
     * only then has the stylesheet hide Email Studio's two bars.
     *
     * @param {Element} nav the menu on the left
     */
    function replaceBars(nav) {
        const expand = document.querySelector(EXPAND_BAR);
        if (
            !expand ||
            !nav.querySelector(COLLAPSE_BAR) ||
            document.querySelector(`[${CSS.escape(SHOW)}]`)
        ) {
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute(SHOW, '');
        button.setAttribute('aria-label', 'Show the menu');
        button.title = SHOW_TITLE;
        const image = document.createElement('img');
        image.src = chrome.runtime.getURL(SHOW_ICON);
        image.alt = '';
        button.append(image);
        button.addEventListener('click', () => {
            expand.click();
            // the button is hidden with the menu shown: the focus goes to the handle
            handle?.focus();
        });
        nav.after(button);
        showButton = button;
        document.documentElement.setAttribute(REPLACED, '');
    }

    /**
     * Starts the feature in the frame that has the menu: the handle, the two buttons, the kept
     * width, and the changes of the width in other tabs and of the size of the window.
     *
     * @param {Element} nav the menu on the left
     */
    function start(nav) {
        addHandle(nav);
        try {
            replaceBars(nav);
        } catch {
            // Email Studio's own bars stay
        }
        const frame = nav.querySelector(MENU_FRAME);
        if (frame) {
            dress(frame);
            frame.addEventListener('load', () => dress(frame));
        }
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !Object.hasOwn(changes, STORAGE_KEY)) {
                return;
            }
            want(changes[STORAGE_KEY].newValue ?? NATIVE_WIDTH);
            settle();
        });
        addEventListener('resize', () => {
            show();
            settle();
        });
        load();
    }

    /**
     * Waits for the menu, which Email Studio draws about a second after its frame has loaded, in
     * every section. A frame that has no menu a while after it loaded is left alone from then on.
     */
    function findNav() {
        const nav = document.querySelector(NAV);
        if (nav) {
            start(nav);
            return;
        }
        let timer;
        const observer = new MutationObserver(() => {
            const found = document.querySelector(NAV);
            if (!found) {
                return;
            }
            observer.disconnect();
            clearTimeout(timer);
            removeEventListener('load', wait);
            start(found);
        });

        /**
         * Gives the menu a while to appear, then stops waiting for it.
         */
        function wait() {
            timer = setTimeout(() => observer.disconnect(), LOADED_WAIT);
        }
        observer.observe(document.documentElement, { childList: true, subtree: true });
        if (document.readyState === 'complete') {
            wait();
        } else {
            addEventListener('load', wait, { once: true });
        }
    }

    findNav();
})();
