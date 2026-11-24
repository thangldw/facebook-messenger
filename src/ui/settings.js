'use strict';

// Settings window: accounts and focus schedule. Talks to the app only through
// window.settingsApi (see settings-preload.js).

const $ = (id) => document.getElementById(id);
const api = window.settingsApi;
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
let state = null;
let rules = [];
let dirty = false;

if (!/Mac/.test(navigator.platform)) $('switch-key').textContent = 'Ctrl+1';

// ---- accounts

function renderAccounts() {
  const list = $('account-list');
  const editing = document.activeElement && document.activeElement.classList.contains('name') ? document.activeElement.dataset.id : null;
  list.replaceChildren();
  for (const acc of state.accounts) {
    const row = $('account-row').content.firstElementChild.cloneNode(true);
    row.classList.toggle('active', acc.active);
    const input = row.querySelector('.name');
    input.value = acc.name;
    input.dataset.id = acc.id;
    row.querySelector('.service').textContent = acc.serviceLabel;
    const badge = row.querySelector('.badge');
    badge.hidden = !acc.unread;
    // Zalo only reports that there are new messages, not how many.
    badge.textContent = acc.unread ? (acc.countsUnread ? acc.unread : 'New') : '';
    const save = async () => {
      const result = await api.renameAccount(acc.id, input.value);
      $('accounts-error').textContent = result && !result.ok ? result.error : '';
    };
    row.querySelector('.rename').addEventListener('click', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    const remove = row.querySelector('.remove');
    remove.disabled = state.accounts.length === 1;
    remove.addEventListener('click', async () => {
      const result = await api.removeAccount(acc.id);
      $('accounts-error').textContent = result && !result.ok && result.error ? result.error : '';
    });
    list.appendChild(row);
    if (editing === acc.id) input.focus();
  }
  const full = state.accounts.length >= state.maxAccounts;
  const buttons = $('add-buttons');
  if (buttons.childElementCount !== state.services.length) {
    buttons.replaceChildren();
    for (const svc of state.services) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary';
      b.dataset.service = svc.id;
      b.textContent = `Add ${svc.label} account`;
      b.addEventListener('click', async () => {
        const result = await api.addAccount(svc.id);
        $('accounts-error').textContent = result && !result.ok ? result.error : '';
      });
      buttons.appendChild(b);
    }
  }
  for (const b of buttons.children) b.disabled = full;
}

// ---- focus schedule

function renderRules() {
  const list = $('rule-list');
  list.replaceChildren();
  rules.forEach((rule, index) => {
    const row = $('rule-row').content.firstElementChild.cloneNode(true);
    const days = row.querySelector('.days');
    for (const [d, label] of DAYS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'day';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(rule.days.includes(d)));
      b.addEventListener('click', () => {
        rule.days = rule.days.includes(d) ? rule.days.filter((x) => x !== d) : [...rule.days, d];
        markDirty();
        renderRules();
      });
      days.appendChild(b);
    }
    const start = row.querySelector('.start');
    const end = row.querySelector('.end');
    start.value = rule.start;
    end.value = rule.end;
    start.addEventListener('change', () => { rule.start = start.value; markDirty(); });
    end.addEventListener('change', () => { rule.end = end.value; markDirty(); });
    row.querySelector('.remove-rule').addEventListener('click', () => { rules.splice(index, 1); markDirty(); renderRules(); });
    list.appendChild(row);
  });
  $('add-rule').disabled = rules.length >= state.maxRules;
}

function markDirty() {
  dirty = true;
  $('focus-status').textContent = 'Unsaved changes';
}

$('add-rule').addEventListener('click', () => {
  rules.push({ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' });
  markDirty();
  renderRules();
});
$('focus-enabled').addEventListener('change', markDirty);

$('save-focus').addEventListener('click', async () => {
  for (const r of rules) {
    if (r.days.length === 0) { $('focus-status').textContent = 'Pick at least one day for each time range.'; return; }
    if (!r.start || !r.end || r.start === r.end) { $('focus-status').textContent = 'Each time range needs a different start and end time.'; return; }
  }
  const result = await api.setFocus($('focus-enabled').checked, rules);
  if (result && result.ok) {
    dirty = false;
    $('focus-status').textContent = 'Saved.';
  } else {
    $('focus-status').textContent = (result && result.error) || 'Could not save the schedule.';
  }
});

// ---- state

function render(next) {
  state = next;
  renderAccounts();
  if (!dirty) {
    rules = JSON.parse(JSON.stringify(state.focus.rules));
    $('focus-enabled').checked = state.focus.enabled;
    renderRules();
  }
  $('focus-status').textContent = dirty ? 'Unsaved changes' : (state.focus.status || '');
}

api.onState(render);
api.onSection((section) => {
  const el = section && document.getElementById(section);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
api.getState().then(render);
