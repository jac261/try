// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { WellnessEditor } from './WellnessEditor.jsx';
import { WellnessTrends } from './WellnessTrends.jsx';

/* Phase 4 deep links: the sentences that name Settings become the way there
   where a handler is wired, and stay plain sentences where it is not (the
   nullable-callback capability idiom). */

const mount = async node => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(node); });
  return {
    el,
    done: () => { root.unmount(); el.remove(); },
  };
};

describe('the watch-data hint deep links', () => {
  it('WellnessEditor: wired, the link closes the sheet and opens Settings at connections', async () => {
    const calls = [];
    const { el, done } = await mount(
      <WellnessEditor onClose={() => calls.push('close')} onSave={() => {}} existing={null}
        lastWeightKg={null} onOpenSettings={s => calls.push('open:' + s)} />);
    const link = [...el.querySelectorAll('[role="button"]')].find(b => b.textContent === 'watch data in Settings');
    expect(link).toBeTruthy();
    await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(calls).toEqual(['close', 'open:connections']);
    done();
  });

  it('WellnessEditor: unwired, the sentence stays plain', async () => {
    const { el, done } = await mount(
      <WellnessEditor onClose={() => {}} onSave={() => {}} existing={null} lastWeightKg={null} />);
    expect(el.innerHTML).toContain('watch data in Settings');
    const link = [...el.querySelectorAll('[role="button"]')].find(b => b.textContent === 'watch data in Settings');
    expect(link).toBeFalsy();
    done();
  });

  it('WellnessTrends empty state: wired link opens Settings at connections', async () => {
    const calls = [];
    const { el, done } = await mount(
      <WellnessTrends wellness={[]} onSupport={() => {}} onWhatIf={null}
        onOpenSettings={s => calls.push(s)} />);
    const link = [...el.querySelectorAll('[role="button"]')].find(b => b.textContent === 'watch data in Settings');
    expect(link).toBeTruthy();
    await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(calls).toEqual(['connections']);
    done();
  });
});
