import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicPlayer, TRACKS } from '../src/game/MusicPlayer.js';
import { SkateAudio } from '../src/game/SkateAudio.js';

function fakeMusicEnvironment() {
  const oldAudio = globalThis.Audio;
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldStorage = globalThis.localStorage;
  const events = new Map();
  class FakeAudio {
    constructor() {
      this.src = ''; this.volume = 1; this.paused = true; this.ended = false;
      this.listeners = new Map();
    }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    removeEventListener(name) { this.listeners.delete(name); }
    pause() { this.paused = true; }
    play() { this.paused = false; return Promise.resolve(); }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() {}
    trigger(name) { this.listeners.get(name)?.(); }
  }
  globalThis.Audio = FakeAudio;
  globalThis.window = { addEventListener(name, fn) { events.set('win:' + name, fn); },
    removeEventListener(name) { events.delete('win:' + name); } };
  globalThis.document = { hidden: false,
    addEventListener(name, fn) { events.set('doc:' + name, fn); },
    removeEventListener(name) { events.delete('doc:' + name); } };
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value) };
  return { storage, FakeAudio, restore() {
    globalThis.Audio = oldAudio; globalThis.window = oldWindow;
    globalThis.document = oldDocument; globalThis.localStorage = oldStorage;
  } };
}

test('music shuffle never repeats adjacent tracks and honors volume persistence', async () => {
  const env = fakeMusicEnvironment();
  try {
    const m = new MusicPlayer();
    const sequence = [m.current];
    for (let i = 0; i < TRACKS.length * 3; i++) {
      m.next();
      sequence.push(m.current);
    }
    for (let i = 1; i < sequence.length; i++)
      assert.notEqual(sequence[i], sequence[i - 1], 'adjacent song repeat');
    m.setMasterVolume(0.3);
    assert.equal(env.storage.get('streetskate.masterVolume'), '0.3');
    assert.equal(m.audio.volume, 0.55 * 0.3);
    m.dispose();
    assert.equal(m.disposed, true);
    assert.equal(m.audio.listeners.size, 0);
    await Promise.resolve();
  } finally { env.restore(); }
});

test('rapid skip ignores a rejected stale play promise and successfully plays the new track', async () => {
  const env = fakeMusicEnvironment();
  try {
    const pending = [];
    env.FakeAudio.prototype.play = function() {
      this.paused = false;
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    };
    const notes = [];
    const m = new MusicPlayer((title, note) => notes.push({ title, note }));
    assert.equal(pending.length, 1);
    m.next();
    assert.equal(pending.length, 2);
    const expected = m.title;
    pending[0].reject(Object.assign(new Error('interrupted'), { name: 'AbortError' }));
    await Promise.resolve();
    assert.equal(m.title, expected);
    pending[1].resolve();
    await Promise.resolve();
    assert.equal(m.unlocked, true);
    assert.equal(notes.at(-1).note, '');
    m.dispose();
  } finally { env.restore(); }
});

test('missing music track skips to the next available track without endless retry', async () => {
  const env = fakeMusicEnvironment();
  try {
    const m = new MusicPlayer();
    const failed = m.current;
    m.audio.trigger('error');
    assert.equal(m.failed.has(failed), true);
    assert.notEqual(m.current, failed);
    m.dispose();
  } finally { env.restore(); }
});

test('skate SFX honors stored toggle and survives repeated pause/silence calls', async () => {
  const env = fakeMusicEnvironment();
  try {
    const fx = new SkateAudio();
    assert.equal(fx.enabled, true);
    assert.equal(fx.toggle(), false);
    assert.equal(env.storage.get('streetskate.sound'), 'off');
    assert.equal(fx.toggle(), true);
    fx.silence(); fx.silence();
    fx.setMasterVolume(0.2);
    assert.equal(fx.masterVolume, 0.2);
    await fx.dispose();
    assert.equal(fx.disposed, true);
    assert.equal(fx.toggle(), false);
  } finally { env.restore(); }
});

test('SFX impact cooldown prevents multiple effects in one physics tick', () => {
  const fx = new SkateAudio();
  let impacts = 0;
  const node = () => ({ connect() {}, disconnect() {}, type: '',
    frequency: { value: 0 }, gain: {
      setValueAtTime() {}, exponentialRampToValueAtTime() {},
    } });
  fx.context = {
    state: 'running', currentTime: 1,
    createBufferSource() {
      impacts++;
      return { ...node(), start() {}, stop() {}, onended: null };
    },
    createBiquadFilter: node, createGain: node,
  };
  fx.master = node(); fx.buffer = {};
  fx.impact(0.4); fx.impact(0.4);
  assert.equal(impacts, 1);
  fx.context.currentTime = 1.1;
  fx.impact(0.4);
  assert.equal(impacts, 2);
});
