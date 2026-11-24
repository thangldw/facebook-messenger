'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { classify, isFacebookUrl, isCallUrl, downloadTarget } = require('../src/routes');

const cases = {
  allowed: [
    'https://www.facebook.com/messages/',
    'https://www.facebook.com/messages/t/123456',
    'https://www.facebook.com/messages/e2ee/t/789',
    'https://www.facebook.com/t/123',
    'https://www.facebook.com/login/?next=x',
    'https://www.facebook.com/login.php?next=https%3A%2F%2Fwww.facebook.com%2Fmessages%2F',
    'https://www.facebook.com/login/device-based/regular/login/',
    'https://www.facebook.com/checkpoint/1501092823525282/',
    'https://www.facebook.com/messenger_media/?attachment_id=1&message_id=mid.x&thread_id=2',
    'https://www.facebook.com/photo/?fbid=123&set=a.1',
    'https://www.facebook.com/photo.php?fbid=123',
    'https://www.messenger.com/',
    'about:blank',
  ],
  feed: [
    'https://www.facebook.com/',
    'https://www.facebook.com/?sk=h_chr',
    'https://www.facebook.com/home.php',
    'https://www.facebook.com/watch/?v=1',
    'https://www.facebook.com/reel/123',
    'https://www.facebook.com/marketplace/',
  ],
  external: [
    'https://www.facebook.com/some.user',
    'https://www.facebook.com/messagesfoo',
    'https://www.facebook.com/tags',
    'https://www.facebook.com/r.php',
    'https://l.facebook.com/l.php?u=https://example.com',
    'https://example.com/',
    'http://www.facebook.com/messages/',
    'not a url',
    // Content that could impersonate a login page in a window without an address bar.
    'data:text/html,<form>password</form>',
    'blob:https://www.facebook.com/0b1c',
    'file:///etc/passwd',
    'about:srcdoc',
    'https://www.facebook.com.evil.example/messages/',
    'https://evilfacebook.com/messages/',
  ],
};

const facebookOrigins = {
  true: [
    'https://www.facebook.com', 'https://www.facebook.com/messages/t/1',
    'https://facebook.com', 'https://accountscenter.facebook.com/x',
    'https://www.messenger.com/', 'https://messenger.com',
  ],
  false: [
    'http://www.facebook.com', 'https://facebook.com.evil.example', 'https://evilfacebook.com',
    'https://fbcdn.net.evil.example', 'https://example.com', 'data:text/html,x',
    'about:blank', '', undefined, 'not a url',
  ],
};

for (const [want, urls] of Object.entries(facebookOrigins)) {
  for (const url of urls) {
    test(`isFacebookUrl(${JSON.stringify(url)}) === ${want}`, () => assert.strictEqual(isFacebookUrl(url), want === 'true'));
  }
}

for (const [want, urls] of Object.entries(cases)) {
  for (const url of urls) {
    test(`${want}: ${url}`, () => assert.strictEqual(classify(url), want));
  }
}

const downloads = [
  ['https://cdn.fbsbx.com/v/t59.2708-21/file.pdf?_nc_cat=1&oh=x', 'https://cdn.fbsbx.com/v/t59.2708-21/file.pdf?_nc_cat=1&oh=x'],
  ['blob:https://www.facebook.com/7b5c0a1e-1111-2222-3333-444455556666', 'blob:https://www.facebook.com/7b5c0a1e-1111-2222-3333-444455556666'],
  ['https://l.facebook.com/l.php?u=https%3A%2F%2Fcdn.fbsbx.com%2Fv%2Fdoc.docx&h=AT0', 'https://cdn.fbsbx.com/v/doc.docx'],
  // Not Facebook files: never downloaded with the app session.
  ['blob:https://evil.example/123', null],
  ['https://fbsbx.com.evil.example/x.pdf', null],
  ['http://cdn.fbsbx.com/x.pdf', null],
  ['https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fx.pdf', null],
  ['https://www.facebook.com/messages/', null],
  ['data:text/html,x', null],
  [undefined, null],
];
for (const [url, want] of downloads) {
  test(`downloadTarget(${JSON.stringify(url)})`, () => assert.strictEqual(downloadTarget(url), want));
}

const calls = [
  ['https://www.facebook.com/groupcall/ROOM:123/?call_id=1', true],
  ['https://www.facebook.com/videocall/incall/?peer_id=1', true],
  ['https://www.facebook.com/messenger_call/', true],
  ['https://www.facebook.com/rtc/x', true],
  // Chats, other Facebook pages and look-alikes are not call pages.
  ['https://www.facebook.com/messages/t/123', false],
  ['https://www.facebook.com/groupcalls', false],
  ['https://apps.facebook.com/groupcall/', false],
  ['http://www.facebook.com/groupcall/', false],
  ['https://www.facebook.com.evil.example/groupcall/', false],
  ['about:blank', false],
];
for (const [url, want] of calls) {
  test(`isCallUrl(${url})`, () => assert.strictEqual(isCallUrl(url), want));
}
