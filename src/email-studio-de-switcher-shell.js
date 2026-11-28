/*
 * SFMC UX Tools — script of the Marketing Cloud page for the list of data extensions that Email
 * Studio's frame opens from the path above an open data extension.
 *
 * Asked by the background script for the folder of one data extension, it reads that data
 * extension and the data extensions of its folder from Marketing Cloud's documented REST API
 * (data/v1/customobjects), through this page, and answers with the folder and the id and name of
 * each data extension that Email Studio lists, nothing else. It reads nothing until it is asked,
 * and it changes nothing.
 */
(() => {
    'use strict';

    const LIST_MESSAGE = 'sfmc-ux-tools:de-switcher:list';
    const API = '/cloud/fuelapi/data/v1/customobjects/';
    // what Email Studio lists in a folder: data extensions and filtered data extensions. The
    // channels' own data extensions (481, Contacts) and Audience Builder's results (364,
    // Audience) are in the folder too, but Email Studio does not show them
    const LISTED_TYPES = new Set([310, 743]);
    const DE_ID = /^[\dA-Fa-f]{8}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{12}$/;
    const PAGE_SIZE = 25;
    const MOST_PAGES = 40;
    // the pages after the first that are read at the same time
    const PAGES_AT_ONCE = 6;
    const MOST_NAME = 200;

    /**
     * Says whether a value is an object with fields.
     *
     * @param {unknown} value the value
     * @returns {boolean} true when it is
     */
    const isRecord = (value) => typeof value === 'object' && value !== null;

    /**
     * Reads from Marketing Cloud's API through this page. It never throws.
     *
     * @param {string} path what follows the address of the data extensions
     * @returns {Promise.<object|undefined>} the answer; nothing when there is none or it is an error
     */
    async function ask(path) {
        try {
            const response = await fetch(API + path, {
                cache: 'no-store',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
                method: 'GET',
                redirect: 'error',
            });
            if (!response.ok) {
                return;
            }
            const body = await response.json();
            return isRecord(body) ? body : undefined;
        } catch {
            // no answer, or one that is no JSON: not read
        }
    }

    /**
     * Reads one page of the data extensions of a folder.
     *
     * @param {number} folder id of the folder
     * @param {number} page number of the page, from 1
     * @returns {Promise.<object|undefined>} the page; nothing when it could not be read
     */
    async function pageOf(folder, page) {
        const body = await ask(
            `category/${folder}?$page=${page}&$pagesize=${PAGE_SIZE}&$orderBy=Name%20ASC`,
        );
        return Array.isArray(body?.items) ? body : undefined;
    }

    /**
     * Keeps the id and the name of each data extension on a page, and nothing else.
     *
     * @param {object} page a page of the list
     * @returns {{id: string, name: string}[]} the data extensions
     */
    function entriesOf(page) {
        return page.items
            .filter(
                (item) =>
                    isRecord(item) &&
                    LISTED_TYPES.has(item.partnerApiObjectTypeId) &&
                    typeof item.id === 'string' &&
                    DE_ID.test(item.id) &&
                    typeof item.name === 'string' &&
                    item.name.length > 0 &&
                    item.name.length <= MOST_NAME,
            )
            .map(({ id, name }) => ({ id, name }));
    }

    /**
     * Lists the data extensions of the folder of a data extension.
     *
     * @param {string} id id of the data extension
     * @returns {Promise.<{folder: number, items: {id: string, name: string}[], isCut: boolean}|{isFailed: true}>} the list; isFailed when it could not be read
     */
    async function list(id) {
        const folder = (await ask(id))?.categoryId;
        if (!Number.isSafeInteger(folder) || folder < 0) {
            return { isFailed: true };
        }
        const first = await pageOf(folder, 1);
        if (!first) {
            return { isFailed: true };
        }
        const count = Number.isSafeInteger(first.count) ? first.count : first.items.length;
        const pages = Math.min(MOST_PAGES, Math.ceil(count / PAGE_SIZE));
        const all = [first];
        for (let from = 2; from <= pages; from += PAGES_AT_ONCE) {
            const numbers = Array.from(
                { length: Math.min(PAGES_AT_ONCE, pages - from + 1) },
                (_, index) => from + index,
            );
            const read = await Promise.all(numbers.map((page) => pageOf(folder, page)));
            if (read.includes(undefined)) {
                return { isFailed: true };
            }
            all.push(...read);
            if (read.some((page) => page.items.length === 0)) {
                break;
            }
        }
        const seen = new Set();
        const items = all
            .flatMap((page) => entriesOf(page))
            .filter((item) => {
                const isNew = !seen.has(item.id);
                seen.add(item.id);
                return isNew;
            });
        return { folder, items, isCut: count > pages * PAGE_SIZE };
    }

    /**
     * Answers the background script with the list.
     *
     * @param {string} id id of the data extension
     * @param {(answer: object) => void} sendResponse answers the background script
     */
    async function answer(id, sendResponse) {
        sendResponse(await list(id));
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (
            message?.type !== LIST_MESSAGE ||
            sender.id !== chrome.runtime.id ||
            sender.tab !== undefined ||
            typeof message.id !== 'string' ||
            !DE_ID.test(message.id)
        ) {
            return false;
        }
        answer(message.id, sendResponse);
        return true;
    });
})();
