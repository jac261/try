import { reviewedWeekMonday, digestWindowOpen } from './src/lib/digest.js';

// Sunday 2026-07-19 (confirm day-of-week), 19:00 local
const sunday = '2026-07-19';
console.log('day check (0=Sun):', new Date(sunday + 'T12:00:00').getDay());

console.log('App.jsx call (no hour):', reviewedWeekMonday(sunday));
console.log('WeeklyDigest call (hour=19):', reviewedWeekMonday(sunday, 19));
