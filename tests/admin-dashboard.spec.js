import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

test.setTimeout(180000);

const OTP_FILE = resolve(process.cwd(), 'otp.txt');

const isAdminDashboardUrl = url =>
    url.hostname === 'pldevadmin.practicelink.com' &&
    url.pathname.toLowerCase().includes('/dashboard/default');

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
    
    
    // ==========================================
    // DASHBOARD SCROLL SANITY CHECK
    // ==========================================

    console.log('');
    console.log('Starting Dashboard Scroll Sanity Check.');

    // Smoothly scroll to the bottom of the dashboard.
    await page.evaluate(() => {
        window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: 'smooth'
        });
    });

    // Wait until the smooth scroll animation reaches the bottom.
    await expect.poll(
        async () => page.evaluate(() => {
            return window.scrollY + window.innerHeight >=
                document.documentElement.scrollHeight - 2;
        }),
        {
            timeout: 20000,
            intervals: [250, 500, 750]
        }
    ).toBe(true);

    // Small pause after completing the scroll animation.
    await page.waitForTimeout(800);

    console.log('Successfully scrolled to the bottom.');

    // Smoothly scroll back to the top.
    await page.evaluate(() => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    // Wait until the smooth scroll animation reaches the top.
    await expect.poll(
        async () => page.evaluate(() => window.scrollY),
        {
            timeout: 20000,
            intervals: [250, 500, 750]
        }
    ).toBe(0);

    // Allow the page to settle after scrolling.
    await page.waitForTimeout(800);

    console.log('Successfully scrolled back to the top.');

    
    // ==========================================
    // DASHBOARD MENU DROPDOWN SANITY CHECK
    // ==========================================

    console.log('');
    console.log('Starting Dashboard Menu Dropdown Sanity Check.');

    // Locate all top-level menu items that have dropdowns.
    const menuItems = page.locator(
        '#menu > li[aria-haspopup="true"]'
    );

    const menuItemCount = await menuItems.count();

    console.log(`Found ${menuItemCount} dropdown menu items.`);

    // Verify that the expected dropdown menu items exist.
    expect(menuItemCount).toBe(8);

    // Allow the dashboard navigation to settle.
    await page.waitForTimeout(800);

    // Iterate through each dropdown menu item.
    for (let i = 0; i < menuItemCount; i++) {

        const menuItem = menuItems.nth(i);

        // Locate the clickable top-level menu trigger.
        const menuTrigger = menuItem.locator(
            ':scope > .k-link'
        );

        // Retrieve the menu item name.
        const menuName = (
            await menuTrigger.innerText()
        ).trim().replace(/\s+/g, ' ');

        console.log('');
        console.log(`Checking menu: ${menuName}`);

        // Locate the dropdown associated with this menu item.
        const dropdown = menuItem.locator(
            ':scope > ul.k-group, ' +
            ':scope > .k-animation-container ul.k-group'
        ).first();

        // Ensure the menu trigger is visible and enabled.
        await expect(menuTrigger).toBeVisible();
        await expect(menuTrigger).toBeEnabled();

        // Click the menu item to open its dropdown.
        await menuTrigger.click();

        console.log(`Clicked menu: ${menuName}`);

        // Allow Kendo's dropdown animation to begin.
        await page.waitForTimeout(400);

        // Verify that the dropdown becomes visible.
        await expect(dropdown).toBeVisible({
            timeout: 10000
        });

        // Wait briefly for the dropdown animation to complete.
        await page.waitForTimeout(600);

        // Verify that the dropdown contains menu items.
        const submenuItems = dropdown.locator(
            'li[role="menuitem"]'
        );

        const submenuCount = await submenuItems.count();

        expect(submenuCount).toBeGreaterThan(0);

        console.log(
            `PASS: ${menuName} dropdown loaded successfully.`
        );

        console.log(
            `Submenu items found: ${submenuCount}`
        );

        // Click the same menu trigger to close the dropdown.
        await menuTrigger.click();

        // Allow the closing animation to complete.
        await page.waitForTimeout(500);

        console.log(
            `Closed dropdown: ${menuName}`
        );
    }

    console.log('');
    console.log('======================================');
    console.log('DASHBOARD SANITY CHECK COMPLETED');
    console.log('Scroll Check: PASS');
    console.log('Menu Dropdown Check: PASS');
    console.log('======================================');

    
    // ==========================================
    // MONITORING DASHBOARD SANITY CHECK
    // ==========================================

    console.log('');
    console.log('Starting Monitoring Dashboard Sanity Check.');

    // Open the Advanced menu using the Kendo UI menu structure.
    const advancedMenuItem = page.locator(
        '#menu > li[aria-haspopup="true"]'
    ).filter({
        hasText: /^Advanced/i
    });

    const advancedMenuTrigger = advancedMenuItem.locator(
        ':scope > .k-link'
    );

    await expect(advancedMenuTrigger).toBeVisible();
    await expect(advancedMenuTrigger).toBeEnabled();

    await advancedMenuTrigger.click();

    // Allow the dropdown animation to complete.
    await page.waitForTimeout(700);

    console.log('Opened Advanced menu.');

    // Locate Monitoring Dashboard inside the Advanced dropdown.
    const monitoringDashboardLink = advancedMenuItem.locator(
        'a'
    ).filter({
        hasText: /^Monitoring Dashboard$/i
    });

    await expect(monitoringDashboardLink).toBeVisible({
        timeout: 10000
    });

    await monitoringDashboardLink.click();

    console.log('Navigated to Monitoring Dashboard.');

    // Verify navigation.
    await expect(page).toHaveURL(/\/monitoring\/dashboard/i);

    await page.waitForLoadState('domcontentloaded');

    await page.waitForTimeout(1500);


    // ==========================================
    // DEBUG LOG TAB
    // ==========================================

    console.log('');
    console.log('Opening Debug Log tab.');

    const debugLogTab = page.getByRole('tab', {
        name: 'Debug Log',
        exact: true
    });

    await expect(debugLogTab).toBeVisible();

    await debugLogTab.click();

    // Allow tab transition and UI rendering.
    await page.waitForTimeout(800);

    console.log('Debug Log tab opened.');

    // ==========================================
    // SET CURRENT DATE
    // ==========================================

    console.log('');
    console.log('Setting current date in date filters.');

    // Generate the current date in MM/DD/YYYY format.
    const currentDate = await page.evaluate(() => {
        const today = new Date();

        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const year = today.getFullYear();

        return `${month}/${day}/${year}`;
    });

    console.log(`Current date: ${currentDate}`);

    // Locate From Date and To Date fields.
    const fromDateInput = page.getByRole('combobox', {
        name: 'From Date'
    });

    const toDateInput = page.getByRole('combobox', {
        name: 'To Date'
    });

    // Verify the date fields are available.
    await expect(fromDateInput).toBeVisible();
    await expect(toDateInput).toBeVisible();

    // Set both dates to the current date.
    await fromDateInput.fill(currentDate);
    await fromDateInput.press('Tab');

    await page.waitForTimeout(1000);

    await toDateInput.fill(currentDate);
    await toDateInput.press('Tab');

    await page.waitForTimeout(1000);

    // Verify that the selected dates are correct.
    await expect(fromDateInput).toHaveValue(currentDate);
    await expect(toDateInput).toHaveValue(currentDate);

    console.log('From Date set successfully.');
    console.log('To Date set successfully.');

    // ==========================================
    // SEARCH DEBUG LOGS
    // ==========================================

    console.log('');
    console.log('Clicking Search.');

    const searchButton = page.getByRole('button', {
        name: 'Search',
        exact: true
    });

    await expect(searchButton).toBeVisible();
    await expect(searchButton).toBeEnabled();

    await searchButton.click();

    // Allow search request and results rendering.
    await page.waitForTimeout(1500);

    console.log('Monitoring Dashboard search completed.');

    await page.waitForTimeout(2000);

    console.log('');
    console.log('======================================');
    console.log('MONITORING DASHBOARD SANITY CHECK PASS');
    console.log('======================================');

    

    // ==========================================
    // MANAGE JOBS SEARCH SANITY CHECK
    // ==========================================

    console.log('');
    console.log('Starting Manage Jobs Search Sanity Check.');

    // Open Manage Employers menu.
    const manageEmployersMenu = page.locator(
        '#menu > li[aria-haspopup="true"]'
    ).filter({
        hasText: /^Manage Employers/
    });

    const manageEmployersTrigger = manageEmployersMenu.locator(
        ':scope > .k-link'
    );

    await expect(manageEmployersTrigger).toBeVisible();
    await manageEmployersTrigger.click();

    // Allow the Kendo dropdown animation to complete.
    await page.waitForTimeout(700);

    console.log('Opened Manage Employers menu.');

    // Navigate to Manage Jobs.
    const manageJobsLink = manageEmployersMenu.locator(
        'a[href="/Content/ManageJobs"]'
    );

    await expect(manageJobsLink).toBeVisible({
        timeout: 10000
    });

    await manageJobsLink.click();

    // Verify navigation to Manage Jobs.
    await expect(page).toHaveURL(/\/Content\/ManageJobs/i);

    await page.waitForLoadState('domcontentloaded');

    // Allow the page UI to initialize.
    await page.waitForTimeout(1500);

    console.log('Navigated to Manage Jobs.');

    // ==========================================
    // PERFORM JOB SEARCH
    // ==========================================

    console.log('');
    console.log('Starting Manage Jobs search.');

    const searchTerm = 'job';

    console.log(`Search term: ${searchTerm}`);

    // Locate Job Headline search field.
    const jobHeadlineInput = page.locator('#JobHeader');

    await expect(jobHeadlineInput).toBeVisible();
    await expect(jobHeadlineInput).toBeEnabled();

    // Fill the search field.
    await jobHeadlineInput.fill(searchTerm);

    // Allow the input interaction to settle.
    await page.waitForTimeout(500);

    // Locate Search button.
    const manageJobsSearchButton = page.locator('#BtnSearch');

    await expect(manageJobsSearchButton).toBeVisible();
    await expect(manageJobsSearchButton).toBeEnabled();

    // Click Search.
    await manageJobsSearchButton.click();

    console.log('Clicked Manage Jobs Search.');

    // Allow the search operation to begin.
    await page.waitForTimeout(1500);

    console.log('');
    console.log('======================================');
    console.log('MANAGE JOBS SEARCH SANITY CHECK PASS');
    console.log('======================================');

        
    // ==========================================
    // MANAGE CONTENT BLOCK SEARCH SANITY CHECK
    // ==========================================

    console.log('');
    console.log('Starting Manage Content Block Search Sanity Check.');

    // Open Manage Content menu.
    const manageContentMenu = page.locator(
        '#menu > li[aria-haspopup="true"]'
    ).filter({
        hasText: /^Manage Content/
    });

    const manageContentTrigger = manageContentMenu.locator(
        ':scope > .k-link'
    );

    await expect(manageContentTrigger).toBeVisible();
    await manageContentTrigger.click();

    // Allow the Kendo dropdown animation to complete.
    await page.waitForTimeout(700);

    console.log('Opened Manage Content menu.');

    // Navigate to Manage Content Blocks.
    const manageContentBlocksLink = manageContentMenu.locator(
        'a[href="/Content/ManageContentBlocks"]'
    );

    await expect(manageContentBlocksLink).toBeVisible({
        timeout: 10000
    });

    await manageContentBlocksLink.click();

    // Verify navigation.
    await expect(page).toHaveURL(
        /\/Content\/ManageContentBlocks/i
    );

    await page.waitForLoadState('domcontentloaded');

    // Allow the page UI to initialize.
    await page.waitForTimeout(1500);

    console.log('Navigated to Manage Content Blocks.');

    // ==========================================
    // PERFORM CONTENT BLOCK SEARCH
    // ==========================================

    console.log('');
    console.log('Starting Manage Content Block search.');

    const searchItem = 'Release';

    console.log(`Search item: ${searchItem}`);

    // Locate the Title input field.
const titleInput = page.locator(
    'input[type="text"]:visible'
).first();

    await expect(titleInput).toBeVisible();
    await expect(titleInput).toBeEnabled();

    // Fill the search field.
    await titleInput.fill(searchItem);

    // Allow the input interaction to settle.
    await page.waitForTimeout(500);

    // Locate Search button.
    const contentBlockSearchButton = page.getByRole('button', {
        name: 'Search',
        exact: true
    });

    await expect(contentBlockSearchButton).toBeVisible();
    await expect(contentBlockSearchButton).toBeEnabled();

    // Click Search.
    await contentBlockSearchButton.click();

    console.log('Clicked Manage Content Block Search.');

    // Allow the search operation to begin.
    await page.waitForTimeout(1500);

    console.log('');
    console.log('======================================');
    console.log('MANAGE CONTENT BLOCK SEARCH CHECK PASS');
    console.log('======================================');


});
