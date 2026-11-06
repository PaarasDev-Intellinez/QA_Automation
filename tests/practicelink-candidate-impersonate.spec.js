import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

test.setTimeout(180000);

const OTP_FILE = resolve(process.cwd(), 'otp.txt');

// --------------------------------------------------
// URL VALIDATION
// --------------------------------------------------

const isAdminDashboardUrl = url =>
    url.hostname === 'pldevadmin.practicelink.com' &&
    url.pathname.toLowerCase().includes('/dashboard/default');

const isCandidateDashboardUrl = url =>
    url.hostname === 'pljobsdev.practicelink.com' &&
    url.pathname.toLowerCase() === '/candidate/candidatedashboard';

// --------------------------------------------------
// VISUAL PACING
// --------------------------------------------------

async function pause(page, duration = 700) {
    await page.waitForTimeout(duration);
}

// --------------------------------------------------
// AUTH0 MFA OTP
// --------------------------------------------------

async function waitForOtpFromFile(timeoutMs = 120000) {
    const startTime = Date.now();

    console.log('');
    console.log('======================================');
    console.log('AUTH0 MFA VERIFICATION REQUIRED');
    console.log('Waiting for OTP from otp.txt');
    console.log('======================================');

    while (Date.now() - startTime < timeoutMs) {
        try {
            const otp = (await readFile(OTP_FILE, 'utf8')).trim();

            // Wait until the file contains a complete 6-digit OTP.
            if (/^\d{6}$/.test(otp)) {
                // Delete the file immediately after reading the OTP.
                await rm(OTP_FILE, { force: true });

                console.log('OTP received. Submitting MFA verification.');
                return otp;
            }
        } catch (error) {
            // File does not exist yet. Continue waiting.
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        await new Promise(resolve => setTimeout(resolve, 500));
    }

    await rm(OTP_FILE, { force: true });

    throw new Error(
        'Timed out waiting for the MFA OTP. No valid OTP was received.'
    );
}

// --------------------------------------------------
// CANDIDATE DASHBOARD VERIFICATION
// --------------------------------------------------

async function verifyCandidateDashboardTabs(candidatePage) {
    const tabs = [
        {
            name: 'Jobs Applied For',
            panelId: 'Candidatetabstrip-1',
            contentSelector: '#GridDetails'
        },
        {
            name: 'Jobs Viewed',
            panelId: 'Candidatetabstrip-2',
            contentSelector: '#CandidateViewedJob'
        },
        {
            name: 'My Saved Jobs',
            panelId: 'Candidatetabstrip-3',
            contentSelector: '#GridCandidateSavedJobs'
        },
        {
            name: 'My Messages',
            panelId: 'Candidatetabstrip-4',
            contentSelector: '#CandidateMessage'
        },
        {
            name: 'Blocked Jobs',
            panelId: 'Candidatetabstrip-5',
            contentSelector: '#DivMyIgnoredJobs'
        }
    ];

    // Verify the My Jobs section.
    const myJobsSection = candidatePage.locator(
        '.pannel-inner-shorting'
    ).filter({
        has: candidatePage.locator('#divCandidateDashBoardBlock')
    });

    await expect(myJobsSection).toBeVisible();

    await expect(
        myJobsSection.locator('#divCandidateDashBoardBlock')
    ).toContainText('My Jobs');

    console.log('My Jobs section is visible.');

    await pause(candidatePage, 700);

    // Click each tab and verify its corresponding panel/content.
    for (const tab of tabs) {
        console.log(`Verifying tab: ${tab.name}`);

        const tabLocator = candidatePage.getByText(
            tab.name,
            { exact: true }
        );

        await expect(tabLocator).toBeVisible();

        // Use the click approach that worked during debugging.
        await tabLocator.click({ force: true });

        // Allow the Kendo TabStrip transition to complete.
        await pause(candidatePage, 500);

        const panel = candidatePage.locator(`#${tab.panelId}`);

        await expect(panel).toBeVisible();

        const content = panel.locator(tab.contentSelector);

        await expect(content).toBeVisible();

        console.log(`Verified: ${tab.name}`);

        // Brief pause before moving to the next tab.
        await pause(candidatePage, 700);
    }

    console.log(
        'All Candidate Dashboard tabs verified successfully.'
    );
}

// --------------------------------------------------
// MAIN TEST
// --------------------------------------------------

test('PracticeLink candidate impersonation sanity test', async ({ page }) => {

    // Verify required credentials.
    if (!process.env.PL_USERNAME || !process.env.PL_PASSWORD) {
        throw new Error('Test credentials are missing from the .env file.');
    }

    if (!process.env.CLIENT_ID) {
        throw new Error('CLIENT_ID is missing from the .env file.');
    }

    if (!process.env.Candidate) {
        throw new Error('Candidate is missing from the .env file.');
    }

    const candidateEmail = process.env.Candidate;

    // Remove any stale OTP file from a previous run.
    await rm(OTP_FILE, { force: true });

    // Capture browser JavaScript errors.
    page.on('pageerror', error => {
        console.log('PAGE JAVASCRIPT ERROR:', error.message);
    });

    // ----------------------------------------------
    // STEP 1: OPEN ADMIN LOGIN
    // ----------------------------------------------

    await page.goto('/');

    console.log('Navigated to PracticeLink Admin.');

    await pause(page, 1000);

    // ----------------------------------------------
    // STEP 2: ENTER LOGIN CREDENTIALS
    // ----------------------------------------------

    const usernameInput = page.getByLabel(
        /username or email address/i
    );

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

    await usernameInput.fill(process.env.PL_USERNAME);
    await pause(page, 300);

    await passwordInput.fill(process.env.PL_PASSWORD);
    await pause(page, 500);

    await signInButton.click();

    console.log('Submitted login credentials.');

    // ----------------------------------------------
    // STEP 3: DETECT LOGIN OR MFA
    // ----------------------------------------------

    const otpInput = page.locator(
        'input[autocomplete="one-time-code"], ' +
        'input[name="code"], ' +
        'input[id="code"], ' +
        'input[name="otp"]'
    ).first();

    const authenticationResult = await Promise.race([
        page.waitForURL(
            url => isAdminDashboardUrl(url),
            { timeout: 120000 }
        ).then(() => 'authenticated'),

        otpInput.waitFor({
            state: 'visible',
            timeout: 120000
        }).then(() => 'mfa-required')
    ]);

    // ----------------------------------------------
    // STEP 4: COMPLETE MFA IF REQUIRED
    // ----------------------------------------------

    if (authenticationResult === 'mfa-required') {
        await expect(otpInput).toBeVisible();

        const otp = await waitForOtpFromFile();

        await otpInput.fill(otp);
        await pause(page, 500);

        const continueButton = page.getByRole('button', {
            name: 'Continue',
            exact: true
        });

        await expect(continueButton).toBeVisible();
        await expect(continueButton).toBeEnabled();

        await continueButton.click();

        console.log('MFA verification submitted.');

        await page.waitForURL(
            url => isAdminDashboardUrl(url),
            { timeout: 60000 }
        );

        console.log('MFA verification successful.');
    }

    // ----------------------------------------------
    // STEP 5: VERIFY ADMIN DASHBOARD
    // ----------------------------------------------

    await expect(page).toHaveURL(
        url => isAdminDashboardUrl(url)
    );

    await expect(page.locator('body')).toBeVisible();

    console.log('Successfully logged into PracticeLink Admin.');

    await pause(page, 1200);

    // ----------------------------------------------
    // STEP 6: OPEN MANAGE CANDIDATES
    // ----------------------------------------------

    await page.getByText(
        'DashboardManage ContentManage'
    ).click();

    await pause(page, 800);

    const manageCandidatesLink = page.getByRole('link', {
        name: 'Manage Candidates',
        exact: true
    });

    await expect(manageCandidatesLink).toBeVisible();

    await manageCandidatesLink.click();

    console.log('Navigated to Manage Candidates.');

    await pause(page, 1000);

    // ----------------------------------------------
    // STEP 7: SEARCH FOR THE CANDIDATE
    // ----------------------------------------------

    const candidateEmailInput = page.getByRole('textbox', {
        name: 'Email:',
        exact: true
    });

    await expect(candidateEmailInput).toBeVisible();

    await candidateEmailInput.fill(candidateEmail);

    await pause(page, 500);

    await page.getByRole('button', {
        name: 'Search',
        exact: true
    }).click();

    console.log('Candidate search submitted.');

    // ----------------------------------------------
    // STEP 8: IMPERSONATE THE CANDIDATE
    // ----------------------------------------------

    const impersonateLink = page.getByRole('link', {
        name: 'Impersonate',
        exact: true
    });

    await expect(impersonateLink).toBeVisible();

    await pause(page, 700);

    // Capture the new candidate tab.
    const [candidatePage] = await Promise.all([
        page.context().waitForEvent('page'),
        impersonateLink.click()
    ]);

    candidatePage.on('pageerror', error => {
        console.log(
            'CANDIDATE PAGE JAVASCRIPT ERROR:',
            error.message
        );
    });

    console.log('Candidate impersonation initiated.');

    // ----------------------------------------------
    // STEP 9: WAIT FOR CANDIDATE DASHBOARD
    // ----------------------------------------------

    await candidatePage.waitForURL(
        url => isCandidateDashboardUrl(url),
        { timeout: 60000 }
    );

    await expect(candidatePage.locator('body')).toBeVisible();

    console.log('Candidate Dashboard loaded.');

    await pause(candidatePage, 1200);

    // ----------------------------------------------
    // STEP 10: VERIFY DASHBOARD TABS
    // ----------------------------------------------

    await verifyCandidateDashboardTabs(candidatePage);
    
    // ----------------------------------------------
// STEP 11: OPEN EDIT MY ACCOUNT
// ----------------------------------------------

const myAccountLink = candidatePage.locator(
    '.user-login-dropdown-header > a.btn-dropdown'
);

await expect(myAccountLink).toBeVisible();
await myAccountLink.click();

await pause(candidatePage, 500);

const editMyAccountLink = candidatePage.locator(
    '.login-user-dropdown a[href="/candidate/mycandidateaccount"]'
);

await expect(editMyAccountLink).toBeVisible();
await editMyAccountLink.click();

console.log('Opened Edit My Account.');

    // ----------------------------------------------
    // STEP 12: VERIFY EDIT MY ACCOUNT PAGE
    // ----------------------------------------------

    await candidatePage.waitForURL(
        url =>
            url.hostname === 'pljobsdev.practicelink.com' &&
            url.pathname.toLowerCase().includes('/candidate/mycandidateaccount'),
        { timeout: 60000 }
    );

    await expect(
        candidatePage.getByText('My Candidate Account', {
            exact: true
        })
    ).toBeVisible();

    console.log('Edit My Account page loaded.');

    await pause(candidatePage, 1000);

    // ----------------------------------------------
    // STEP 13: SCROLL TO CANCEL AND RETURN
    // ----------------------------------------------

    const cancelButton = candidatePage.locator('#BtnCancel');

    await expect(cancelButton).toBeAttached();

    await cancelButton.evaluate(element => {
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    });

    await expect(cancelButton).toBeVisible();

    await pause(candidatePage, 1000);

    await cancelButton.click();

    console.log('Clicked Cancel. No changes were saved.');

    // Wait for redirect to complete.
    await candidatePage.waitForURL(
        url =>
            url.hostname === 'pljobsdev.practicelink.com' &&
            url.pathname.toLowerCase().includes('/candidate/reviewcv'),
        { timeout: 60000 }
    );

    await expect(candidatePage.locator('body')).toBeVisible();

    console.log('Returned from Edit My Account.');

    await pause(candidatePage, 1000);

    // ----------------------------------------------
    // STEP 14: OPEN MY ACCOUNT AND LOG OUT
    // ----------------------------------------------

    await expect(myAccountLink).toBeVisible();

    await myAccountLink.click();

    await pause(candidatePage, 500);

    const logoutLink = candidatePage.getByText(
        'LOG OUT',
        { exact: true }
    );

    await expect(logoutLink).toBeVisible();

    await logoutLink.click();

    console.log('Clicked Log Out.');

    // ----------------------------------------------
    // STEP 15: VERIFY LOGOUT REDIRECT
    // ----------------------------------------------

    await candidatePage.waitForURL(
    /https:\/\/dev-auth\.practicelink\.com\/u\/login/,
    { timeout: 60000 }
);

    console.log('Candidate successfully logged out.');

    // Leave the candidate dashboard open for observation.
    await pause(candidatePage, 5000);

    console.log('Candidate impersonation sanity test completed.');
});
