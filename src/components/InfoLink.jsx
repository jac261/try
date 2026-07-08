import { tap } from '@/utils/a11y.js';

/* "What is this?" beside a chart or section: deep-links into the support
   library topic that explains it. Renders nothing when the host has no
   support handler (isolated mounts, previews). */
export function InfoLink({ onOpen, topic, label = 'What is this?' }) {
  if (!onOpen) return null;
  return <a className="info-link" {...tap(e => { e.stopPropagation(); onOpen(topic); })}>{label}</a>;
}
