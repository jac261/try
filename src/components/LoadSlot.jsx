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
 * (15px/800 over 9.5px/800, stacked), so this needs no CSS of its own.
 *
 * The tilde is spoken from INSIDE, as a visually-hidden word rather than an
 * aria-label on the row. WorkoutRow deliberately has no aria-label (its own
 * comment says why: a label there would have to restate the title, type,
 * distance, duration, day and seven tags, and would drift from them the first
 * time any changed), so its accessible name is built from its content — and a
 * tilde read as content is read as nothing at all. Every planned row on the
 * calendar announced a modelled number as though it had been measured (audit
 * 2026-08-06). A row that supplies its own label instead, like the recorded
 * list's, hides this slot and speaks loadSpoken; the two never both fire. */
export function LoadSlot({ tss, measured }) {
  return <>{!measured && <span className="sr-only">about </span>}
    <b>{measured ? '' : '~'}{Math.round(tss)}</b><span>TSS</span></>;
}

// The same fact for a screen reader, which gets no tilde: the stat line is
// aria-hidden's opposite here — it rides in the row's accessible name, and an
// unspoken estimate marker would be a silent difference between what the
// screen says and what the athlete hears.
export function loadSpoken({ tss, measured }) {
  return (measured ? '' : 'about ') + Math.round(tss) + ' TSS';
}
