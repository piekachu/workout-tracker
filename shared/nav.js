// The one top bar every page shares, so its position, size and order never
// differ between pages. Each page has, as the first thing in <body>:
//
//   <nav class="site-nav" id="site-nav" data-root="../" aria-label="Main"></nav>
//   <script src="../shared/nav.js"></script>
//
// data-root is the relative path from that page back to the site root.
(function () {
  const nav = document.getElementById("site-nav");
  if (!nav) return;
  const root = nav.dataset.root || "./";
  const ITEMS = [["", "Home"], ["tasks/", "Tasks"], ["progress/", "Progress"], ["workout/", "Workout"],
    ["vocab/", "Vocab"], ["expenses/", "Expenses"], ["drugs/", "Drugs"], ["collection/", "Collection"]];

  const base = new URL(root, location.href).pathname;                  // e.g. /workout-tracker/ or /
  const seg = location.pathname.slice(base.length).split("/")[0];      // first folder below the root
  const here = (seg === "" || seg === "index.html") ? "" : seg + "/";

  const inner = document.createElement("div");
  inner.className = "site-nav-in";
  for (const [path, label] of ITEMS) {
    const a = document.createElement("a");
    a.href = root + path; a.textContent = label;
    if (path === here) { a.className = "active"; a.setAttribute("aria-current", "page"); }
    inner.appendChild(a);
  }
  const gap = document.createElement("span"); gap.className = "nav-gap"; inner.appendChild(gap);
  const clock = document.createElement("span"); clock.className = "nav-clock"; clock.setAttribute("aria-hidden", "true");
  const tick = () => {
    const d = new Date();
    clock.textContent = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).toUpperCase() + "  " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  };
  tick(); setInterval(tick, 30000);
  inner.appendChild(clock);
  nav.appendChild(inner);
})();
