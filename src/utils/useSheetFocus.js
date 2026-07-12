import { useEffect, useRef } from 'react';

/* a11y: modal focus management for the bottom sheets. Attach the returned ref
   to the .sheet element (with tabIndex={-1}): focus moves into the sheet on
   open, Tab cycles within it, Escape closes, and focus returns to whatever
   opened it on close. Dependency-free by design — the repo avoids packages. */
const FOCUSABLE = 'a, button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useSheetFocus(onClose) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const sheet = ref.current;
    if (!sheet) return; // consumer rendered null (e.g. a recap whose recording vanished)
    const trigger = document.activeElement;
    sheet.focus();
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const items = [...sheet.querySelectorAll(FOCUSABLE)]
        .filter(el => el.offsetWidth || el.offsetHeight || el === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const cur = document.activeElement;
      if (!sheet.contains(cur)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (cur === first || cur === sheet)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (trigger && trigger.focus) trigger.focus();
    };
  }, []);
  return ref;
}
