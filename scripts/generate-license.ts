/**
 * License Key Generator (Development Only)
 * ========================================
 * This script generates test license keys for development.
 * 
 * NEVER USE IN PRODUCTION - Keep private key secure on your licensing server.
 * 
 * Usage: npx ts-node scripts/generate-license.ts
 * npx tsx scripts/generate-license.ts
 */

import crypto from 'crypto';
import { LicensePayload } from '../src/shared/types';

// ===========================================
// TEST RSA KEY PAIR
// ===========================================
// WARNING: These are TEST KEYS for development only!
// Generate your own keys for production:
//   openssl genrsa -out private.pem 2048
//   openssl rsa -in private.pem -pubout -out public.pem

const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAyabjEHTLPaUf/vbaPQV00oeHxWsc4QptA2rF/Agt5qoRYQOk
MUBYoyQhwR3W4797M5XtD7FC39Oj4BLjf3ucqgQwXeeF7zxV9iqimFSAlqef+Lf7
aWA+Ykaw0y/n109Mr0uXRVtLAZpdzEtpmdj3Y94aOG1oanNYFXPNECgcfmR0xBQy
Z8sJyFQS7IttTmfn0XhYWGMDazIydyHjuX4bkosf58QH8Ck+Uge4rKwQkCBUyuqM
+5HW+IQnODeoKkrAfRl2dAO+3lqpEOs+FYaObBB4cz9gp9CI/7n1hkrW8lKmRcJe
eSITgNrIbSetjcCxo+wIIVOPVF3T1YPWiOR7uQIDAQABAoIBADHXaH8sRwHdGvvz
eryjaR0SN6pBj9lFsO0rynTBdsrxFSuT8VTlESN9rkQjwnX3YZW+BGKhDyTwlCwx
rv5XCMFzGJtVOuMHWD3oiti45jGWi/E3VFJW4gR7cYA5coXiyVL4jZKsfm0OgQma
SCcpG/iYsIVq8WiCSu6+eRx5tZU9gZNptVlDukiXzDxVg0BTQrPkJRerOMRxTC+J
GOPQGtFXJ9+Jqw7WQVCyhbVNWejHKnQW5LOjvioZBJDiQLko1zl1w29p9T3J7i0n
/aYYU5O3LHZOWRtwQjGtCp7mkwxi5YHzXqs3bFu/VkMp1OSUbnm7PCCHzvxt1/w7
pQghZ3MCgYEA82quz6zuaF4dg/6Hi7Ut0FXgmcrhtTNte/1UElWIchQKhdKu0cXA
KEmGRq2tj8SxNvY7nV34Uj6q3jOJtfofW1jpnZuUN8Er1bHeKtqVcdcDna+nx7Qu
kYOHpBn54/xkQ05puC0hr8QkDjq7JqOPXKg+mjKRPGJR9VTswxQdwH8CgYEA1BN/
p9M8+nsVILgMeCY8wRaTkIDHKPERiJ+SJr+5qQ923wYhtgLxcKNOx4WWYCRGUKTx
LG/A24gWU0jUMqFNCyIZ2YGkY7WT2E8D7X87JHe85ElF0kajFjN8oaEE7NBFc76W
oXeojt0HnJigYPqXkRU4n/Kp5hWRgjC5EOpPp8cCgYBJP1wVQDuJinClTI1rO/zq
ST1J6iQbS7txaRzIW5awhVlZRbm3hCM7vEw8rnyg25ZcLKJpy2IzFYqDTMzuxrJy
4YGDHNLwKB/RsTFigd4goIwFAluhm5W70fGaLvrkYQmmu0zS0Dnn00TqR0AT83nr
bvFPo1HS8t8ozQJl/YKqbwKBgCEdHkydHiNaPpVKR6AnEEtx8/6XLQHGil9T0yU7
wIiWQpBWS8M4uGxHA5EB2dYPM+95obK3jFx65kmA0KlLKFV5sKGWrY1oF7qps8pM
mHZ8P8FBc6Z+ow5fYbF3C+bSKlYFR03U+ju8ZWjdKAWcezgLITlQUZj8eyjh5LOw
clmXAoGAFxQgkbgSK+fk+UfsW1xZb4NtS4UpggM2mi2xzarC8z+dFUIYkaVm5hJS
0TjyToodLPARdDGsyiAu9k4uaF5tXE+FZipQ3XHFI1M+3ESrNk85oX8UUVzgelNe
Hm/b7Omf56HLyJkREr3KL/dd5BrsYNtcQ9zaBqYX8znUJsqAXjM=
-----END RSA PRIVATE KEY-----`;

// ===========================================
// LICENSE GENERATOR
// ===========================================

function generateLicense(
  payload: Omit<LicensePayload, 'issuedAt'>,
  privateKey: string
): string {
  const fullPayload: LicensePayload = {
    ...payload,
    issuedAt: new Date().toISOString(),
  };

  const payloadJson = JSON.stringify(fullPayload);
  const payloadBase64 = Buffer.from(payloadJson).toString('base64');

  const signer = crypto.createSign('SHA256');
  signer.update(payloadBase64);
  signer.end();

  const signature = signer.sign(privateKey, 'base64');

  return `${payloadBase64}.${signature}`;
}

// ===========================================
// GENERATE SAMPLE LICENSES
// ===========================================

// Full license - 1 year
const fullLicense = generateLicense(
  {
    customerId: 'cust_demo_001',
    customerName: 'Demo Company',
    licenseType: 'full',
    expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    featureFlags: {
      canExport: true,
      canBackup: true,
      canImport: true,
    },
  },
  TEST_PRIVATE_KEY
);

// Trial license - 30 days
const trialLicense = generateLicense(
  {
    customerId: 'cust_trial_001',
    customerName: 'Trial User',
    licenseType: 'trial',
    expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    featureFlags: {
      canExport: true,
      canBackup: false,
      canImport: true,
      maxEntries: 1000,
    },
  },
  TEST_PRIVATE_KEY
);

// Expired license (for testing)
const expiredLicense = generateLicense(
  {
    customerId: 'cust_expired_001',
    customerName: 'Expired User',
    licenseType: 'full',
    expirationDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
    featureFlags: {
      canExport: true,
      canBackup: true,
      canImport: true,
    },
  },
  TEST_PRIVATE_KEY
);

console.log('='.repeat(60));
console.log('GESTION DES ARRIVAGES - Test License Keys');
console.log('='.repeat(60));
console.log('\n⚠️  DEVELOPMENT USE ONLY - DO NOT USE IN PRODUCTION\n');

// Self-test: verify the signature works
console.log('🔒 Self-test: Verifying signature...');
const [testPayload, testSignature] = fullLicense.split('.');
const verifier = crypto.createVerify('SHA256');
verifier.update(testPayload);
verifier.end();

const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyabjEHTLPaUf/vbaPQV0
0oeHxWsc4QptA2rF/Agt5qoRYQOkMUBYoyQhwR3W4797M5XtD7FC39Oj4BLjf3uc
qgQwXeeF7zxV9iqimFSAlqef+Lf7aWA+Ykaw0y/n109Mr0uXRVtLAZpdzEtpmdj3
Y94aOG1oanNYFXPNECgcfmR0xBQyZ8sJyFQS7IttTmfn0XhYWGMDazIydyHjuX4b
kosf58QH8Ck+Uge4rKwQkCBUyuqM+5HW+IQnODeoKkrAfRl2dAO+3lqpEOs+FYaO
bBB4cz9gp9CI/7n1hkrW8lKmRcJeeSITgNrIbSetjcCxo+wIIVOPVF3T1YPWiOR7
uQIDAQAB
-----END PUBLIC KEY-----`;

const isValid = verifier.verify(TEST_PUBLIC_KEY, testSignature, 'base64');
console.log('✅ Signature verification:', isValid ? 'PASSED' : 'FAILED');
console.log('');

console.log('📋 FULL LICENSE (1 year):');
console.log('-'.repeat(40));
console.log(fullLicense);
console.log('\n');

console.log('📋 TRIAL LICENSE (30 days):');
console.log('-'.repeat(40));
console.log(trialLicense);
console.log('\n');

console.log('📋 EXPIRED LICENSE (for testing):');
console.log('-'.repeat(40));
console.log(expiredLicense);
console.log('\n');

console.log('='.repeat(60));
console.log('Copy one of the above keys and paste it in the app\'s');
console.log('license activation dialog to test.');
console.log('='.repeat(60));
