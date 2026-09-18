import { generateSigningKeypair } from '@agentos/auth';

const kp = generateSigningKeypair();
console.log('POLICY_SIGNING_PRIVATE_KEY_PEM=' + JSON.stringify(kp.privateKeyPem));
console.log('POLICY_SIGNING_PUBLIC_KEY_PEM=' + JSON.stringify(kp.publicKeyPem));