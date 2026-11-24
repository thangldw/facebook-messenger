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
  // Photo/video viewer opened from a chat (lightbox route).
  '/messenger_media', '/photo',
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

// Files sent in chats live on Facebook's attachment CDN (fbsbx.com), and the
// "Download" button produces blob: URLs. Both need the app's session, so they
// are downloaded in-app. They are never rendered in an app window: fbsbx.com
// serves files uploaded by other people, which could be a fake login page.
// Returns the URL to download, or null.
function downloadTarget(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  if (rawUrl.startsWith('blob:')) return isFacebookUrl(rawUrl.slice(5)) ? rawUrl : null;
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const h = url.hostname;
  if (h === 'fbsbx.com' || h.endsWith('.fbsbx.com')) return url.href;
  // Link shim: l.facebook.com/l.php?u=<target>
  if ((h === 'l.facebook.com' || h === 'lm.facebook.com') && url.pathname === '/l.php') {
    const inner = url.searchParams.get('u');
    if (inner && inner !== rawUrl) return downloadTarget(inner);
  }
  return null;
}

// ---------------------------------------------------------------- Zalo

// Zalo Web is a single page at chat.zalo.me; sign-in (QR or phone) is on id.zalo.me.
const ZALO_HOME_URL = 'https://chat.zalo.me/';
const ZALO_APP_HOSTS = new Set(['chat.zalo.me', 'id.zalo.me']);

// Hosts Zalo serves chat files and media from (taken from chat.zalo.me's
// Content-Security-Policy). Like fbsbx.com they hold files other people
// uploaded, so they are downloaded, never rendered in an app window.
const ZALO_FILE_DOMAINS = [
  'zdn.vn', 'zadn.vn', 'z-cdn.me',
  'dlfl.me', 'dlfl.vn', 'dlfl.info', 'dlmd.me',
  'cscvdlz.com', 'cscfdl.com', 'cscvdl.com', 'cscpdl.com',
  'social-dl.com', 'social-dl-z.com', 'mdchat.me', 'pchat.vn', 'flchat.vn',
];

const onDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

function classifyZalo(rawUrl) {
  if (rawUrl === 'about:blank') return 'allowed';
  let url;
  try { url = new URL(rawUrl); } catch { return 'external'; }
  if (url.protocol === 'https:' && ZALO_APP_HOSTS.has(url.hostname)) return 'allowed';
  return 'external'; // zalo.me/g/... invites, profiles, links people send
}

// True for https origins operated by Zalo (zalo.me and its subdomains).
function isZaloUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return false; }
  return url.protocol === 'https:' && onDomain(url.hostname, 'zalo.me');
}

function zaloDownloadTarget(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  if (rawUrl.startsWith('blob:')) return isZaloUrl(rawUrl.slice(5)) ? rawUrl : null;
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  return ZALO_FILE_DOMAINS.some((d) => onDomain(url.hostname, d)) ? url.href : null;
}

module.exports = {
  classify, isFacebookUrl, downloadTarget, HOME_URL,
  classifyZalo, isZaloUrl, zaloDownloadTarget, ZALO_HOME_URL, ZALO_FILE_DOMAINS,
};
