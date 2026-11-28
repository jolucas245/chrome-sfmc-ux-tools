/*
 * SFMC UX Tools — demo page of the Content tab of a free form block: a stand-in for Content
 * Builder's text editor, a CKEditor 4. Like that one it edits the body of a frame and tells its
 * listeners when it has its content and when the text changed. All the text is made up.
 */
(() => {
    'use strict';

    // what was typed into the editor: a tag, written as text, which the editor stores as text
    const CONTENT = `<p>Hello %%=v(@firstName)=%%,</p>
<p>thank you for joining the Demo Newsletter. As a welcome, your code is <b>DEMO-10</b>.</p>
<p>&lt;script&gt;showCountdown()&lt;/script&gt;</p>
<p>See you soon, the Demo Shop team</p>`;

    const container = document.querySelector('#editor');
    const frame = document.createElement('iframe');
    frame.title = 'Text editor';
    container.append(frame);
    const body = frame.contentDocument.body;
    body.innerHTML = CONTENT;
    body.contentEditable = 'true';
    const style = frame.contentDocument.createElement('style');
    style.textContent = 'body { margin: 12px; font: 14px/1.5 Arial, sans-serif; color: #181818; }';
    frame.contentDocument.head.append(style);

    const listeners = {};
    const editor = {
        mode: 'wysiwyg',
        container: { $: container },
        editable: () => ({ $: body }),
        // CKEditor's way to register a listener: name, listener, scope, data, priority
        on: (name, listener) => {
            (listeners[name] ??= []).push(listener);
        },
    };
    body.addEventListener('input', () => {
        const told = listeners.change ?? [];
        for (const listener of told) {
            listener({ name: 'change' });
        }
    });
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- where the built scripts look for the page's text editors
    globalThis.CKEDITOR = { instances: { editor1: editor } };
})();
