import { generateSigningKeypair } from '@agentos/auth';

let cached: { privateKeyPem: string; publicKeyPem: string } | null = null;

/**
 * Policy signing key. In production set POLICY_SIGNING_PRIVATE_KEY_PEM /
 * POLICY_SIGNING_PUBLIC_KEY_PEM. In dev, an ephemeral keypair is generated once
 * per boot and the public key logged so the treasury can be pointed at it.
 */
export function getPolicySigningKey(config: NodeJS.ProcessEnv): { privateKeyPem: string; publicKeyPem: string } {
  if (cached) return cached;
  const configured = config.POLICY_SIGNING_PRIVATE_KEY_PEM?.replaceAll('\\n', '\n');
  if (configured) {
    cached = {
      privateKeyPem: configured,
      publicKeyPem: (config.POLICY_SIGNING_PUBLIC_KEY_PEM ?? '').replaceAll('\\n', '\n'),
    };
    return cached;
  }
  const kp = generateSigningKeypair();
  cached = kp;
  console.warn('[policy] DEV signing key generated — set POLICY_SIGNING_PUBLIC_KEY_PEM on treasury to:\n' + kp.publicKeyPem);
  return cached;
}