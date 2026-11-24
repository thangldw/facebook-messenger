'use strict';

// App-lock password handling. Only a salted scrypt hash is stored; the
// password itself is never written anywhere.

const crypto = require('crypto');

// Applies to new passwords only; an existing shorter one still unlocks.
const MIN_LENGTH = 6;
const MAX_LENGTH = 256;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function isAcceptable(password) {
  return typeof password === 'string' && password.length >= MIN_LENGTH && password.length <= MAX_LENGTH;
}

function hashPassword(password) {
  if (!isAcceptable(password)) throw new Error('Password does not meet requirements');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function verifyPassword(password, saltHex, hashHex) {
  if (typeof password !== 'string' || password.length > MAX_LENGTH || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

const MAX_WAIT_MS = 300000;

// Slows down guessing: after 5 failures, each further attempt waits longer
// (30 s, 60 s, ... capped at 5 min). With a store ({ load(), save(state) }) the
// count survives a restart, so quitting and relaunching does not reset it.
class Throttle {
  constructor(now = () => Date.now(), store = null) {
    this.now = now;
    this.store = store;
    const saved = store ? store.load() : null;
    this.failures = saved ? saved.failures : 0;
    this.blockedUntil = saved ? saved.blockedUntil : 0;
  }

  waitMs() {
    // Capped, so a saved time is never longer than one wait (e.g. after the clock went back).
    return Math.min(Math.max(0, this.blockedUntil - this.now()), MAX_WAIT_MS);
  }

  fail() {
    this.failures += 1;
    if (this.failures >= 5) {
      this.blockedUntil = this.now() + Math.min(30000 * (this.failures - 4), MAX_WAIT_MS);
    }
    this.persist();
  }

  succeed() {
    if (this.failures === 0 && this.blockedUntil === 0) return;
    this.failures = 0;
    this.blockedUntil = 0;
    this.persist();
  }

  persist() {
    if (this.store) this.store.save({ failures: this.failures, blockedUntil: this.blockedUntil });
  }
}

module.exports = { hashPassword, verifyPassword, isAcceptable, Throttle, MIN_LENGTH };
