import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { TOPICS } from './topics.jsx';

/* The support library: a hub of explainers for the science and logic behind
   the app, deep-linked from "What is this?" links beside each chart. The
   readiness score keeps its dedicated explainer (ReadinessInfo); the hub
   links to it alongside the topics. */
export function SupportView({ topic, onTopic, onBack, onReadinessInfo }) {
  const t = topic && TOPICS.find(x => x.key === topic);

  if (t) return (
    <>
      <div className="section-title"><a className="reset" {...tap(() => onTopic(null))}>← All topics</a></div>
      <div className="card">
        <h2>{t.title}</h2>
        {t.body}
      </div>
    </>
  );

  return (
    <>
      <div className="section-title"><a className="reset" {...tap(onBack)}>← Back</a></div>
      <div className="card">
        <h2>The science behind Try</h2>
        <p className="lead">What every chart means, why the plan is shaped the way it is, and the
          rules the adaptive engine follows. Each page is also linked from the thing it explains.</p>
      </div>
      <div className="card support-list">
        <div className="support-item" {...tap(onReadinessInfo)}>
          <div><div className="t">Your readiness score</div>
            <div className="s">The morning signals, their weights, and the go / ease / recover call</div></div>
          <span className="chev">›</span>
        </div>
        {TOPICS.map(x => (
          <div key={x.key} className="support-item" {...tap(() => onTopic(x.key))}>
            <div><div className="t">{x.title}</div><div className="s">{x.summary}</div></div>
            <span className="chev">›</span>
          </div>
        ))}
      </div>
    </>
  );
}
