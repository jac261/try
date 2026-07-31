/* The confidence vocabulary, worn as a chip (phase 2 §5.3). The TEXT is
   exactly what the prose used to say — "high confidence" — so pinned copy
   survives; only the wrapping changed. Low confidence is the visually
   quietest, deliberately: uncertainty should never look like a warning. */
export function ConfidenceBadge({ confidence }) {
  if (!confidence) return null;
  return <span className={'conf-badge ' + confidence}>{confidence} confidence</span>;
}
