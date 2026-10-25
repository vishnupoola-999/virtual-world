// Feature flag for the real Gmail/Calendar API path (OAuth scopes gmail.send + calendar.events).
// OFF for everyone except these allowlisted Google accounts. Everyone else uses no-OAuth links.
export const TOOLS_API_ALLOWLIST = ['srilathapoola6@gmail.com'];
export function toolsApiEnabled(user, allow = TOOLS_API_ALLOWLIST) {
  const email = String(user?.email || '').toLowerCase();
  return !!(email && user?.emailVerified !== false && allow.includes(email));
}
