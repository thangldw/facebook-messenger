'use strict';

const { BrowserWindow, desktopCapturer, dialog } = require('electron');
const { isFacebookUrl } = require('./routes');

const MAX_SOURCES = 12;

function label(source) {
  const name = source.name.length > 48 ? `${source.name.slice(0, 45)}...` : source.name;
  return source.id.startsWith('screen:') ? `Screen: ${name}` : `Window: ${name}`;
}

// Fallback picker for getDisplayMedia() where the OS has no native picker
// (Windows, Linux, macOS < 15). Screens are listed before windows.
async function handleDisplayMediaRequest(request, callback) {
  // Only Facebook's own frames may ask to capture the screen.
  if (!isFacebookUrl(request.securityOrigin)) return callback(null);
  try {
    const sources = (await desktopCapturer.getSources({ types: ['screen', 'window'] }))
      .filter((s) => s.name)
      .slice(0, MAX_SOURCES);
    if (sources.length === 0) return callback(null);

    const options = {
      type: 'question',
      title: 'Share your screen',
      message: 'Choose what to share',
      buttons: [...sources.map(label), 'Cancel'],
      cancelId: sources.length,
      noLink: false,
    };
    const parent = BrowserWindow.getFocusedWindow();
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (response >= sources.length) return callback(null);

    const stream = { video: sources[response] };
    // System audio loopback is only supported on Windows.
    if (process.platform === 'win32') stream.audio = 'loopback';
    return callback(stream);
  } catch {
    return callback(null);
  }
}

module.exports = { handleDisplayMediaRequest };
