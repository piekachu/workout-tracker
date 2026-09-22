// Small hand-drawn category icons shared across the workout pages (the log
// form doesn't need them, but the calendar/database view and the home
// page's per-app summaries do). Plain SVG strings, sized via `size`, colored
// via currentColor so they pick up whatever text color they're placed in.
// Matching is keyword-based (not exact-string) so it works for both the 5
// current fixed categories AND older/merged free-form labels like
// "Back + Chest + Arms + Shoulders" -- it just needs to find "back" in there.

const CATEGORY_ICON_PATHS = {
  back: `<path d="M4 3 L10 15 L16 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  chest: `<rect x="1.5" y="8" width="3" height="4" rx="0.5" fill="currentColor"/><rect x="15.5" y="8" width="3" height="4" rx="0.5" fill="currentColor"/><line x1="4.5" y1="10" x2="15.5" y2="10" stroke="currentColor" stroke-width="2"/>`,
  shoulder: `<path d="M4 12 a6 6 0 0 1 12 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="12" r="1.3" fill="currentColor"/>`,
  legs: `<path d="M7 2 L5 18 M13 2 L15 18 M6.4 10 L13.6 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  whole: `<circle cx="10" cy="4.5" r="2" fill="currentColor"/><line x1="10" y1="6.5" x2="10" y2="13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="10" y1="8.5" x2="5.5" y2="11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="10" y1="8.5" x2="14.5" y2="11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="10" y1="13" x2="6" y2="18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="10" y1="13" x2="14" y2="18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  generic: `<circle cx="4" cy="10" r="2.4" fill="currentColor"/><circle cx="16" cy="10" r="2.4" fill="currentColor"/><line x1="6.4" y1="10" x2="13.6" y2="10" stroke="currentColor" stroke-width="2"/>`,
};

// Rules checked in order against the lowercased category string -- "back"
// and "chest" are checked before "arms"/"shoulder" so e.g. "Back + Biceps"
// matches back (biceps rides along with back day) rather than falling
// through to generic.
const CATEGORY_ICON_RULES = [
  ["back", "back"],
  ["chest", "chest"],
  ["shoulder", "shoulder"],
  ["arm", "shoulder"],
  ["leg", "legs"],
  ["whole", "whole"],
];

function categoryIconKeys(category) {
  const c = (category || "").toLowerCase();
  const found = new Set();
  for (const [needle, key] of CATEGORY_ICON_RULES) {
    if (c.includes(needle)) found.add(key);
  }
  return found.size ? [...found] : ["generic"];
}

function categoryIconSvg(key, size = 16) {
  const path = CATEGORY_ICON_PATHS[key] || CATEGORY_ICON_PATHS.generic;
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true">${path}</svg>`;
}

// Renders one icon per distinct body part found in `category` (e.g. a
// merged "Back + Chest + Arms + Shoulders" label gets 3 icons: back, chest,
// shoulder), wrapped for inline flex layout.
function categoryIconsHtml(category, size = 16) {
  const keys = categoryIconKeys(category);
  return `<span class="cat-icons">${keys.map((k) => categoryIconSvg(k, size)).join("")}</span>`;
}
