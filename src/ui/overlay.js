'use strict';

// Renders the overlay for the current mode and forwards user actions to the
// app through the preload API (window.overlay).

const $ = (id) => document.getElementById(id);
let current = null;

function render(state) {
  const mode = state && state.mode;
  for (const section of document.querySelectorAll('section[data-mode]')) {
    section.hidden = section.dataset.mode !== mode;
  }
  if (mode !== current) {
    // Entering a mode: clear inputs and messages, focus the first field.
    for (const input of document.querySelectorAll('input')) input.value = '';
    $('unlock-error').textContent = '';
    $('setup-error').textContent = '';
    current = mode;
    const first = document.querySelector(`section[data-mode="${mode}"] input, section[data-mode="${mode}"] button`);
    if (first) first.focus();
  }
  if (mode === 'lock') $('touchid').hidden = !state.touchId;
  if (mode === 'offline') $('offline-status').textContent = state.status || 'Retrying…';
}

async function busy(button, fn) {
  button.disabled = true;
  try { return await fn(); } finally { button.disabled = false; }
}

$('unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('unlock-password');
  const result = await busy(e.submitter || e.target.querySelector('button'), () => window.overlay.unlock(input.value));
  if (result && !result.ok) {
    $('unlock-error').textContent = result.error || 'Wrong password.';
    input.select();
  }
});

$('touchid').addEventListener('click', (e) => busy(e.currentTarget, () => window.overlay.touchId()));
$('forgot').addEventListener('click', () => window.overlay.reset());

$('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('setup-password').value;
  if (pw !== $('setup-confirm').value) {
    $('setup-error').textContent = "Passwords don't match.";
    return;
  }
  const result = await busy(e.submitter || e.target.querySelector('button[type=submit]'), () => window.overlay.setPassword(pw));
  if (result && !result.ok) $('setup-error').textContent = result.error || 'Could not set the password.';
});
$('setup-cancel').addEventListener('click', () => window.overlay.cancel());

$('offline-retry').addEventListener('click', (e) => busy(e.currentTarget, () => window.overlay.retry()));
$('crashed-retry').addEventListener('click', (e) => busy(e.currentTarget, () => window.overlay.retry()));

window.overlay.onState(render);
window.overlay.getState().then(render);
