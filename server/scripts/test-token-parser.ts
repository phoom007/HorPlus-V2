import { extractTenantTokenFromUrl, extractLiffDestinationPath } from '../../src/utils/liffToken';

// Mock window.location
function testWithUrl(href: string, search: string, hash: string = '') {
  (global as any).window = {
    location: {
      href,
      search,
      hash
    }
  };
  return extractTenantTokenFromUrl();
}

function testDestWithUrl(href: string, search: string, hash: string = '') {
  (global as any).window = {
    location: {
      href,
      search,
      hash
    }
  };
  return extractLiffDestinationPath();
}

const cases = [
  { name: 'direct ?t=abc', href: 'https://app.local/?t=7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd', search: '?t=7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd' },
  { name: 'direct ?token=abc', href: 'https://app.local/?token=7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd', search: '?token=7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd' },
  { name: 'encoded ?t%3Dabc', href: 'https://app.local/?t%3D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd', search: '?t%3D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd' },
  { name: 'liff.state %3Ft%3Dabc', href: 'https://app.local/?liff.state=%3Ft%3D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd', search: '?liff.state=%3Ft%3D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd' },
  { name: 'liff.state /?t=abc', href: 'https://app.local/?liff.state=%2F%3Ft%3D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd', search: '?liff.state=%2F%3Ft%3D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd' },
  { name: 'liff.state /tenant?t=abc', href: 'https://app.local/?liff.state=%2Ftenant%3Ft%3D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd', search: '?liff.state=%2Ftenant%3Ft%3D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd' },
  { name: 'liff.state double-encoded', href: 'https://app.local/?liff.state=%253Ft%253D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd', search: '?liff.state=%253Ft%253D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd' },
  { name: 'hash route #/?liff.state=...', href: 'https://app.local/#/?liff.state=%3Ft%3D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd', search: '', hash: '#/?liff.state=%3Ft%3D7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd' },
  { name: 'raw href fallback', href: 'https://app.local/tenant?t=7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd', search: '', hash: '' }
];

let allPassed = true;
const expected = '7e954798c726db2e4927e0d5e48a773a19930912fa7ab183965e90965fac58fd';
for (const c of cases) {
  const result = testWithUrl(c.href, c.search, c.hash);
  const ok = result === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${c.name}: ${result}`);
  if (!ok) allPassed = false;
}

const destCases = [
  { name: 'dest /tenant', search: '?liff.state=%2Ftenant', expected: '/tenant' },
  { name: 'dest /tenant?t=123', search: '?liff.state=%2Ftenant%3Ft%3D123', expected: '/tenant?t=123' },
  { name: 'dest /owner/home', search: '?liff.state=%2Fowner%2Fhome', expected: '/owner/home' },
  { name: 'dest /api/v1/auth/line-direct-entry?ticket=abc', search: '?liff.state=%2Fapi%2Fv1%2Fauth%2Fline-direct-entry%3Fticket%3Dabc', expected: '/api/v1/auth/line-direct-entry?ticket=abc' },
  { name: 'dest ?t=123', search: '?liff.state=%3Ft%3D123', expected: '/tenant?t=123' },
];

for (const dc of destCases) {
  const result = testDestWithUrl('https://app.local/' + dc.search, dc.search);
  const ok = result === dc.expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${dc.name}: ${result} (expected: ${dc.expected})`);
  if (!ok) allPassed = false;
}

if (!allPassed) {
  console.error('Some tests failed!');
  process.exit(1);
} else {
  console.log('ALL PASSED!');
  process.exit(0);
}
