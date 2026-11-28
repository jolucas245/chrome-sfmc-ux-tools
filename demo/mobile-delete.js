/*
 * SFMC UX Tools — demo page of MobileConnect's list of messages: moves the address of the page to
 * MobileConnect's path, where the built script works, and answers the requests the script makes to
 * Marketing Cloud's API with made-up messages. No request leaves the page, and nothing is deleted;
 * everything below is invented for the pictures of the README and only follows the shape of the
 * API's answers.
 */
(() => {
    'use strict';

    // the script works only below the path of MobileConnect; the page is not loaded again
    history.replaceState(null, '', `/MobileConnectFuel3/${location.search}`);

    const API = '/MobileConnectFuel3/fuelapi/';
    const MESSAGE = 'legacy/v1/beta/mobile/message/';
    const DEFINITIONS = 'messaging/v1/sms/definitions';
    // the id of the made-up transactional SMS message, and the one a message without any holds
    const OWNER = 'd3m0d3m0-0000-4000-8000-000000000001';
    const NONE = '00000000-0000-0000-0000-000000000000';

    /**
     * Builds an SMS message as the API hands it out.
     *
     * @param {string} id its id
     * @param {string} name its name
     * @param {string} status Draft, Inactive or Active
     * @param {object} [more] what differs from a message made in MobileConnect
     * @returns {object} the message
     */
    const message = (id, name, status, more) => ({
        id,
        name,
        status,
        sendMethod: 'USER',
        smsTriggeredSendDefinitionId: NONE,
        ...more,
    });
    const MESSAGES = Object.fromEntries(
        [
            message('101', 'Welcome_SMS_Demo', 'Draft'),
            message('102', 'Spring_Sale_Teaser', 'Draft'),
            message('103', 'Old_Coupon_Reminder', 'Inactive'),
            // sent by the transactional SMS message of the same name
            message('104', 'Order_Confirmation_Demo', 'Active', {
                sendMethod: 'API',
                smsTriggeredSendDefinitionId: OWNER,
            }),
            // made by a journey
            message('105', 'Journey_Welcome_Demo', 'Active', { sendMethod: 'INTERACTION' }),
            message('106', 'Appointment_Reminder', 'Active'),
        ].map((item) => [item.id, item]),
    );
    const DEFINITION = {
        name: 'Order_Confirmation_Demo',
        definitionKey: 'order_confirmation_demo',
        status: 'Active',
    };

    /**
     * Answers a request to the API.
     *
     * @param {string} path address below the API, with its query
     * @param {string} method GET or DELETE
     * @returns {{status: number, body: unknown}} the answer
     */
    function answer(path, method) {
        if (path.startsWith(MESSAGE)) {
            const id = decodeURIComponent(path.slice(MESSAGE.length));
            if (!Object.hasOwn(MESSAGES, id)) {
                return { status: 404, body: { message: 'Not part of the demo' } };
            }
            // the demo deletes nothing
            return { status: 200, body: method === 'GET' ? MESSAGES[id] : {} };
        }
        if (path.startsWith(`${DEFINITIONS}?`)) {
            const parameters = new URLSearchParams(path.slice(DEFINITIONS.length + 1));
            const rows = parameters.get('$page') === '1' ? [DEFINITION] : [];
            return {
                status: 200,
                body: {
                    definitions: rows,
                    count: rows.length,
                    pageSize: Number(parameters.get('$pageSize')),
                },
            };
        }
        return path === `${DEFINITIONS}/${DEFINITION.definitionKey}`
            ? { status: 200, body: { ...DEFINITION, definitionId: OWNER } }
            : { status: 404, body: { message: 'Not part of the demo' } };
    }

    // the page's own requests go on as they are; those to the API never leave the page
    const passOn = fetch;
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the script asks the page's fetch
    globalThis.fetch = async (url, options = {}) => {
        const address = String(url);
        if (!address.startsWith(API)) {
            return passOn(url, options);
        }
        const { status, body } = answer(address.slice(API.length), options.method ?? 'GET');
        return Response.json(body, {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
    };
})();
