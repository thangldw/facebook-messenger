'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { classify, isFacebookUrl } = require('../src/routes');

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
