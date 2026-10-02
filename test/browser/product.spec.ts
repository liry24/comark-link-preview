import { expect, test } from '@playwright/test';
for (const renderer of ['html', 'react', 'vue', 'svelte', 'angular', 'nuxt']) {
  const url =
    renderer === 'angular'
      ? 'http://127.0.0.1:4200/'
      : renderer === 'nuxt'
        ? 'http://127.0.0.1:3000/'
        : `http://127.0.0.1:5173/${renderer}/`;
  test(`${renderer}: streamed content, independent metadata, usable preview, cancellation and fallback`, async ({
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
    page.on('console', (message) => {
      if (/hydration.*mismatch|mismatch.*hydration/iu.test(message.text()))
        hydrationErrors.push(message.text());
    });
    const response = await page.goto(url);
    if (renderer === 'nuxt') expect(await response!.text()).toContain('data-clp-id');
    const output = page.locator('[data-preview-output]');
    await page.locator('[data-pause-metadata]').check();
    await page.locator('[data-field-delay]').fill('100');
    await page.locator('[data-input-delay]').fill('10');
    await page.locator('[data-chunk-size]').fill('20');
    await page.locator('[data-restart]').click();
    const card = output.locator('.clp-inline').first();
    await expect(card).toBeVisible();
    await page.locator('[data-pause-input]').click();
    const length = (await page.locator('[data-source]').inputValue()).length;
    await expect(card).toHaveAttribute('aria-busy', 'true');
    const original = await card.elementHandle();
    const button = card.locator('[data-clp-toggle]');
    await button.focus();
    await expect(card.locator('.clp-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card.locator('.clp-panel')).not.toBeVisible();
    await page.locator('[data-pause-metadata]').evaluate((element) => {
      (element as HTMLInputElement).checked = false;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(card.locator('.clp-title').first()).toHaveText('A title arrived before the image');
    expect((await page.locator('[data-source]').inputValue()).length).toBe(length);
    if (renderer !== 'angular')
      expect(await card.evaluate((element, old) => element === old, original)).toBe(true);
    await expect(card.locator('.clp-panel')).not.toBeVisible();
    await button.click();
    const image = card.locator('.clp-panel img.clp-image');
    await expect(image).toBeVisible();
    if (renderer !== 'angular') await expect(button).toBeFocused();
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(card.locator('a.clp-link')).toHaveAttribute('href', 'https://example.test/article');
    await page.locator('[data-finish]').click();
    await expect(output).toContainText('End of the streamed document');
    await expect(output.locator('.clp[aria-busy="true"]')).toHaveCount(0);
    await expect(output.locator('a[href="https://example.test/failure"]')).toHaveText(
      'https://example.test/failure',
    );
    await expect(output.locator('a[href="https://example.test/empty"]')).toHaveText(
      'https://example.test/empty',
    );
    await expect(output.locator('a[href="https://example.test/plain"]')).toHaveText('normal link');
    const broken = output.locator('a[href="https://example.test/broken-image"] img.clp-image');
    await expect(broken).not.toBeVisible();
    await page.locator('[data-cancel]').click();
    await expect(output.locator('[data-clp-id]')).toHaveCount(0);
    await page.locator('[data-failure]').check();
    await page.locator('[data-finish]').click();
    await expect(output.locator('.clp[aria-busy="true"]')).toHaveCount(0);
    await expect(output.locator('a[href="https://example.test/article"]').first()).toBeVisible();
    expect(hydrationErrors).toEqual([]);
  });
}
