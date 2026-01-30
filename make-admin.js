// Make a user admin directly via Firestore emulator
// Run with: node make-admin.js <USER_UID>

const http = require('http');

const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;
const PROJECT_ID = 'sagereportdemoapp';

const USER_UID = process.argv[2];

if (!USER_UID) {
  console.log('Usage: node make-admin.js <USER_UID>');
  process.exit(1);
}

async function makeAdmin() {
  const updateData = {
    fields: {
      role: { stringValue: 'admin' }
    }
  };

  const options = {
    hostname: FIRESTORE_HOST,
    port: FIRESTORE_PORT,
    path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${USER_UID}?updateMask.fieldPaths=role`,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`Successfully made user ${USER_UID} an admin!`);
          resolve(JSON.parse(body));
        } else {
          console.log(`Error: ${res.statusCode}`);
          console.log(body);
          reject(new Error(body));
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(updateData));
    req.end();
  });
}

makeAdmin().catch(console.error);
