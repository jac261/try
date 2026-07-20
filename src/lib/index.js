/* Try — domain barrel. Re-exports every lib module so consumers can pull a single
   namespace (`import * as T from '@/lib'`) or cherry-pick names
   (`import { iso, RACES } from '@/lib/...'`). Replaces the old `window.TF` global —
   the module graph now makes load order explicit instead of import-order-dependent. */
export * from './date.js';
export * from './units.js';
export * from './domain.js';
export * from './disciplines.js';
export * from './plan.js';
export * from './wellness.js';
export * from './adapt.js';
export * from './loadmodel.js';
export * from './manual.js';
export * from './review.js';
export * from './recap.js';
export * from './route.js';
export * from './digest.js';
export * from './whatif.js';
export * from './weakest.js';
export * from './autolog.js';
export * from './watch.js';
export * from './profile.js';
export * from './eftp.js';
export * from './runstats.js';
export * from './coach.js';
