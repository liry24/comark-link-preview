import { expect, test, type Page } from '@playwright/test';

async function settled(page: Page) {
  await expect
    .poll(async () => {
      const status = page.locator('[data-status]');
      return (
        (await status.getAttribute('data-rendered-revision')) === (await status.getAttribute('data-revision'))
      );
    })
    .toBe(true);
}

for (const renderer of ['html', 'react', 'vue', 'svelte', 'angular', 'nuxt']) {
  const url =
    renderer === 'angular'
      ? 'http://127.0.0.1:4200/'
      : renderer === 'nuxt'
        ? 'http://127.0.0.1:3000/'
        : `http://127.0.0.1:5173/${renderer}/`;
  test(`${renderer}: plugin-only async output, native previews, streaming, stale edits and failure`, async ({
    page,
    request,
  }) => {
    await expect
      .poll(
        async () => {
          try {
            return (await request.get(url)).status();
          } catch {
            return 0;
          }
        },
        { timeout: 180_000 },
      )
      .toBe(200);
    const hydrationErrors: string[] = [];
    const pageErrors: string[] = [];
    const externalRequests: string[] = [];
    page.on('console', (message) => {
      if (/hydration.*mismatch|mismatch.*hydration/iu.test(message.text()))
        hydrationErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('https://example.test/**', async (route) => {
      externalRequests.push(route.request().url());
      await route.abort();
    });
    const response = await page.goto(url);
    if (renderer === 'nuxt') {
      const html = await response!.text();
      expect(html).toContain('data-clp-id');
      expect(html).toContain('A complete preview from one async parse');
      expect(html).not.toContain('aria-busy="true"');
    }
    const output = page.locator('[data-preview-output]');
    await expect(output).toContainText('End of the streamed document');
    await settled(page);
    const card = output.locator('.clp-inline').first();
    await expect(card.locator('a.clp-link .clp-title')).toHaveText('A complete preview from one async parse');
    await expect(output.locator('.clp-inline').nth(1).locator('a.clp-link .clp-title')).toHaveText(
      'Author title wins',
    );
    await expect(card.locator('a.clp-link')).toHaveAttribute('href', 'https://example.test/article');
    const button = card.locator('[data-clp-toggle]');
    await button.focus();
    await expect(card.locator('.clp-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card.locator('.clp-panel')).not.toBeVisible();
    await button.press('Enter');
    await expect(card.locator('.clp-panel')).toBeVisible();
    const image = card.locator('.clp-panel img.clp-image');
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(button).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(output.locator('a[href="https://example.test/no-image"] img.clp-image')).toHaveCount(0);
    await expect(
      output
        .locator('.clp-inline')
        .filter({ has: page.locator('a[href="https://example.test/no-icon"]') })
        .locator('.clp-favicon img'),
    ).toHaveCount(0);
    await expect(
      output.locator('a[href="https://example.test/broken-image"] img.clp-image'),
    ).not.toBeVisible();
    await expect(output.locator('a[href="https://example.test/failure"]')).toHaveText(
      'https://example.test/failure',
    );
    await expect(output.locator('a[href="https://example.test/empty"]')).toHaveText(
      'https://example.test/empty',
    );
    await expect(output.locator('a[href="https://example.test/plain"]')).toHaveText('normal link');
    await expect(output.locator('[aria-busy="true"]')).toHaveCount(0);

    // Input streaming continues independently. No pending preview/skeleton is published.
    await page.locator('[data-pause-metadata]').check();
    await page.locator('[data-metadata-delay]').fill('100');
    await page.locator('[data-input-delay]').fill('20');
    await page.locator('[data-chunk-size]').fill('20');
    await page.locator('[data-restart]').click();
    await expect
      .poll(async () => (await page.locator('[data-source]').inputValue()).length)
      .toBeGreaterThan(260);
    await page.locator('[data-pause-input]').click();
    const length = (await page.locator('[data-source]').inputValue()).length;
    await expect(output.locator('.clp')).toHaveCount(0);
    await page.locator('[data-pause-metadata]').uncheck();
    await settled(page);
    await expect(output.locator('.clp-inline').first()).toBeVisible();
    expect((await page.locator('[data-source]').inputValue()).length).toBe(length);
    await page.locator('[data-finish]').click();
    await expect(output).toContainText('End of the streamed document');
    await settled(page);

    // An old async parse must never replace a newer edited/cleared document.
    await page.locator('[data-pause-metadata]').check();
    const started = Number(await page.locator('[data-status]').getAttribute('data-started'));
    const completed = Number(await page.locator('[data-status]').getAttribute('data-completed'));
    await page
      .locator('[data-source]')
      .fill('# Superseded\n\n:inline-preview{href="https://example.test/article"}');
    await expect
      .poll(async () => Number(await page.locator('[data-status]').getAttribute('data-started')))
      .toBeGreaterThan(started);
    await page.locator('[data-source]').fill('# Current edit\n\nNo previews here.');
    await settled(page);
    await expect(output).toContainText('Current edit');
    await page.locator('[data-cancel]').click();
    await settled(page);
    await expect(output).toHaveText('');
    await page.locator('[data-pause-metadata]').uncheck();
    await expect
      .poll(async () => Number(await page.locator('[data-status]').getAttribute('data-completed')))
      .toBeGreaterThan(completed);
    await expect(output).toHaveText('');

    await page.locator('[data-failure]').check();
    await page.locator('[data-finish]').click();
    await settled(page);
    await expect(output.locator('.clp')).toHaveCount(0);
    await expect(output.locator('a[href="https://example.test/article"]').first()).toBeVisible();
    await expect(output).toContainText('Author title wins');
    expect(hydrationErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}
