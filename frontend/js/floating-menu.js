/**
 * Positions an open dropdown with `position: fixed` next to its trigger so it is never
 * covered by later siblings or clipped by a scrolling container. The menu is kept inside
 * `boundsEl` (and the viewport): it opens below the trigger when there is room, otherwise
 * above, and is shifted horizontally so it never leaves the bounds.
 *
 * @param {HTMLElement} trigger   Button that opened the menu.
 * @param {HTMLElement} dropdown  Menu element (must already be visible, i.e. not `hidden`).
 * @param {object} [opts]
 * @param {HTMLElement} [opts.boundsEl]  Element whose box the menu must stay inside.
 * @param {"start"|"end"} [opts.align]   Align the menu's left ("start") or right ("end") edge with the trigger.
 */
export function positionFloatingMenu(trigger, dropdown, { boundsEl = null, align = "end" } = {}) {
  const GAP = 4;
  const EDGE = 6;

  dropdown.classList.add("is-floating");
  dropdown.style.top = "0px";
  dropdown.style.left = "0px";

  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const b = boundsEl ? boundsEl.getBoundingClientRect() : { top: 0, left: 0, right: vw, bottom: vh };
  const bounds = {
    top: Math.max(b.top, 0) + EDGE,
    left: Math.max(b.left, 0) + EDGE,
    right: Math.min(b.right, vw) - EDGE,
    bottom: Math.min(b.bottom, vh) - EDGE,
  };

  const t = trigger.getBoundingClientRect();
  const w = dropdown.offsetWidth;
  const h = dropdown.offsetHeight;

  const spaceBelow = bounds.bottom - (t.bottom + GAP);
  const spaceAbove = t.top - GAP - bounds.top;
  let top;
  if (h <= spaceBelow) top = t.bottom + GAP;
  else if (h <= spaceAbove) top = t.top - GAP - h;
  else top = Math.max(bounds.top, bounds.bottom - h);

  let left = align === "start" ? t.left : t.right - w;
  left = Math.min(Math.max(left, bounds.left), Math.max(bounds.left, bounds.right - w));

  dropdown.style.top = `${Math.round(top)}px`;
  dropdown.style.left = `${Math.round(left)}px`;
}

/** Restores a dropdown positioned by positionFloatingMenu to its default CSS placement. */
export function resetFloatingMenu(dropdown) {
  dropdown.classList.remove("is-floating");
  dropdown.style.top = "";
  dropdown.style.left = "";
}
