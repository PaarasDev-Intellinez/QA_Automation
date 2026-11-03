import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { createInterface } from 'node:readline/promises';

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
                url.hostname === 'admin.practicelink.com' &&
                url.pathname.toLowerCase().includes('/dashboard/default'),
            { timeout: 60000 }
        ).then(() => 'authenticated'),

        otpInput.waitFor({
            state: 'visible',
            timeout: 60000
        }).then(() => 'mfa-required')
    ]);

    
if (authenticationResult === 'mfa-required') {

    console.log('\n========================================');
    console.log('MFA VERIFICATION REQUIRED');
    console.log('========================================');
    console.log('Please check the admin email inbox.');
    console.log('Enter the OTP received from PracticeLink.');
    console.log('========================================\n');

    // Locate the OTP field shown on the Auth0 page.
    await expect(otpInput).toBeVisible({
    timeout: 15000
});

    // Pause execution and ask for OTP in the CLI.
    const readline = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    let otp;

    try {
        otp = await readline.question('Enter MFA OTP: ');
    } finally {
        readline.close();
    }

    otp = otp.trim();

    // Validate that an OTP was entered.
    if (!otp) {
        throw new Error('MFA OTP was not provided.');
    }

    console.log('OTP received. Submitting MFA verification...');

    // Enter the OTP.
    await otpInput.fill(otp);

    // Remember this device for 30 days.
    const rememberDeviceCheckbox = page.getByRole('checkbox', {
        name: /remember this device for 30 days/i
    });

    if (await rememberDeviceCheckbox.isVisible()) {
        await rememberDeviceCheckbox.check();
    }

    // Submit MFA verification.
    await page.getByRole('button', {
        name: 'Continue',
        exact: true
    }).click();

    console.log('MFA verification submitted.');

    // Wait for successful authentication.
    await page.waitForURL(
        url =>
            url.hostname === 'admin.practicelink.com' &&
            url.pathname.toLowerCase().includes('/dashboard/default'),
        {
            timeout: 60000
        }
    );

    console.log('MFA verification successful.');
}


    // Verify that login was successful.
    await expect(page).toHaveURL(/admin\.practicelink\.com/);
    await expect(page.locator('body')).toBeVisible();

    console.log('Successfully logged into PracticeLink.');
    await page.waitForTimeout(3000);
//     await page.getByText('DashboardManage ContentManage').click();
//     await page.waitForTimeout(3000);
//   await page.getByRole('link', { name: 'Manage Candidates' }).click();
//   await page.waitForTimeout(3000);
//   if (!process.env.Candidate) {
//         throw new Error('Candidate is missing from the .env file.');
//     }
//   await page.getByRole('textbox', { name: 'Email:' }).fill(process.env.Candidate);
//   await page.getByRole('button', { name: 'Search' }).click();
//   await page.getByRole('link', { name: 'Impersonate' }).click();

    // Keep the browser open briefly to observe the search results.
    await page.waitForTimeout(10000);

    console.log('Search flow completed.');
});
