'use strict';

// Route policy for the wrapper. Kept free of Electron imports so it can be unit-tested.
//   allowed  -> stay in the app
//   feed     -> bounce back to HOME_URL
//   external -> open in the system browser, then bounce back

const HOME_URL = 'https://www.facebook.com/messages/';

const FB_HOSTS = new Set([
  'facebook.com', 'www.facebook.com', 'web.facebook.com', 'm.facebook.com',
  'messenger.com', 'www.messenger.com',
]);

// Messaging, calls, and auth/recovery flows. Extend here if a login step gets bounced.
const ALLOWED_PREFIXES = [
  '/messages', '/t', '/groupcall', '/videocall', '/messenger_call', '/rtc',
  '/login', '/checkpoint', '/two_step_verification', '/two_factor', '/auth_platform',
  '/recover', '/confirmemail', '/privacy/consent', '/cookie', '/logout', '/security',
  '/encrypted_backups', '/secure_storage', '/e2ee',
];

const FEED_PATHS = new Set(['/', '/home.php', '/index.php']);
const FEED_PREFIXES = [
  '/watch', '/reel', '/reels', '/marketplace', '/gaming', '/stories', '/feeds',
  '/groups/feed', '/notifications', '/friends', '/memories', '/bookmarks',
];

function hasPrefix(pathname, prefix) {
  // Facebook mixes "/login/..." and legacy "/login.php" style endpoints.
  return pathname === prefix || pathname === `${prefix}.php` || pathname.startsWith(`${prefix}/`);
}

function classify(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return 'external'; }
  // about:blank is the only non-https page allowed (popups start there before
  // navigating). data:/blob:/file: could render arbitrary content in an app
  // window with no address bar, so they are never allowed.
  if (rawUrl === 'about:blank') return 'allowed';
  if (url.protocol !== 'https:' || !FB_HOSTS.has(url.hostname)) return 'external';
  if (url.hostname.endsWith('messenger.com')) return 'allowed'; // redirects to facebook.com/messages

  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (ALLOWED_PREFIXES.some((pre) => hasPrefix(p, pre))) return 'allowed';
  if (FEED_PATHS.has(p) || FEED_PREFIXES.some((pre) => hasPrefix(p, pre))) return 'feed';
  return 'external'; // profiles, pages, posts, photos...
}

// True for https origins operated by Facebook/Messenger. Used to gate
// permissions and server redirects, which must not reach third-party sites.
function isFacebookUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const h = url.hostname;
  return ['facebook.com', 'messenger.com'].some((d) => h === d || h.endsWith(`.${d}`));
}

module.exports = { classify, isFacebookUrl, HOME_URL };
