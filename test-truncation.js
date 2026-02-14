#!/usr/bin/env node
import { peel } from './dist/index.js';

console.log('Testing token budget truncation with a larger page...\n');

try {
  // Test with Wikipedia (large page)
  const result = await peel('https://en.wikipedia.org/wiki/Web_scraping', {
    maxTokens: 500,
  });
  
  console.log(`✅ Test passed`);
  console.log(`   Title: ${result.title}`);
  console.log(`   Tokens: ${result.tokens}`);
  console.log(`   Content length: ${result.content.length} chars`);
  console.log(`   Contains truncation notice: ${result.content.includes('[Content truncated')}`);
  
  // Show last 200 chars to verify truncation notice is there
  console.log(`\n   Last 200 chars:\n   ${result.content.slice(-200)}`);
} catch (err) {
  console.log('❌ Test failed:', err.message);
}
