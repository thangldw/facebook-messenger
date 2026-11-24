'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../src/routes');

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
  ],
};

for (const [want, urls] of Object.entries(cases)) {
  for (const url of urls) {
    test(`${want}: ${url}`, () => assert.strictEqual(classify(url), want));
  }
}
