/**
 * Test script for page segment classifier
 * 
 * Run with: node --experimental-modules test-page-segment.js
 * Or use a test runner that supports ES modules
 */

// Import the classifier (ES modules)
import { classifyPageSegment, PageSegment } from './api/aigeo/pageSegment.js';

// Test cases derived from 06-site-urls.csv
const testCases = [
  // Education
  { url: 'https://www.alanranger.com/blog-on-photography/', expected: PageSegment.EDUCATION },
  { url: 'https://www.alanranger.com/blog-on-photography/some-post', expected: PageSegment.EDUCATION },
  { url: 'https://www.alanranger.com/free-online-photography-course', expected: PageSegment.EDUCATION },
  { url: 'https://www.alanranger.com/outdoor-photography-exposure-calculator', expected: PageSegment.EDUCATION },
  { url: 'https://www.alanranger.com/free-photography-tips', expected: PageSegment.EDUCATION },
  
  // Money - exact matches
  { url: 'https://www.alanranger.com/photography-workshops', expected: PageSegment.MONEY },
  { url: 'https://www.alanranger.com/photography-workshops-near-me', expected: PageSegment.MONEY },
  { url: 'https://www.alanranger.com/batsford-arboretum-photography', expected: PageSegment.MONEY },
  { url: 'https://www.alanranger.com/bluebell-woods-near-me', expected: PageSegment.MONEY },
  { url: 'https://www.alanranger.com/fine-art-prints', expected: PageSegment.SYSTEM }, // Fine-art pages are portfolio/info, not money
  
  // Money - keyword matches
  { url: 'https://www.alanranger.com/photography-courses-coventry', expected: PageSegment.MONEY },
  { url: 'https://www.alanranger.com/photography-gift-vouchers', expected: PageSegment.MONEY },
  { url: 'https://www.alanranger.com/photography-academy', expected: PageSegment.MONEY },
  
  // Support
  { url: 'https://www.alanranger.com/', expected: PageSegment.SUPPORT },
  { url: 'https://www.alanranger.com/about-alan-ranger', expected: PageSegment.SUPPORT },
  { url: 'https://www.alanranger.com/testimonials-customer-reviews', expected: PageSegment.SUPPORT },
  { url: 'https://www.alanranger.com/contact-us', expected: PageSegment.SUPPORT },
  
  // System (everything else)
  { url: 'https://www.alanranger.com/terms', expected: PageSegment.SYSTEM },
  { url: 'https://www.alanranger.com/privacy', expected: PageSegment.SYSTEM },
  { url: 'https://www.alanranger.com/sitemap', expected: PageSegment.SYSTEM },
  { url: 'https://www.alanranger.com/some-random-page', expected: PageSegment.SYSTEM },
  
  // Test with paths only (no full URL)
  { url: '/blog-on-photography/', expected: PageSegment.EDUCATION },
  { url: '/photography-workshops', expected: PageSegment.MONEY },
  { url: '/about-alan-ranger', expected: PageSegment.SUPPORT },
];

console.log('Testing page segment classifier...\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  const result = classifyPageSegment(test.url);
  const success = result === test.expected;
  
  if (success) {
    passed++;
    console.log(`✓ Test ${index + 1}: ${test.url} → ${result}`);
  } else {
    failed++;
    console.error(`✗ Test ${index + 1}: ${test.url} → ${result} (expected ${test.expected})`);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.error('❌ Some tests failed');
  process.exit(1);
}

