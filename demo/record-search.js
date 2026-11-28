/*
 * SFMC UX Tools — demo page of Contact Builder: the Records tab of a data extension with the bar
 * of its search and a few rows, which the built record search scripts that load after this one
 * take for those of Contact Builder. Everything shown is made up for the pictures of the README.
 *
 * This script runs first: it moves the address to the one of the Records tab, and puts a stand-in
 * for the server's requests in place before the built scripts wrap them. Once the page is read, it
 * draws the tab and asks for the fields of the data extension, as Contact Builder does.
 */
(() => {
    'use strict';

    const ID = '0a1b2c3d-0000-4000-8000-000000000001';
    const NAME = 'Newsletter_Subscribers';
    const FIELDS = [
        { name: 'SubscriberKey', isPrimaryKey: true, type: 'Text' },
        { name: 'EmailAddress', isPrimaryKey: false, type: 'EmailAddress' },
        { name: 'FirstName', isPrimaryKey: false, type: 'Text' },
        { name: 'City', isPrimaryKey: false, type: 'Text' },
        { name: 'Points', isPrimaryKey: false, type: 'Number' },
        { name: 'SignupDate', isPrimaryKey: false, type: 'Date' },
    ];
    const ROWS = [
        ['DEMO-0001', 'jane.doe@example.com', 'Jane', 'Springfield', '120', '2026-01-15'],
        ['DEMO-0002', 'john.roe@example.com', 'John', 'Riverton', '45', '2026-02-03'],
        ['DEMO-0003', 'alex.demo@example.com', 'Alex', 'Lakeside', '310', '2026-03-21'],
        ['DEMO-0004', 'sam.sample@example.com', 'Sam', 'Hill Valley', '8', '2026-04-09'],
        ['DEMO-0005', 'kim.test@example.com', 'Kim', 'Springfield', '76', '2026-05-30'],
    ];
    const DONE = 4;
    const FOUND = 200;

    // the address of the Records tab in Contact Builder; the page itself stays where it is
    history.replaceState(null, '', `/contactsmeta/admin.html#admin/data-extension/${ID}/records`);

    /**
     * Tells what the server would answer to a request of the page.
     *
     * @param {string} url address of the request
     * @returns {object} the answer
     */
    function answerTo(url) {
        const { pathname } = new URL(url, location.href);
        return pathname.endsWith(`/customobjects/${ID}/fields`)
            ? { fields: FIELDS }
            : { count: 0, page: 1, pageSize: 25, items: [] };
    }

    /**
     * Stand-in for the browser's requests: each one is answered in the page, and nothing leaves it.
     */
    class DemoRequest extends EventTarget {
        static DONE = DONE;

        #url = '';

        #text = '';

        readyState = 0;

        status = 0;

        responseType = '';

        /**
         * The answer as text.
         *
         * @returns {string} the answer
         */
        get responseText() {
            return this.#text;
        }

        /**
         * The answer as the page asked for it.
         *
         * @returns {string | object} the answer
         */
        get response() {
            return this.responseType === 'json' ? JSON.parse(this.#text) : this.#text;
        }

        /**
         * Notes where the request goes.
         *
         * @param {string} method method of the request
         * @param {string | URL} url address of the request
         */
        open(method, url) {
            this.#url = String(url);
            this.readyState = 1;
        }

        /**
         * Answers the request a moment later, as the server would.
         */
        send() {
            setTimeout(() => {
                this.#text = JSON.stringify(answerTo(this.#url));
                this.status = FOUND;
                this.readyState = DONE;
                this.dispatchEvent(new Event('readystatechange'));
                this.dispatchEvent(new Event('load'));
                this.dispatchEvent(new Event('loadend'));
            }, 0);
        }
    }

    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the built scripts wrap and read the page's requests
    globalThis.XMLHttpRequest = DemoRequest;

    /**
     * Builds an element.
     *
     * @param {string} tag tag name
     * @param {string} [className] its classes
     * @param {string} [text] its text
     * @returns {HTMLElement} the element
     */
    function element(tag, className = '', text = '') {
        const made = document.createElement(tag);
        made.className = className;
        made.textContent = text;
        return made;
    }

    /**
     * Builds the bar above the grid as Contact Builder draws it for a data extension with a
     * primary key: a menu with that field only, the search box and its button.
     *
     * @returns {HTMLDivElement} the bar
     */
    function buildBar() {
        const bar = element('div', 'edit-de-grid-select');
        const dropdown = element('div', 'de-search-dropdown');
        const group = element('div', 'btn-group selectlist filter-by-type');
        const toggle = element('button', 'btn btn-default dropdown-toggle');
        toggle.type = 'button';
        toggle.dataset.toggle = 'dropdown';
        toggle.append(element('span', 'selected-label', 'SubscriberKey'), element('span', 'caret'));
        const menu = element('ul', 'dropdown-menu dropdown-search');
        menu.setAttribute('role', 'menu');
        const entry = element('li');
        entry.dataset.value = 'SubscriberKey';
        // no address: a click on it must not change the route of the page
        entry.append(element('a', '', 'SubscriberKey'));
        menu.append(entry);
        group.append(toggle, menu);
        dropdown.append(group);
        const search = element('div', 'repeater-search');
        const inputGroup = element('div', 'search input-group');
        const input = element('input', 'form-control');
        input.dataset.testid = 'records-search-input';
        input.placeholder = 'Search';
        const button = element('button', 'btn btn-default', 'Search');
        button.type = 'button';
        button.dataset.testid = 'records-search-button';
        inputGroup.append(input, button);
        search.append(inputGroup);
        bar.append(dropdown, search);
        // Bootstrap opens the menu in Contact Builder; here a click on its button does
        toggle.addEventListener('click', () => group.classList.toggle('open'));
        return bar;
    }

    /**
     * Builds the grid of records.
     *
     * @returns {HTMLTableElement} the grid
     */
    function buildGrid() {
        const table = element('table', 'demo-records-grid');
        const head = element('tr');
        for (const field of FIELDS) {
            head.append(element('th', '', field.name));
        }
        table.createTHead().append(head);
        const body = table.createTBody();
        for (const values of ROWS) {
            const row = element('tr');
            for (const value of values) {
                row.append(element('td', '', value));
            }
            body.append(row);
        }
        return table;
    }

    /**
     * Draws the Records tab of the data extension.
     */
    function draw() {
        const app = document.querySelector('#app');
        const header = element('header', 'demo-records-header');
        header.append(element('p', 'demo-records-kind', 'Data Extension'), element('h1', '', NAME));
        const tabs = element('nav', 'demo-records-tabs');
        for (const name of ['Properties', 'Records', 'Data Retention']) {
            tabs.append(element('span', name === 'Records' ? 'is-active' : '', name));
        }
        const repeater = element('div', 'repeater repeater-records');
        const count = element('p', 'demo-records-count', `${ROWS.length} records`);
        repeater.append(buildBar(), count, buildGrid());
        app.append(header, tabs, repeater);
        // Contact Builder asks for the fields of the data extension once its tab is drawn
        const request = new XMLHttpRequest();
        request.open('GET', `/contactsmeta/fuelapi/internal/v1/customobjects/${ID}/fields`, true);
        request.send();
    }

    document.addEventListener('DOMContentLoaded', draw);
})();
