/**
 * A project name as it should print: the first letter of each significant word capitalized.
 * Only words typed entirely in lower case are changed, so names that already carry deliberate capitals ("LLC", "NNN", "McAllister",
 * "Burger Pad #2") are left exactly as written. Short joining words stay lower case unless they open or close the name.
 */
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);

export function titleCase(name: string): string {
  const words = name.trim().split(/\s+/);
  return words
    .map((w, i) => {
      if (!w || w !== w.toLowerCase()) return w;                         // already has capitals: leave it
      if (SMALL.has(w) && i !== 0 && i !== words.length - 1) return w;   // small joining word in the middle
      // Capitalize the first letter, and the letter after a hyphen or slash ("mixed-use" -> "Mixed-Use")
      return w.replace(/(^|[-/(])([a-z])/g, (_, lead: string, c: string) => lead + c.toUpperCase());
    })
    .join(' ');
}
