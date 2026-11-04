
import 'dotenv/config';
import { test, expect } from '@playwright/test';

test.setTimeout(90000);

test('PracticeLink Admin login reaches Auth0 OTP page', async ({ page }) => {
    // Verify that the required credentials are available.
    if (!process.env.PL_USERNAME || !process.env.PL_PASSWORD) {
        throw new Error(
            'Test credentials are missing. Check PL_USERNAME and PL_PASSWORD.'
        );
    }

    // Capture browser JavaScript errors.
    page.on('pageerror', error => {
        console.log('PAGE JAVASCRIPT ERROR:', error.message);
    });

    // Navigate to PracticeLink Admin.
    await page.goto('/');

    console.log('Navigated to PracticeLink Admin.');

    // Locate the Auth0 login controls.
    const usernameInput = page.getByLabel(/username or email address/i);

    const passwordInput = page.getByRole('textbox', {
        name: 'Password',
        exact: true
    });

    const signInButton = page.getByRole('button', {
        name: 'SIGN IN',
        exact: true
    });

    // Verify that the login form is visible.
    await expect(usernameInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(signInButton).toBeVisible();

    console.log('Auth0 login form is visible.');

    // Enter credentials and submit.
    await usernameInput.fill(process.env.PL_USERNAME);
    await passwordInput.fill(process.env.PL_PASSWORD);

    await signInButton.click();

    console.log('Submitted login credentials.');

    // Locate the OTP field.
    const otpInput = page.locator(
        'input[autocomplete="one-time-code"], ' +
        'input[name="code"], ' +
        'input[id="code"], ' +
        'input[name="otp"]'
    ).first();

    // Wait until Auth0 displays the OTP verification page.
    await expect(otpInput).toBeVisible({
        timeout: 60000
    });

    console.log('');
    console.log('========================================');
    console.log('AUTH0 OTP PAGE REACHED');
    console.log('========================================');
    console.log('The login credentials were submitted.');
    console.log('The browser is now on the OTP verification page.');
    console.log('This test will end without submitting an OTP.');
    console.log('========================================');

    // Verify that the OTP field is present.
    await expect(otpInput).toBeVisible();

    console.log('Initial login flow completed successfully.');
});
