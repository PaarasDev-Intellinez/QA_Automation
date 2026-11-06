import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

test.setTimeout(180000);

const OTP_FILE = resolve(process.cwd(), 'otp.txt');

const isAdminDashboardUrl = url =>
    url.hostname === 'pldevadmin.practicelink.com' &&
    url.pathname.toLowerCase().includes('/dashboard/default');

    

async function verifyNavigationMenu(page, menuName) {
    const mainMenu = page.locator('.rms-menu-main');

    // Locate only the actual menu heading.
    const menuHeading = mainMenu
        .locator('div.disable-link-hover')
        .filter({
            hasText: new RegExp(`^${menuName}$`)
        });

    await expect(menuHeading).toBeVisible();

    const menuItem = menuHeading.locator('xpath=..');
    const submenu = menuItem.locator('.sub-menu');

    // Open the dropdown.
    await menuHeading.click();

    // Verify dropdown visibility.
    await expect(submenu).toBeVisible();

    // Verify at least one submenu link is visible.
    await expect(submenu.locator('a').first()).toBeVisible();

    console.log(`Successfully loaded ${menuName} menu.`);
}

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

test('PracticeLink recruiter impersonation sanity test', async ({ page }) => {

    // Verify required credentials.
    if (!process.env.PL_USERNAME || !process.env.PL_PASSWORD) {
        throw new Error('Test credentials are missing from the .env file.');
    }

    if (!process.env.CLIENT_ID) {
        throw new Error('CLIENT_ID is missing from the .env file.');
    }

    // Remove any stale OTP file from a previous run.
    await rm(OTP_FILE, { force: true });

    // Capture browser JavaScript errors.
    page.on('pageerror', error => {
        console.log('PAGE JAVASCRIPT ERROR:', error.message);
    });

    // Navigate to PracticeLink Admin using the configured baseURL.
    await page.goto('/');
    console.log('Navigated to PracticeLink Admin.');

    // Locate Auth0 login controls.
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

    // Submit login credentials.
    await usernameInput.fill(process.env.PL_USERNAME);
    await passwordInput.fill(process.env.PL_PASSWORD);
    await signInButton.click();

    console.log('Submitted login credentials.');

    // Detect successful authentication or MFA.
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

    // Handle MFA using the temporary OTP file.
    if (authenticationResult === 'mfa-required') {
        await expect(otpInput).toBeVisible();

        const otp = await waitForOtpFromFile();

        await otpInput.fill(otp);

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

    // Verify successful login.
    await expect(page).toHaveURL(
        url => isAdminDashboardUrl(url)
    );

    await expect(page.locator('body')).toBeVisible();

    console.log('Successfully logged into PracticeLink Admin.');

    await page.waitForTimeout(3000);

    // Navigate to Manage Employers.
    const manageEmployersMenu = page.locator(
        'span.k-link.k-menu-link'
    ).filter({
        hasText: /^Manage Employers$/
    });

    await expect(manageEmployersMenu).toBeVisible();
    await manageEmployersMenu.hover();

    const manageEmployersLink = page.locator(
        'a[href="/Content/ManageClients"]'
    );

    await expect(manageEmployersLink).toBeVisible();
    await manageEmployersLink.click();

    await page.waitForTimeout(3000);

    await expect(page).toHaveURL(/\/Content\/ManageClients/i);

    console.log('Successfully navigated to Manage Employers.');

    // Enter Client ID.
    const clientIdInput = page.getByPlaceholder(
        'Only numeric values allowed',
        { exact: true }
    );

    await expect(clientIdInput).toBeVisible();
    await clientIdInput.fill(process.env.CLIENT_ID);

    console.log('Entered Client ID.');

    await page.waitForTimeout(5000);

    console.log('Clicking Search.');

    await page.locator('#btnSearch').click();

    console.log('Clicked Search.');

    // Open Recruiters section.
    await page.getByTitle('Recruiters').click();

    console.log('Clicked Recruiters.');

    // Prepare popup listener before clicking Impersonate.
   const popupPromise = page.waitForEvent('popup');
await page.waitForTimeout(5000);
await page.getByRole('link', {
    name: 'Impersonate'
}).nth(1).click();

const impersonationPage = await popupPromise;

await impersonationPage.waitForLoadState('domcontentloaded');

await expect(impersonationPage).toHaveURL(
    /\/Rms\/EmployerDashboard/i
);

console.log('Successfully opened Employer Dashboard.');

    // Verify the Announcements banner carousel.
    const announcementPanel = impersonationPage.locator(
        '.panel:has(label[for="CLAnnouncementTitle"])'
    );

    const activeBannerImage = announcementPanel.locator(
        '#carousaldiv .item.active img'
    );

    const nextBannerButton = announcementPanel.locator(
        'a.carousel-control[data-slide="next"][href="#quote-carousel"]'
    );

    const previousBannerButton = announcementPanel.locator(
        'a.carousel-control[data-slide="prev"][href="#quote-carousel"]'
    );

    // Verify the carousel and its controls are available.
    await expect(announcementPanel).toBeVisible();
    await expect(activeBannerImage).toBeVisible();
    await expect(nextBannerButton).toBeVisible();
    await expect(previousBannerButton).toBeVisible();

    // Capture the initially active banner.
    const initialBannerSrc = await activeBannerImage.getAttribute('src');

    expect(initialBannerSrc).toBeTruthy();

    console.log('Initial banner:', initialBannerSrc);

    // Keep the carousel hovered to avoid automatic rotation
    // interfering with the manual navigation test.
    await announcementPanel.hover();

    // Verify that the Next button changes the active banner.
    await nextBannerButton.click();

    await expect.poll(
        async () => activeBannerImage.getAttribute('src'),
        {
            message: 'Expected the next banner to become active.'
        }
    ).not.toBe(initialBannerSrc);

    const nextBannerSrc = await activeBannerImage.getAttribute('src');

    console.log('Next banner:', nextBannerSrc);

    // Verify that the Previous button returns to the initial banner.
    await previousBannerButton.click();

    await expect.poll(
        async () => activeBannerImage.getAttribute('src'),
        {
            message: 'Expected the previous button to restore the initial banner.'
        }
    ).toBe(initialBannerSrc);

    console.log('Announcements carousel sanity test passed.');

    
    // Verify all Employer Dashboard navigation menus.
    const navigationMenus = [
        'Account',
        'Post',
        'Source',
        'Track',
        'Reports',
        'Solutions',
        'Client Resources'
    ];

    for (const menuName of navigationMenus) {
        await verifyNavigationMenu(
            impersonationPage,
            menuName
        );
        await impersonationPage.waitForTimeout(1000);
    }

    console.log(
        'All Employer Dashboard navigation menus passed.'
    );

    
    // ==========================================
    // EDIT MY ACCOUNT - CANCEL WITHOUT SAVING
    // ==========================================

    // Open the My Account dropdown.
    const myAccountButton = impersonationPage.locator(
        '.user-login-dropdown-header a.btn-dropdown'
    );

    await expect(myAccountButton).toBeVisible();
    await myAccountButton.click();

    // Locate and open Edit My Account.
    const editMyAccountLink = impersonationPage.locator(
        '.login-user-dropdown a[href="/rms/accountdetail"]'
    );

    await expect(editMyAccountLink).toBeVisible();
    await editMyAccountLink.click();

    console.log('Clicked Edit My Account.');

    // Verify that the Account Details page loads.
    await expect(impersonationPage).toHaveURL(
        /\/rms\/accountdetail/i
    );

    await expect(
    impersonationPage.locator('#divAccountDetail')
        .getByText('My Preferences', {
            exact: true
        })
).toBeVisible();

    console.log('Edit My Account page loaded successfully.');

    // Locate the Cancel button.
    const cancelButton = impersonationPage.locator('#BtnCancel');

    await expect(cancelButton).toBeVisible();
    await expect(cancelButton).toBeEnabled();

    // Smoothly scroll to the bottom of the page.
    await impersonationPage.evaluate(() => {
        window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: 'smooth'
        });
    });

    // Wait until the Cancel button is within the viewport.
    await expect.poll(
        async () => cancelButton.evaluate(element => {
            const rect = element.getBoundingClientRect();

            return (
                rect.top >= 0 &&
                rect.bottom <= window.innerHeight
            );
        }),
        {
            message: 'Expected Cancel button to be at the bottom of the page.'
        }
    ).toBe(true);

    console.log('Scrolled to the bottom of Edit My Account.');

    // Cancel without saving any changes.
    await cancelButton.click();

    // Verify return to the Employer Dashboard.
    await expect(impersonationPage).toHaveURL(
        /\/Rms\/ManageRecruiters/i
    );

    console.log(
        'Successfully canceled without saving.'
    );

    
    // ==========================================
    // LOGOUT - VERIFY RECRUITER SESSION ENDS
    // ==========================================

    // Open the My Account dropdown.
    const MyAccountButton = impersonationPage.locator(
        '.user-login-dropdown-header a.btn-dropdown'
    );

    await expect(MyAccountButton).toBeVisible();
    await MyAccountButton.click();

    // Locate the Logout link.
    const logoutLink = impersonationPage.locator(
        '.login-user-dropdown a[href="/myaccount/logout"]'
    );

    await expect(logoutLink).toBeVisible();

    console.log('Clicking Logout.');

    // Click Logout and wait for navigation.
    await Promise.all([
        impersonationPage.waitForNavigation(),
        logoutLink.click()
    ]);

    console.log(
        'URL after logout:',
        impersonationPage.url()
    );

    // Verify that the recruiter is redirected to the login page.
    await expect(impersonationPage).toHaveURL(
        /login|signin|authorize/i
    );

    // Verify that the authenticated dashboard is no longer displayed.
    await expect(
        impersonationPage.locator(
            '.user-login-dropdown-header'
        )
    ).toHaveCount(0);

    console.log('Recruiter logout sanity test passed.');

});
