import { fromThresholdProposal } from './decision.js';
import { cssProposalDetails, ftpProposalDetails } from '../eftp.js';
import { runProposalDetails } from '../run-benchmark.js';

/* Try — shared coaching layer: the proposal model (phase 2 §4).
 *
 * A threshold change is a proposal, never an immediate mutation — the rule
 * every module already enforces. This wraps the existing details builders
 * (the exact objects the sheets render) into the spec's proposal shape, so
 * the preview CANNOT disagree with the sheet: they are the same fields.
 *
 * Invariants carried by construction: the decision inside comes from
 * fromThresholdProposal (estimated sources keep their kind; retargets are
 * honestly irreversible); a details builder returning null (estimated
 * anchor, nothing to compare) yields no proposal at all — an estimated
 * anchor can never become an accepted measured one because the sheet that
 * would offer it never opens.
 */

const KINDS = { swim: 'css-retarget', bike: 'ftp-retarget', run: 'run-benchmark-retarget' };

export function toCoachingProposal({ proposal, plan, todayISO }) {
  if (!proposal || !proposal.retarget) return null;
  const details = proposal.sport === 'swim' ? cssProposalDetails({ proposal, plan })
    : proposal.sport === 'bike' ? ftpProposalDetails({ proposal, plan })
      : runProposalDetails({ proposal, plan, todayISO });
  if (!details) return null;
  const decision = fromThresholdProposal(proposal, { at: todayISO });
  const current = proposal.sport === 'swim' ? details.curLabel
    : proposal.sport === 'bike' ? details.currentWatts : details.curSec;
  const proposed = proposal.sport === 'swim' ? details.nextLabel
    : proposal.sport === 'bike' ? details.proposedWatts : details.nextSec;
  return Object.freeze({
    id: decision.id,
    kind: KINDS[proposal.sport],
    currentValue: current,
    proposedValue: proposed,
    decision,
    preview: Object.freeze({
      summary: proposal.headline,
      details,               // the sheet's own fields, verbatim
    }),
  });
}
