/*
 * SFMC UX Tools — demo page of the SQL query activity: an Ace editor in SQL mode in a dialog like
 * Automation Studio's, which the built scripts of the extension that load after this one take for
 * that dialog's editor. The query and the answer of Marketing Cloud's check are made up for the
 * pictures of the README; the check is answered here, so that nothing leaves the page.
 */
(() => {
    'use strict';

    // where the dialog's button "Validate Syntax" asks, and the extension too
    const VALIDATE = '/AutomationStudioFuel3/fuelapi/automation/v1/queries/actions/validate/';
    // a field the made-up data extension does not have
    const UNKNOWN = 'FavouriteColour';
    const QUERY = `SELECT SubscriberKey, ${UNKNOWN}
FROM Newsletter_Subscribers
WHERE Status = 'Active'`;

    /**
     * Answers a query the way Marketing Cloud's check does: an error for each unknown field.
     *
     * @param {string} text the query
     * @returns {object} the answer
     */
    function answerFor(text) {
        return text.includes(UNKNOWN)
            ? {
                  queryValid: false,
                  errors: [
                      {
                          message: `An error occurred while checking the query syntax. Errors: Invalid column name '${UNKNOWN}'.\r\n`,
                      },
                  ],
                  warnings: [],
              }
            : { queryValid: true, errors: [], warnings: [] };
    }

    const pageFetch = fetch;
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- stands in for Marketing Cloud's check, which the built scripts ask with fetch
    globalThis.fetch = async (address, options = {}) => {
        if (String(address) !== VALIDATE) {
            return pageFetch(address, options);
        }
        const { text } = JSON.parse(options.body);
        return Response.json(answerFor(text));
    };

    const editor = globalThis.ace.edit(document.querySelector('#queryEditor'), {
        mode: 'ace/mode/sql',
        useWorker: false,
        fontSize: 14,
        showPrintMargin: false,
    });
    editor.setValue(QUERY, -1);
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- where the capture script finds the editor
    globalThis.demoEditor = editor;
})();
