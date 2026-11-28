/*
 * SFMC UX Tools — demo page of the code editor: a CodeMirror 5 editor in the mode of Marketing
 * Cloud's own editors, which the built scripts of the extension that load after this one take for
 * one of Content Builder. All the code below is made up for the pictures of the README.
 *
 * `?sample=` picks the code to show (see SAMPLES); pointer.js draws a mouse pointer with
 * `?pointer=on`.
 */
(() => {
    'use strict';

    const SAMPLES = {
        // a bit of everything the colours cover
        colours: `<!-- Welcome_Email: made-up demo content -->
%%[
VAR @firstName, @points
SET @firstName = AttributeValue("FirstName")
IF Empty(@firstName) THEN
    SET @firstName = "Jane"
ENDIF
SET @points = Lookup("Newsletter_Subscribers", "Points", "EmailAddress", emailaddr)
]%%
<h1>Hello %%=ProperCase(@firstName)=%%</h1>
<p>You have %%=v(@points)=%% demo points, %%emailaddr%%.</p>
<script runat="server">
    Platform.Load("Core", "1.1.1");
    var subscribers = DataExtension.Init("Newsletter_Subscribers");
    Write(Stringify(subscribers.Rows.Lookup(["Status"], ["Active"])));
</script>`,
        // a misspelt function
        mistakes: `%%[
SET @firstName = AttributeValue("FirstName")
SET @greeting = Concat("Hello ", ProperCse(@firstName))
]%%
<h1>%%=v(@greeting)=%%</h1>`,
        // a comment that AMPscript does not know, which a quick fix turns into one it knows
        fix: `%%[
// greet the subscriber by name
SET @firstName = AttributeValue("FirstName")
]%%
<h1>Hello %%=v(@firstName)=%%</h1>`,
        // untidy code, for the formatting
        format: `%%[ set @firstName=AttributeValue("FirstName") if empty(@firstName) then
set @firstName="Jane" endif ]%%
<div class="greeting"><h1>Hello %%=v(@firstName)=%%</h1>
<p>Welcome to the demo newsletter.</p></div>`,
        // an email with a script for the browser, which Marketing Cloud removes when it saves
        lost: `%%[
SET @firstName = AttributeValue("FirstName")
]%%
<h1>Hello %%=v(@firstName)=%%</h1>
<script>
    document.querySelector("h1").classList.add("wave");
</script>`,
        // where the capture script types
        typing: `%%[
SET @firstName = AttributeValue("FirstName")

]%%
<h1>Hello %%=v(@firstName)=%%</h1>`,
    };
    const parameters = new URLSearchParams(location.search);
    const sample = Object.hasOwn(SAMPLES, parameters.get('sample'))
        ? parameters.get('sample')
        : 'colours';
    const value = SAMPLES[sample];
    // the stylesheet leaves room above the code where boxes are shown
    document.body.classList.add(`sample-${sample}`);
    if (sample === 'lost') {
        // Content Builder marks the element around its editor with what is edited: here an email
        document
            .querySelector('#stage')
            .classList.add(
                'cloud-editor',
                'editor-mode-htmlemail',
                'editor-mode-message',
                'editor-mode-asset',
            );
    }

    const editor = globalThis.CodeMirror(document.querySelector('#stage'), {
        value,
        mode: 'ampScriptHtmlMixed',
        lineNumbers: true,
        indentUnit: 4,
    });
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- where the capture script finds the editor
    globalThis.demoEditor = editor;
})();
