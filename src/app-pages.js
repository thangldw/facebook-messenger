'use strict';

// Registry of the app's own local pages (lock/recovery overlay, settings
// window). The Facebook navigation guards skip these; they would otherwise
// treat the local file as a foreign page and close it. Only code that creates
// such a page can register it.

const pages = new WeakSet();

module.exports = {
  registerAppPage: (wc) => pages.add(wc),
  isAppPage: (wc) => pages.has(wc),
};
