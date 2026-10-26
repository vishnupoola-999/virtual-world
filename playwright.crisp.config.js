import base from './playwright.config.js';
export default { ...base, testMatch: ['crisp-shots.spec.js'], projects: [base.projects[0]], retries: 0 };
