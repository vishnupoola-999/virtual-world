// The 16 interest keys with line icons (design/living-spec.md §1). Shared by the onboarding step, the map and the away card.
export const ICONS={
tech:'<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M8 20h8M12 16v4"/>',
science:'<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 14h9"/>',
cricket:'<path d="m14 4 6 6-9 9-3 1-2-2 1-3z"/><circle cx="6" cy="6" r="2.2"/>',
music:'<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
art:'<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.5-1-2.6 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
startups:'<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 15l-3-3c1-4 4-8 12-9-1 8-5 11-9 12z"/><circle cx="14.5" cy="9.5" r="1.5"/>',
gaming:'<path d="M6 8h12a4 4 0 0 1 3.9 4.8l-.8 3.6A2.5 2.5 0 0 1 16.8 18L15 16H9l-1.8 2a2.5 2.5 0 0 1-4.3-1.6l-.8-3.6A4 4 0 0 1 6 8z"/><path d="M8 11v3M6.5 12.5h3"/><circle cx="16" cy="12" r=".8"/>',
books:'<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 1h13v-3"/>',
movies:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 5l-2 4M13 5l-2 4M18 5l-2 4"/>',
fitness:'<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>',
food:'<path d="M5 3v8a2 2 0 0 0 2 2v8M9 3v8a2 2 0 0 1-2 2M7 3v6"/><path d="M17 21V3c-2 1-3 4-3 7s1 4 3 4"/>',
travel:'<path d="M10.5 13.5 3 11l1.2-1.8 8.3.8 4.5-5c1-1.1 3-1.2 3.4.2.3 1-.3 2-1 2.6l-5 4.4.8 8.3L13.4 22z"/>',
fashion:'<path d="M9 3 4 6l2 4 2-1v12h8V9l2 1 2-4-5-3c-.5 1.5-1.6 2.5-3 2.5S9.5 4.5 9 3z"/>',
coding:'<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
space:'<circle cx="12" cy="12" r="5"/><path d="M3.5 15.5C2 18 2.5 19.5 4 20c2.3.7 7-1.6 11.3-5.6S21.9 6 21 4c-.6-1.4-2.3-1.5-4.6-.2"/>',
photography:'<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>'};
export const LABEL={tech:'Tech',science:'Science',cricket:'Cricket',music:'Music',art:'Art',startups:'Startups',gaming:'Gaming',books:'Books',movies:'Movies',fitness:'Fitness',food:'Food',travel:'Travel',fashion:'Fashion',coding:'Coding',space:'Space',photography:'Photography'};
export const KEYS=Object.keys(ICONS);
export const icon=(k,s=17)=>ICONS[k]?`<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${ICONS[k]}</svg>`:'';
