#!/usr/bin/env node
/**
 * Manual test for new features
 */

import { peel } from './dist/index.js';

console.log('Testing new WebPeel features...\n');

// Test 1: Page actions
console.log('1. Testing page actions (scroll)...');
try {
  const result1 = await peel('https://example.com', {
    actions: [
      { type: 'wait', ms: 500 },
      { type: 'scroll', to: 'bottom' },
    ],
  });
  console.log('✅ Actions test passed');
  console.log(`   Method: ${result1.method}`);
  console.log(`   Title: ${result1.title}`);
} catch (err) {
  console.log('❌ Actions test failed:', err.message);
}

// Test 2: Structured extraction with selectors
console.log('\n2. Testing structured extraction with CSS selectors...');
try {
  const result2 = await peel('https://example.com', {
    extract: {
      selectors: {
        title: 'h1',
        paragraph: 'p',
      },
    },
  });
  console.log('✅ Extraction test passed');
  console.log('   Extracted:', JSON.stringify(result2.extracted, null, 2));
} catch (err) {
  console.log('❌ Extraction test failed:', err.message);
}

// Test 3: Token budget truncation
console.log('\n3. Testing token budget truncation...');
try {
  const result3 = await peel('https://example.com', {
    maxTokens: 100,
  });
  console.log('✅ Truncation test passed');
  console.log(`   Tokens: ${result3.tokens}`);
  console.log(`   Content length: ${result3.content.length} chars`);
  console.log(`   Contains truncation notice: ${result3.content.includes('[Content truncated')}`);
} catch (err) {
  console.log('❌ Truncation test failed:', err.message);
}

// Test 4: Combined features
console.log('\n4. Testing combined features (actions + extract + maxTokens)...');
try {
  const result4 = await peel('https://example.com', {
    actions: [{ type: 'wait', ms: 200 }],
    extract: {
      selectors: {
        heading: 'h1',
      },
    },
    maxTokens: 150,
  });
  console.log('✅ Combined test passed');
  console.log(`   Method: ${result4.method}`);
  console.log(`   Extracted: ${JSON.stringify(result4.extracted)}`);
  console.log(`   Tokens: ${result4.tokens}`);
} catch (err) {
  console.log('❌ Combined test failed:', err.message);
}

console.log('\n✨ Feature testing complete!');
process.exit(0);
