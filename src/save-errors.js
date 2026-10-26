// Friendly copy for failed saves. Raw Firestore codes ("permission-denied", "Missing or insufficient permissions") never reach the UI;
// the code still goes to the console for debugging. Pure, unit tested.
export function saveErrorText(e,what='your changes'){const code=String(e?.code||e?.message||'').toLowerCase();
  if(/offline|unavailable|network|failed-precondition|deadline/.test(code))return `You're offline, so ${what} couldn't be saved. Try again when you're connected.`;
  if(/unauthenticated|auth\//.test(code))return `Please sign in again to save ${what}.`;
  if(/permission|denied|insufficient/.test(code))return `Couldn't save ${what} right now. Nothing was lost, so try again in a moment.`;
  return `Couldn't save ${what}. Try again in a moment.`;}
export function reportSaveError(e,what){console.warn('save failed',what,e?.code||e?.message);return saveErrorText(e,what);}
