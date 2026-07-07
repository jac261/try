/* Try — domain barrel. Re-exports every lib module so consumers can pull a single
   namespace (`import * as T from '@/lib'`) or cherry-pick names
   (`import { iso, RACES } from '@/lib/...'`). Replaces the old `window.TF` global —
   the module graph now makes load order explicit instead of import-order-dependent. */
export * from './date.js';
export * from './units.js';
export * from './domain.js';
export * from './disciplines.js';
export * from './plan.js';
export * from './fit.js';
export * from './wellness.js';
export * from './adapt.js';
export * from './autolog.js';
export * from './watch.js';
