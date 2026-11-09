// Optional browser smoke test: install Playwright separately; never prints access tokens.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${process.env.BROWSER_BASE_URL || 'http://localhost:3000'}/api/docs`, { waitUntil: 'networkidle' });
    await page.locator('.opblock').first().waitFor(); assert.equal(await page.locator('.opblock').count(), 41);
    assert.equal(await page.locator('.opblock-tag').count(), 9);
    const health = page.locator('#operations-Health-HealthController_getHealth_v1');
    await health.locator('.opblock-summary').click(); if (await health.getByRole('button', { name: 'Try it out' }).count()) await health.getByRole('button', { name: 'Try it out' }).click();
    const healthy = page.waitForResponse((r) => r.url().endsWith('/api/v1/health') && r.request().method() === 'GET');
    await health.getByRole('button', { name: 'Execute', exact: true }).click();
    assert.equal((await healthy).status(), 200);
    await health.locator('.opblock-summary').click();
    const checks = ['41 rendered operations', '9 module tags', 'health Try it out returns 200'];
    if (process.env.SWAGGER_TEST_TOKEN) {
      await page.getByRole('button', { name: 'Authorize', exact: true }).first().click();
      await page.locator('.auth-container input').fill(process.env.SWAGGER_TEST_TOKEN);
      await page.locator('.modal-ux .auth.authorize').click();
      await page.locator('.modal-ux .auth.btn-done').click();
      const me = page.locator('#operations-Authentication-AuthController_me_v1');
      await me.locator('.opblock-summary').click(); if (await me.getByRole('button', { name: 'Try it out' }).count()) await me.getByRole('button', { name: 'Try it out' }).click();
      const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/me') && r.request().method() === 'GET');
      await me.getByRole('button', { name: 'Execute', exact: true }).click(); assert.equal((await response).status(), 200);
      await me.locator('.opblock-summary').click(); checks.push('Authorize sends bearer JWT; auth/me returns 200');
    }
    const audio = page.locator('#operations-Media-MediaController_uploadAudio_v1');
    await audio.locator('.opblock-summary').click(); if (await audio.getByRole('button', { name: 'Try it out' }).count()) await audio.getByRole('button', { name: 'Try it out' }).click();
    await audio.locator('input[type=file]').waitFor({ state: 'visible' }); checks.push('multipart file picker available');
    assert.deepEqual(errors, []); checks.push('no page JavaScript errors'); console.log(JSON.stringify({ passed: checks }));
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Browser audit failed'); process.exitCode = 1; });
