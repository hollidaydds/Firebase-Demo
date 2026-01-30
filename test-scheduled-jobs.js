// Test scheduled jobs (webjobs)
// Run with: node test-scheduled-jobs.js <USER_UID> [USER_EMAIL]

const http = require('http');

const PROJECT_ID = 'sagereportdemoapp';
const FUNCTIONS_HOST = '127.0.0.1';
const FUNCTIONS_PORT = 5001;

const TEST_USER_UID = process.argv[2];
const TEST_USER_EMAIL = process.argv[3] || 'test@example.com';

if (!TEST_USER_UID) {
  console.log('Usage: node test-scheduled-jobs.js <USER_UID> [USER_EMAIL]');
  process.exit(1);
}

function createMockIdToken(uid, email) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    uid, email, email_verified: true,
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    sub: uid,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${header}.${payload}.fake-signature`;
}

function makeRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function callFunction(functionName, data, uid, email) {
  const options = {
    hostname: FUNCTIONS_HOST,
    port: FUNCTIONS_PORT,
    path: `/${PROJECT_ID}/us-central1/${functionName}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${createMockIdToken(uid, email)}`,
    }
  };
  return makeRequest(options, { data });
}

async function runTests() {
  console.log('========================================');
  console.log('Testing Scheduled Jobs (Webjobs)');
  console.log('========================================\n');
  console.log(`Admin UID: ${TEST_USER_UID}\n`);

  // Test 1: Run daily user report
  console.log('1. Running dailyUserReport job...');
  const reportResult = await callFunction('runScheduledJob', { jobName: 'dailyUserReport' }, TEST_USER_UID, TEST_USER_EMAIL);
  console.log(`   Status: ${reportResult.status}`);
  console.log(`   Response: ${JSON.stringify(reportResult.data, null, 2)}`);
  console.log('');

  // Test 2: Run hourly metrics
  console.log('2. Running hourlyMetrics job...');
  const metricsResult = await callFunction('runScheduledJob', { jobName: 'hourlyMetrics' }, TEST_USER_UID, TEST_USER_EMAIL);
  console.log(`   Status: ${metricsResult.status}`);
  console.log(`   Response: ${JSON.stringify(metricsResult.data, null, 2)}`);
  console.log('');

  // Test 3: Now test admin-only listUsers (should work now)
  console.log('3. Testing listUsers (should work now as admin)...');
  const listResult = await callFunction('listUsers', {}, TEST_USER_UID, TEST_USER_EMAIL);
  console.log(`   Status: ${listResult.status}`);
  console.log(`   Response: ${JSON.stringify(listResult.data, null, 2)}`);
  console.log('');

  console.log('========================================');
  console.log('Check Firestore for:');
  console.log('========================================');
  console.log('- reports collection: daily report document');
  console.log('- metrics collection: hourly metrics document');
  console.log('');
  console.log('These demonstrate:');
  console.log('- Automated data aggregation');
  console.log('- Scheduled reporting');
  console.log('- Admin-only manual triggers');
  console.log('- Audit trail (triggeredBy field)');
}

runTests().catch(console.error);
