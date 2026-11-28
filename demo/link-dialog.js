/*
 * SFMC UX Tools — demo page of the dialog about a link to another business unit: puts the
 * Marketing Cloud page's address with a link to an asset of another business unit into the
 * address bar, and answers the script's questions about the business units with made-up ones, so
 * that the built script runs on a plain page. No request to the API leaves the page; everything
 * below is invented for the pictures of the README and only follows the shape of the API's
 * answers.
 */
(() => {
    'use strict';

    const ACCOUNTS = '/cloud/fuelapi/platform-internal/v1/accounts';
    const CURRENT = '100000001';
    const LINKED = '100000002';
    const ASSET = '123456';

    /**
     * Builds a business unit as the API describes it.
     *
     * @param {number} accountId its id
     * @param {string} name its name
     * @param {number|null} parentId id of the business unit above it; null for the enterprise
     * @returns {object} the business unit
     */
    const unit = (accountId, name, parentId) => ({
        accountId,
        name,
        accountType: parentId === null ? 'ENTERPRISE_2' : 'BUSINESS_UNIT',
        hasAccess: true,
        parentId,
    });
    const UNITS = [
        unit(100_000_000, 'Demo Account', null),
        unit(Number(CURRENT), 'Demo Brand US', 100_000_000),
        unit(Number(LINKED), 'Demo Brand EU', 100_000_000),
    ];

    // the Marketing Cloud page with a link to an asset of the other business unit; the script
    // acts on that page only. The page is never loaded again, which would lose this address
    history.replaceState(
        null,
        '',
        `/cloud/#app/Content%20Builder/ux-tools/${LINKED}/asset/${ASSET}`,
    );

    /**
     * Answers a question about the business units.
     *
     * @param {string} path what follows the address of the business units
     * @returns {{status: number, body: object}} the answer
     */
    function answer(path) {
        if (path.startsWith('?')) {
            return {
                status: 200,
                body: { count: UNITS.length, page: 1, pageSize: 50, items: UNITS },
            };
        }
        const mid = path === '/@current' ? CURRENT : path.slice(1);
        const found = UNITS.find((item) => String(item.accountId) === mid);
        return found
            ? { status: 200, body: found }
            : { status: 400, body: { message: 'Not part of the demo' } };
    }

    const passOn = fetch;
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the script asks the page's fetch
    globalThis.fetch = async (url, options = {}) => {
        const address = String(url);
        if (!address.startsWith(ACCOUNTS)) {
            return passOn(url, options);
        }
        const { status, body } = answer(address.slice(ACCOUNTS.length));
        return Response.json(body, { status });
    };
})();
