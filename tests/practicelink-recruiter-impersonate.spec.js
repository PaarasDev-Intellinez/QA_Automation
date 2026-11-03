import 'dotenv/config';
import { test, expect } from '@playwright/test';

test.setTimeout(90000);

test('PracticeLink login sanity test', async ({ page }) => {

    // Verify that the required test credentials are available.
    if (!process.env.PL_USERNAME || !process.env.PL_PASSWORD) {
        throw new Error('Test credentials are missing from the .env file.');
    }

    if (!process.env.CLIENT_ID) {
        throw new Error('CLIENT_ID is missing from the .env file.');
    }

    // Capture browser JavaScript errors.
    page.on('pageerror', error => {
        console.log('PAGE JAVASCRIPT ERROR:', error.message);
    });

    // Navigate to PracticeLink.
    await page.goto('/');
    console.log('Navigated to PracticeLink.');

    // Locate and verify the Auth0 login controls.
    const usernameInput = page.getByLabel(/username or email address/i);
    const passwordInput = page.getByRole('textbox', {
        name: 'Password',
        exact: true
    });
    const signInButton = page.getByRole('button', {
        name: 'SIGN IN',
        exact: true
    });

    await expect(usernameInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(signInButton).toBeVisible();

    // Enter credentials and submit the login form.
    await usernameInput.fill(process.env.PL_USERNAME);
    await passwordInput.fill(process.env.PL_PASSWORD);
    await signInButton.click();

    console.log('Submitted login credentials.');

    // Wait for successful authentication or an MFA prompt.
    const otpInput = page.locator(
        'input[autocomplete="one-time-code"], ' +
        'input[name="code"], ' +
        'input[id="code"], ' +
        'input[name="otp"]'
    ).first();

    const authenticationResult = await Promise.race([
        page.waitForURL(
            url =>
                url.hostname === 'plqaadmin.practicelink.com' &&
                url.pathname.toLowerCase().includes('/dashboard/default'),
            { timeout: 60000 }
        ).then(() => 'authenticated'),

        otpInput.waitFor({
            state: 'visible',
            timeout: 60000
        }).then(() => 'mfa-required')
    ]);

    // Skip the test if MFA requires manual verification.
    if (authenticationResult === 'mfa-required') {
        test.skip(
            true,
            'MFA verification is required. Login normally and ensure Remember Me is checked.'
        );
        return;
    }

    // Verify that login was successful.
    await expect(page).toHaveURL(/plqaadmin\.practicelink\.com/);
    await expect(page.locator('body')).toBeVisible();

    console.log('Successfully logged into PracticeLink.');
    await page.waitForTimeout(3000);
    // Navigate to the Manage Employers menu.
    const manageEmployersMenu = page.locator(
        'span.k-link.k-menu-link'
    ).filter({
        hasText: /^Manage Employers$/
    });

    await expect(manageEmployersMenu).toBeVisible();
    await manageEmployersMenu.hover();

    // Open the Manage Employers page.
    const manageEmployersLink = page.locator(
        'a[href="/Content/ManageClients"]'
    );

    await expect(manageEmployersLink).toBeVisible();
    await manageEmployersLink.click();
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/Content\/ManageClients/i);

    console.log('Successfully navigated to Manage Employers.');

    // Enter the Client ID in the search field.
    const clientIdInput = page.getByPlaceholder(
        'Only numeric values allowed',
        { exact: true }
    );

    await expect(clientIdInput).toBeVisible();
    await clientIdInput.fill(process.env.CLIENT_ID);

    console.log(`Entered Client ID: ${process.env.CLIENT_ID}`);

    // Keep the page open for 5 seconds before performing the search.
    await page.waitForTimeout(5000);

    console.log('Waiting period completed. Clicking Search.');

    // Click Search to trigger the Manage Employers request.
    await page.locator('#btnSearch').click();

    console.log('Clicked Search.');

    await page.getByTitle('Recruiters').click();

    const page1Promise = page.waitForEvent('popup');

    await page.getByRole('link', { name: 'Impersonate' }).nth(1).click();
    // Keep the browser open briefly to observe the search results.
    await page.waitForTimeout(10000);

    console.log('Search flow completed.');
});
