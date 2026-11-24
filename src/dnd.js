'use strict';

// Do Not Disturb: pause Facebook's notifications for a while.
// While paused, the app's permission check reports notifications as not
// allowed, so the page cannot show them. The unread count keeps updating.

const HOUR = 60 * 60 * 1000;

function nextMorning(now = new Date(), hour = 8) {
  const t = new Date(now);
  t.setHours(hour, 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t.getTime();
}

class Dnd {
  constructor({ settings, onChange, now = () => Date.now() }) {
    this.settings = settings;
    this.onChange = onChange;
    this.now = now;
    this.timer = null;
    this.arm();
  }

  isPaused() {
    const until = this.settings.get('dndUntil');
    return until === -1 || until > this.now();
  }

  until() {
    return this.settings.get('dndUntil');
  }

  pause(until) {
    this.settings.set('dndUntil', until);
    this.arm();
    this.onChange();
  }

  pauseFor(ms) { this.pause(this.now() + ms); }
  pauseUntilMorning() { this.pause(nextMorning(new Date(this.now()))); }
  pauseIndefinitely() { this.pause(-1); }
  resume() { this.pause(0); }

  // Fire onChange when a timed pause ends, so menus and the tray update.
  arm() {
    clearTimeout(this.timer);
    const until = this.settings.get('dndUntil');
    if (until > this.now()) {
      // setTimeout cannot exceed ~24.8 days; re-arm in steps.
      const delay = Math.min(until - this.now() + 500, 2 ** 31 - 1);
      this.timer = setTimeout(() => { this.arm(); if (!this.isPaused()) this.onChange(); }, delay);
    }
  }

  label() {
    const until = this.settings.get('dndUntil');
    if (until === -1) return 'Notifications paused';
    if (until > this.now()) {
      const t = new Date(until);
      return `Notifications paused until ${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return null;
  }
}

module.exports = { Dnd, nextMorning, HOUR };
