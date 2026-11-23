import { expect, test as base } from 'playwright/test';

export { expect, type Page } from 'playwright/test';

/**
 * The Playwright test, which also fails if the page breaks the Content Security Policy that e2e/serve.ts
 * sends (the production policy from server/web-headers.ts).
 */
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ page }, use) => {
      const violations: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) violations.push(message.text());
      });
      await use(violations);
      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});
