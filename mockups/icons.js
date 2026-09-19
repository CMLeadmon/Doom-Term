/* One icon set, shared by the 1:1 study and the fluid app.
   Hand-drawn to the boxes measured in the production screenshot. They are the
   right size in the right place; they are not Warp's own icon set, and the
   parity report says so rather than pretending otherwise. */
export const I = (d, w = 24) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w === 24 ? 1.8 : 1.8}"
    stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const ICON = {
  panel:  I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 4v16"/>'),
  wrench: I('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>'),
  grid:   I('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/>'),
  diffic: I('<path d="M12 5v14M5 12h14"/><path d="M5 19h14"/>'),
  inbox:  I('<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13l2.5 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"/>'),
  back:   I('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
  check:  I('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  share:  I('<path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
  kebab:  I('<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>'),
  sliders:I('<path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>'),
  plus:   I('<path d="M12 5v14M5 12h14"/>'),
  branch: I('<circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 7.2v9.6M18 11.2c0 3-3 3.8-6 3.8"/>'),
  folder: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  mic:    I('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  monitor:I('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  files:  I('<path d="M4 5h6l2 2.5h8v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>'),
  rich:   I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h6M7 14h10"/>'),
  chev:   I('<path d="M6 9l6 6 6-6"/>'),
  undo:   I('<path d="M4 9h11a5 5 0 0 1 0 10h-6"/><path d="M8 5L4 9l4 4"/>'),
  clip:   I('<path d="M20 11.5l-8 8a5 5 0 0 1-7-7l9-9a3.4 3.4 0 0 1 4.8 4.8l-9 9a1.8 1.8 0 0 1-2.5-2.5l8-8"/>'),
  ext:    I('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  copy:   I('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  expand: I('<path d="M9 4H4v5M15 20h5v-5"/><path d="M4 4l7 7M20 20l-7-7"/>'),
  close:  I('<path d="M6 6l12 12M18 6L6 18"/>'),
  bolt:   I('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  file:   I('<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/>'),
  gear:   I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
  ready:  I('<path d="M4 6l6 6-6 6M13 18h7"/>'),
};

