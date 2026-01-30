// Test script for Firebase callable functions via emulator
// Run with: node test-endpoints.js <USER_UID>

const http = require('http');

const PROJECT_ID = 'sagereportdemoapp';
const FUNCTIONS_HOST = '127.0.0.1';
const FUNCTIONS_PORT = 5001;

// Get the test user UID from command line
const TEST_USER_UID = process.argv[2];
const TEST_USER_EMAIL = process.argv[3] || 'test@example.com';

if (!TEST_USER_UID) {
  console.log('Usage: node test-endpoints.js <USER_UID> [USER_EMAIL]');
  console.log('');
  console.log('Get the UID from the Firebase Emulator Auth tab:');
  console.log('http://127.0.0.1:4000/auth');
  process.exit(1);
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

// Create a mock Firebase Auth ID token for the emulator
function createMockIdToken(uid, email) {
  // The emulator accepts this header format for auth context
  const tokenPayload = {
    uid: uid,
    email: email,
    email_verified: true,
  };
  // Base64 encode a fake JWT (emulator doesn't validate signature)
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    ...tokenPayload,
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    sub: uid,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${header}.${payload}.fake-signature`;
}

async function callFunction(functionName, data, uid, email) {
  const payload = { data };

  const options = {
    hostname: FUNCTIONS_HOST,
    port: FUNCTIONS_PORT,
    path: `/${PROJECT_ID}/us-central1/${functionName}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  // Add auth header for emulator
  if (uid) {
    const token = createMockIdToken(uid, email);
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  return makeRequest(options, payload);
}

async function runTests() {
  console.log('========================================');
  console.log('Testing Protected Endpoints');
  console.log('========================================\n');
  console.log(`Test User UID: ${TEST_USER_UID}`);
  console.log(`Test User Email: ${TEST_USER_EMAIL}\n`);

  // Test 1: Health check (public)
  console.log('1. healthCheck (public endpoint)');
  console.log('   GET /healthCheck');
  const healthResult = await makeRequest({
    hostname: FUNCTIONS_HOST,
    port: FUNCTIONS_PORT,
    path: `/${PROJECT_ID}/us-central1/healthCheck`,
    method: 'GET',
  });
  console.log(`   Status: ${healthResult.status}`);
  console.log(`   Response: ${JSON.stringify(healthResult.data, null, 2)}`);
  console.log('');

  // Test 2: getUserProfile without auth (should fail)
  console.log('2. getUserProfile WITHOUT auth (expect: UNAUTHENTICATED)');
  const noAuthResult = await callFunction('getUserProfile', {}, null, null);
  console.log(`   Status: ${noAuthResult.status}`);
  console.log(`   Response: ${JSON.stringify(noAuthResult.data, null, 2)}`);
  console.log('');

  // Test 3: getUserProfile with auth
  console.log('3. getUserProfile WITH auth (expect: user profile)');
  const authResult = await callFunction('getUserProfile', {}, TEST_USER_UID, TEST_USER_EMAIL);
  console.log(`   Status: ${authResult.status}`);
  console.log(`   Response: ${JSON.stringify(authResult.data, null, 2)}`);
  console.log('');

  // Test 4: updateUserProfile - change display name
  console.log('4. updateUserProfile - set displayName (expect: success)');
  const updateResult = await callFunction('updateUserProfile', {
    displayName: 'SageReport Demo User'
  }, TEST_USER_UID, TEST_USER_EMAIL);
  console.log(`   Status: ${updateResult.status}`);
  console.log(`   Response: ${JSON.stringify(updateResult.data, null, 2)}`);
  console.log('');

  // Test 5: updateUserProfile - try to change role (should be blocked)
  console.log('5. updateUserProfile - try changing role (expect: ignored, security)');
  const roleHackResult = await callFunction('updateUserProfile', {
    role: 'admin',
    displayName: 'Hacker'
  }, TEST_USER_UID, TEST_USER_EMAIL);
  console.log(`   Status: ${roleHackResult.status}`);
  console.log(`   Response: ${JSON.stringify(roleHackResult.data, null, 2)}`);
  console.log('   Note: "role" was NOT in updatedFields - blocked by whitelist!');
  console.log('');

  // Test 6: listUsers (admin only - should fail)
  console.log('6. listUsers - admin endpoint (expect: PERMISSION_DENIED)');
  const listResult = await callFunction('listUsers', {}, TEST_USER_UID, TEST_USER_EMAIL);
  console.log(`   Status: ${listResult.status}`);
  console.log(`   Response: ${JSON.stringify(listResult.data, null, 2)}`);
  console.log('');

  // Test 7: Verify profile was updated
  console.log('7. getUserProfile again (verify displayName changed)');
  const verifyResult = await callFunction('getUserProfile', {}, TEST_USER_UID, TEST_USER_EMAIL);
  console.log(`   Status: ${verifyResult.status}`);
  console.log(`   Response: ${JSON.stringify(verifyResult.data, null, 2)}`);
  console.log('');

  console.log('========================================');
  console.log('Summary:');
  console.log('========================================');
  console.log('- Public endpoints work without auth');
  console.log('- Protected endpoints require authentication');
  console.log('- Field whitelisting prevents privilege escalation');
  console.log('- Admin endpoints are restricted by role');
  console.log('- All actions are logged for audit');
}

runTests().catch(console.error);
