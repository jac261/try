/* ---------------- minimalist line icons ----------------
   Monoline (stroke = currentColor) so they inherit text colour. */
const ICON_PATHS = {
  logo: '<path d="M12 3.2 20.4 18.6 3.6 18.6Z"/><circle cx="12" cy="13.4" r="1.6" fill="currentColor" stroke="none"/>',
  swim: '<circle cx="8.2" cy="7" r="2"/><path d="M10 7.6l2.8-2.5 3.4.8"/><path d="M3 10.9c1.2.9 2.4.9 3.6 0s2.4-.9 3.6 0 2.4.9 3.6 0 2.4-.9 3.6 0"/><path d="M3 14.3c1.2.9 2.4.9 3.6 0s2.4-.9 3.6 0 2.4.9 3.6 0 2.4-.9 3.6 0"/>',
  bike: '<circle cx="5.6" cy="16.4" r="3"/><circle cx="18.4" cy="16.4" r="3"/><path d="M5.6 16.4L9 9.6h7"/><path d="M9 9.6l2 6.8 5-7.4"/><path d="M16 9l2.4 7.4"/><path d="M7.7 9.3h2.5"/><path d="M14.7 8h2.7"/>',
  run: '<circle cx="15" cy="3.6" r="2.4" fill="currentColor" stroke="none"/><path fill="none" d="M14.3 7.2L11.4 13.6"/><path fill="none" d="M14.2 7.9l3.2 1l2.4-.4"/><path fill="none" d="M13.6 8L10 8.4l.8 3"/><path fill="none" d="M11.4 13.6l3 2v4.4"/><path fill="none" d="M11.4 13.6l-2 2.6-3 1.6"/><path fill="none" stroke-width="1.6" d="M5.4 8.2H2.6"/><path fill="none" stroke-width="1.6" d="M5 11.4H1.4"/><path fill="none" stroke-width="1.6" d="M5.6 14.4H3.2"/>',
  brick: '<path d="M4 9h13l-3.4-3.4"/><path d="M20 15H7l3.4 3.4"/>',
  rest: '<path d="M20 14.5A8.5 8.5 0 1 1 10 4 6.5 6.5 0 0 0 20 14.5Z"/>',
  strength: '<path d="M6 9 6 15"/><path d="M3.5 10.5 3.5 13.5"/><path d="M18 9 18 15"/><path d="M20.5 10.5 20.5 13.5"/><path d="M6 12 18 12"/>',
  today: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5 12 5"/><path d="M12 19 12 21.5"/><path d="M2.5 12 5 12"/><path d="M19 12 21.5 12"/><path d="M5.2 5.2 7 7"/><path d="M17 17 18.8 18.8"/><path d="M18.8 5.2 17 7"/><path d="M7 17 5.2 18.8"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5 20.5 9.5"/><path d="M8 3 8 6.5"/><path d="M16 3 16 6.5"/>',
  plan: '<rect x="4" y="5" width="16" height="15.5" rx="2.5"/><path d="M4 9.5h16"/><path d="M8.5 3v4"/><path d="M15.5 3v4"/><path d="M8.8 14l2 2 3.6-3.6"/>',
  progress: '<path d="M4 20.5 20 20.5"/><path d="M7 20.5 7 13"/><path d="M12 20.5 12 7"/><path d="M17 20.5 17 10"/>',
  you: '<circle cx="12" cy="8" r="4"/><path d="M5 20.4a7 7 0 0114 0"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  bolt: '<path d="M13 2.5 5 13 11 13 10.5 21.5 19 10.5 12.5 10.5Z"/>',
  flag: '<path d="M6 21.5 6 3.5"/><path d="M6 4.5 17.5 4.5 14.6 8 17.5 11.5 6 11.5"/>',
  flame: '<path d="M12 3c.5 3.5 4.5 5 4.5 9.5a4.5 4.5 0 0 1-9 0c0-1.7.8-2.8 1.7-3.7.2 1.2 1 1.8 1.6 1.3C12 9 11 6.5 12 3Z"/>',
  download: '<path d="M12 3.5 12 14.5"/><path d="M7.5 10 12 14.5 16.5 10"/><path d="M5 20 19 20"/>',
  trend: '<path d="M3 16.5 9 10.5 13 14.5 21 6.5"/><path d="M15 6.5 21 6.5 21 12.5"/>',
  watch: '<rect x="7" y="6" width="10" height="12" rx="2.6"/><path d="M9 6 9.4 3 14.6 3 15 6"/><path d="M9 18 9.4 21 14.6 21 15 18"/><circle cx="12" cy="12" r="2.1"/>',
  // Rest of the triathlon set — available for tests, pace targets, routes, HR &
  // achievements (some map to roadmap features not yet wired into the UI).
  transition: '<path d="M4 9h13l-3.4-3.4"/><path d="M20 15H7l3.4 3.4"/>',
  stopwatch: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.6"/><path d="M9.8 2.6h4.4"/><path d="M12 2.6v2.1"/><path d="M18.6 7.1l1.7-1.7"/>',
  route: '<path d="M12 21c4-4.5 6-7.6 6-10.6a6 6 0 10-12 0C6 13.4 8 16.5 12 21z"/><circle cx="12" cy="10.4" r="2.2"/>',
  heartrate: '<path d="M20.5 9.3c0 3.2-2.9 5.8-7.4 10l-1.1 1-1.1-1C6.4 15.1 3.5 12.5 3.5 9.3 3.5 6.7 5.5 4.7 8 4.7c1.6 0 3 .8 3.8 2 .9-1.2 2.3-2 3.9-2 2.5 0 4.8 2 4.8 4.6z"/><path d="M3.8 11.8H8l1.4-2.6 2 5 1.6-3.2h5.1"/>',
  pace: '<path d="M4.6 17a7.5 7.5 0 1114.8 0"/><path d="M12 17l4.2-4.2"/><circle cx="12" cy="17" r="1.2"/><path d="M4.6 17h1.4"/><path d="M18 17h1.4"/><path d="M12 9.6v1.4"/>',
  trophy: '<path d="M8 4.5h8v4.6a4 4 0 01-8 0z"/><path d="M8 5.6H5.2v1.7a3 3 0 002.9 3"/><path d="M16 5.6h2.8v1.7a3 3 0 01-2.9 3"/><path d="M12 13.5v3"/><path d="M9 20.5l.8-4h4.4l.8 4z"/><path d="M8.4 20.5h7.2"/>',
  settings: '<path d="M4 8h9"/><path d="M18 8h2"/><circle cx="15.5" cy="8" r="2.5"/><path d="M4 16h3"/><path d="M12 16h8"/><circle cx="9.5" cy="16" r="2.5"/>',
};
// New triathlon set is drawn for a uniform stroke-width of 2 (the app default);
// no per-icon weight overrides needed.
const ICON_BOLD = {};
export function Icon({ name, size }) {
  const s = size || 22;
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={ICON_BOLD[name] || 2} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: 'block', flex: 'none' }}
    dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] || '' }} />;
}

