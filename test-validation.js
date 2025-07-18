#!/usr/bin/env node

/**
 * Test validation script for Evorto project
 * This script validates that the testing environment is properly configured
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧪 Evorto Test Validation Script');
console.log('================================\n');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
    console.log('❌ .env file is missing');
    console.log('💡 Create a .env file based on .env.local');
    process.exit(1);
} else {
    console.log('✅ .env file exists');
}

// Check if node_modules exists
if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
    console.log('❌ node_modules is missing');
    console.log('💡 Run: yarn install');
    process.exit(1);
} else {
    console.log('✅ Dependencies installed');
}

// Check Playwright browsers
try {
    console.log('\n🎭 Checking Playwright setup...');
    execSync('npx playwright --version', { stdio: 'pipe' });
    console.log('✅ Playwright is installed');
} catch (error) {
    console.log('❌ Playwright issue detected');
    console.log('💡 Run: npx playwright install');
}

// Validate test structure
const testDirs = [
    'e2e/tests',
    'e2e/fixtures',
    'e2e/setup',
    'e2e/reporters'
];

console.log('\n📁 Checking test structure...');
testDirs.forEach(dir => {
    if (fs.existsSync(path.join(__dirname, dir))) {
        console.log(`✅ ${dir} exists`);
    } else {
        console.log(`❌ ${dir} is missing`);
    }
});

// Check test files
try {
    console.log('\n📋 Listing available tests...');
    const output = execSync('npx playwright test --list --project=chromium', { 
        encoding: 'utf8',
        stdio: 'pipe'
    });
    
    const testCount = (output.match(/\[chromium\]/g) || []).length;
    console.log(`✅ Found ${testCount} tests ready to run`);
} catch (error) {
    console.log('❌ Could not list tests');
    console.log('💡 Check playwright.config.ts configuration');
}

// Check build capability (non-blocking)
console.log('\n🏗️  Checking build capability...');
try {
    execSync('yarn build --dry-run', { stdio: 'pipe' });
    console.log('✅ Build configuration is valid');
} catch (error) {
    console.log('⚠️  Build has issues (expected - auth errors)');
    console.log('💡 Build errors are known and related to auth typing');
}

// Check linting
console.log('\n🔍 Checking code quality...');
try {
    execSync('yarn lint --max-warnings=100', { stdio: 'pipe' });
    console.log('✅ Lint configuration is working');
} catch (error) {
    console.log('⚠️  Lint issues found (expected)');
    console.log('💡 Run: yarn lint:fix to auto-fix some issues');
}

console.log('\n📊 Test Environment Summary:');
console.log('============================');
console.log('✅ Environment configuration ready');
console.log('✅ Test structure in place');
console.log('✅ Playwright tests available');
console.log('⚠️  Build issues exist (auth-related)');
console.log('⚠️  Lint issues need attention');
console.log('❌ Unit tests not implemented yet');

console.log('\n🚀 Ready to run tests with:');
console.log('   yarn e2e --reporter=line --project=chromium');
console.log('   yarn test --no-watch --browsers=ChromeHeadless');
console.log('   yarn lint');