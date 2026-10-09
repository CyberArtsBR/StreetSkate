/** UI-only countdown state, with no gameplay clock changes. */
export function sessionWarning(remaining, practice = false) {
  if (practice || !Number.isFinite(remaining) || remaining > 10) return 'none';
  return remaining <= 5 ? 'critical' : 'warning';
}
