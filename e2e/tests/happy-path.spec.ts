import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { apiLogFile } from '../env.js';

/** The console email driver logs "Login code for <email>: <code>" as a JSON log line. */
async function readLoginCode(email: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const log = await readFile(apiLogFile, 'utf8');
        code = new RegExp(`Login code for ${email.replace(/[.+]/g, '\\$&')}: (\\d{6})`).exec(
          log,
        )?.[1];
        return code;
      },
      { message: 'login code in api log', timeout: 10_000 },
    )
    .toBeTruthy();
  return code!;
}

test('sign in, create a project, deploy and follow its logs', async ({ page }) => {
  const id = Date.now().toString(36);
  const email = `e2e-${id}@example.dev`;

  // Signed-out visitors land on /login.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill(await readLoginCode(email));
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('No projects yet')).toBeVisible();

  await page.getByRole('link', { name: 'New project' }).first().click();
  await page.getByLabel('Name').fill(`E2E ${id}`);
  await expect(page.getByLabel('Subdomain')).toHaveValue(`e2e-${id}`);
  await page.getByLabel('GitHub repository').fill('https://github.com/mdn/beginner-html-site');
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByRole('heading', { name: `E2E ${id}` })).toBeVisible();
  await expect(page.getByText('No deployments yet')).toBeVisible();

  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(page).toHaveURL(/\/deployments\/\w+$/);

  // Lines stream in live while the (simulated) build runs, then the header flips to Ready.
  const log = page.getByRole('log');
  await expect(
    log.getByText(/Cloning https:\/\/github\.com\/mdn\/beginner-html-site/),
  ).toBeVisible();
  await expect(log.locator('li[data-level="warn"]')).toContainText('npm WARN deprecated');
  await expect(page.locator('h1 [data-status]')).toHaveAttribute('data-status', 'READY', {
    timeout: 20_000,
  });
  await expect(log.getByText('Deployment ready')).toBeVisible();
  // ANSI escapes from build tools are stripped.
  await expect(log.getByText('✓ 3 modules transformed.')).toBeVisible();
  const liveLines = await log.locator('li').count();

  // A finished deployment shows the same persisted history after a reload.
  await page.reload();
  await expect(log.getByText('Deployment ready')).toBeVisible();
  await expect(log.locator('li')).toHaveCount(liveLines);

  await page.getByRole('link', { name: 'Back to project' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Current' });
  await expect(row.locator('[data-status="READY"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Visit' })).toBeVisible();
});
