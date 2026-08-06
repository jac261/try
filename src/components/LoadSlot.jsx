/* The number on the right of a calendar week row: what this session cost.
 *
 * One component so a planned session, a matched session and a recording the
 * plan never asked for all wear the number the same way — the week's total is
 * the sum of these, and a total whose parts are formatted differently invites
 * the reader to think they are different currencies. They are not: both are
 * TSS, and the tilde says only that this one was modelled rather than
 * measured, the same marker the digest and the Assumption Center use.
 *
 * The markup is <b> then <span>, which is what .wk-day .right already styles
 * (15px/800 over 9.5px/800, stacked), so this needs no CSS of its own. */
export function LoadSlot({ tss, measured }) {
  return <><b>{measured ? '' : '~'}{Math.round(tss)}</b><span>TSS</span></>;
}

// The same fact for a screen reader, which gets no tilde: the stat line is
// aria-hidden's opposite here — it rides in the row's accessible name, and an
// unspoken estimate marker would be a silent difference between what the
// screen says and what the athlete hears.
export function loadSpoken({ tss, measured }) {
  return (measured ? '' : 'about ') + Math.round(tss) + ' TSS';
}
