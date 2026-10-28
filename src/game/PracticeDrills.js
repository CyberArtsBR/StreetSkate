import { GRIND_TRICKS, DOUBLE_GRIND_TRICKS } from './TrickCatalog.js';

const grindNames = new Set([...Object.values(GRIND_TRICKS), ...Object.values(DOUBLE_GRIND_TRICKS)].map(trick => trick.name));
const lessons = [
  { title:'Land an ollie', matches: entries => entries.some(entry => entry.name === 'Ollie') },
  { title:'Land a kickflip', matches: entries => entries.some(entry => entry.name === 'Kickflip') },
  { title:'Land a grind', matches: entries => entries.some(entry => grindNames.has(entry.name)) },
  { title:'Land a three-trick combo', matches: entries => entries.length >= 3 },
];

/** A practice drill advances only on an accepted score bank, never on trick input. */
export class PracticeDrills {
  constructor() { this.enabled = false; this.index = 0; }
  reset() { this.index = 0; }
  toggle() { this.enabled = !this.enabled; if (this.enabled) this.reset(); return this.enabled; }
  get label() {
    if (!this.enabled) return '';
    return this.index >= lessons.length ? 'All drills complete!' : `${this.index + 1} / ${lessons.length} · ${lessons[this.index].title}`;
  }
  accept(entries) {
    if (!this.enabled || this.index >= lessons.length || !Array.isArray(entries)) return false;
    if (!lessons[this.index].matches(entries)) return false;
    this.index++;
    return true;
  }
}
