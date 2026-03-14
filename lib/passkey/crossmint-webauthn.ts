/**
 * WebAuthn Passkey Implementation for Agents Portal
 *
 * Desktop-optimized WebAuthn for agents.lumenbro.com
 */

import { xdr, Address } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

/**
 * Get appropriate RP ID for current environment
 */
export function getRpId(): string {
  const { getWebAuthnRpId } = require('./webauthn-rpid');
  return getWebAuthnRpId();
}

// secp256r1 curve order N
const SECP256R1_N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const SECP256R1_HALF_N = SECP256R1_N / 2n;

function bufferToBigInt(buf: Buffer): bigint {
  return BigInt('0x' + buf.toString('hex'));
}

function bigIntToBuffer32(n: bigint): Buffer {
  const hex = n.toString(16).padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

/**
 * Convert ECDSA ASN.1 DER signature to compact 64-byte format with low-S normalization.
 * Soroban's verify_sig_ecdsa_secp256r1 requires low-S (BIP-62 / RFC 6979).
 */
export function convertEcdsaSignatureAsnToCompact(derSignature: Buffer): Buffer {
  // ASN.1 DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  let offset = 0;

  if (derSignature[offset++] !== 0x30) {
    throw new Error('Invalid DER signature: missing SEQUENCE tag');
  }

  // Skip total length (may be 1 or 2 bytes)
  const totalLen = derSignature[offset++];
  if (totalLen & 0x80) {
    offset += totalLen & 0x7f; // Multi-byte length
  }

  // Read R
  if (derSignature[offset++] !== 0x02) {
    throw new Error('Invalid DER signature: missing INTEGER tag for R');
  }
  const rLen = derSignature[offset++];
  let r = derSignature.subarray(offset, offset + rLen);
  offset += rLen;

  // Read S
  if (derSignature[offset++] !== 0x02) {
    throw new Error('Invalid DER signature: missing INTEGER tag for S');
  }
  const sLen = derSignature[offset++];
  let s = derSignature.subarray(offset, offset + sLen);

  // Remove leading zero padding (ASN.1 uses it for positive integers)
  if (r.length === 33 && r[0] === 0x00) r = r.subarray(1);
  if (s.length === 33 && s[0] === 0x00) s = s.subarray(1);

  // Pad to 32 bytes
  const rPadded = Buffer.alloc(32);
  r.copy(rPadded, 32 - r.length);

  const sPadded = Buffer.alloc(32);
  s.copy(sPadded, 32 - s.length);

  // Normalize S to low form (required by Soroban verify_sig_ecdsa_secp256r1)
  const sBigInt = bufferToBigInt(sPadded);
  const sNormalized = sBigInt > SECP256R1_HALF_N
    ? bigIntToBuffer32(SECP256R1_N - sBigInt)
    : sPadded;

  return Buffer.concat([rPadded, sNormalized]);
}

/**
 * Register a new passkey (WebAuthn credential)
 *
 * @param userName - Display name for the passkey
 * @param rpName - Relying party name
 * @param options.email - Email for deterministic user.id (prevents duplicate registrations)
 * @param options.excludeCredentialIds - Existing credential IDs to prevent re-registration
 */
export async function registerPasskey(
  userName: string,
  rpName: string = 'LumenBro Agents',
  options?: {
    email?: string;
    excludeCredentialIds?: string[];
  }
): Promise<{
  credentialId: string; // base64url encoded
  publicKey: string; // base64 encoded (65 bytes uncompressed)
}> {
  console.log('[Passkey] Registering secp256r1 passkey...');

  const rpId = getRpId();

  if (typeof window === 'undefined' || typeof window.PublicKeyCredential === 'undefined') {
    throw new Error('WebAuthn is not available in this browser.');
  }

  // Use email for deterministic user.id so the same email always maps to
  // the same WebAuthn user — browser/authenticator will block duplicates
  const userIdInput = options?.email
    ? options.email.trim().toLowerCase()
    : `${userName}-${Date.now()}`;
  const userIdHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userIdInput));
  const userId = new Uint8Array(userIdHash).slice(0, 16);

  // Build excludeCredentials to prevent re-registration on same device
  const base64url = (await import('base64url')).default;
  const excludeCredentials: PublicKeyCredentialDescriptor[] = (options?.excludeCredentialIds || []).map(id => ({
    type: 'public-key' as const,
    id: Uint8Array.from(base64url.toBuffer(id)),
    transports: ['internal' as const],
  }));

  let credential: any;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: {
          name: rpName,
          id: rpId,
        },
        user: {
          id: userId,
          name: options?.email || userName,
          displayName: userName,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256 (secp256r1)
          { alg: -257, type: 'public-key' }, // RS256 fallback
        ],
        excludeCredentials,
        authenticatorSelection: {
          userVerification: 'required',
          residentKey: 'required',
          requireResidentKey: true,
          authenticatorAttachment: 'platform',
        },
        timeout: 60000,
        attestation: 'none',
      },
    }) as any;
  } catch (error: any) {
    if (error.name === 'NotSupportedError') {
      throw new Error('Your device or browser does not support passkeys.');
    } else if (error.name === 'NotAllowedError') {
      throw new Error('Passkey registration was cancelled. Please try again.');
    } else if (error.name === 'InvalidStateError') {
      throw new Error('A wallet already exists for this email. Use "Sign in with passkey" instead.');
    }
    throw error;
  }

  if (!credential) {
    throw new Error('Passkey registration cancelled');
  }

  const credentialId = base64url.encode(Buffer.from(credential.rawId));

  const response = credential.response as any;
  const attestationObject = Buffer.from(response.attestationObject);

  const cbor = await import('cbor');
  const attestation = cbor.decode(attestationObject);
  const authData = attestation.authData;

  const credentialIdLength = (authData[53] << 8) | authData[54];
  const publicKeyStart = 55 + credentialIdLength;
  let publicKeyUncompressed: Buffer | null = null;

  try {
    const publicKeyCBOR = cbor.decode(authData.slice(publicKeyStart));

    const coseGet = (key: number) => {
      if (typeof publicKeyCBOR?.get === 'function') {
        return publicKeyCBOR.get(key);
      }
      return publicKeyCBOR?.[key];
    };

    const x = Buffer.from(coseGet(-2));
    const y = Buffer.from(coseGet(-3));

    publicKeyUncompressed = Buffer.concat([Buffer.from([0x04]), x, y]);
  } catch (error) {
    if ((credential.response as any)?.getPublicKey) {
      const fallbackKey = (credential.response as any).getPublicKey();
      if (fallbackKey) publicKeyUncompressed = Buffer.from(fallbackKey);
    }
  }

  if (!publicKeyUncompressed) {
    throw new Error('Unable to extract passkey public key');
  }

  return {
    credentialId,
    publicKey: publicKeyUncompressed.toString('base64'),
  };
}

/**
 * Sign an auth entry with a passkey (WebAuthn)
 */
export async function signWithPasskey(
  authEntry: xdr.SorobanAuthorizationEntry,
  credentialId: string,
  networkPassphrase: string,
  latestLedger: number
): Promise<xdr.SorobanAuthorizationEntry> {
  console.log('[Passkey] Signing with secp256r1...');

  const base64url = (await import('base64url')).default;

  const networkIdHash = (await import('@stellar/stellar-sdk')).hash(
    Buffer.from(networkPassphrase, 'utf-8')
  );

  const nonceValue = authEntry.credentials().address().nonce();
  const authNonce = xdr.Int64.fromString(nonceValue.toString());
  const signatureExpirationLedger = latestLedger + 100;

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: networkIdHash,
      nonce: authNonce,
      signatureExpirationLedger,
      invocation: authEntry.rootInvocation(),
    })
  );

  const authHash = (await import('@stellar/stellar-sdk')).hash(preimage.toXDR());

  const rpId = getRpId();

  let credential: any;

  const publicKeyOptions: any = {
    challenge: authHash,
    rpId,
    allowCredentials: [{
      id: base64url.toBuffer(credentialId),
      type: 'public-key',
    }],
    userVerification: 'required',
    timeout: 60000,
  };

  try {
    credential = await navigator.credentials.get({
      publicKey: publicKeyOptions,
    }) as any;

    if (!credential) {
      throw new Error('Authentication cancelled');
    }
  } catch (error: any) {
    if (error.name === 'NotAllowedError') {
      // Try without platform restriction
      try {
        credential = await navigator.credentials.get({
          publicKey: { ...publicKeyOptions },
        }) as any;
        if (!credential) throw new Error('Authentication cancelled');
      } catch (fallbackError: any) {
        throw new Error(`Authentication failed: ${fallbackError.message}`);
      }
    } else {
      throw error;
    }
  }

  const authenticatorData = Buffer.from(credential.response.authenticatorData);
  const clientDataJSON = Buffer.from(credential.response.clientDataJSON);
  const signatureRaw = Buffer.from(credential.response.signature);

  const signatureCompact = convertEcdsaSignatureAsnToCompact(signatureRaw);

  const { buildSecp256r1SignatureProofs } = await import('@/lib/passkey/build-secp256r1-auth');

  let credentialIdBase64: string;
  try {
    const credentialIdBuffer = base64url.toBuffer(credentialId);
    credentialIdBase64 = credentialIdBuffer.toString('base64');
  } catch {
    credentialIdBase64 = credentialId;
  }

  const authDataForProofs = {
    keyId: credentialIdBase64,
    authenticatorData: new Uint8Array(authenticatorData),
    clientDataJson: new TextDecoder().decode(clientDataJSON),
    signature: new Uint8Array(signatureCompact),
  };

  const signatureProofs = buildSecp256r1SignatureProofs(authDataForProofs);

  const creds = authEntry.credentials().address();
  creds.signatureExpirationLedger(signatureExpirationLedger);
  creds.signature(signatureProofs);

  console.log('[Passkey] Auth entry signed with secp256r1');

  return authEntry;
}
