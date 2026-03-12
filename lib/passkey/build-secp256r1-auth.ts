/**
 * Build Secp256r1 Auth Credentials for Smart Account Contract
 *
 * This builds the auth credentials structure that matches exactly what
 * the contract expects for deserialization.
 *
 * Based on the RPC JSON structure analysis, we need to build:
 * - SignerKey as vec[Secp256r1, bytes] (key_id)
 * - SignerProof as vec[Secp256r1, map[authenticator_data, client_data_json, signature]]
 * - SignatureProofs as Map<SignerKey, SignerProof>
 */

import { xdr, Address } from '@stellar/stellar-sdk';

export interface Secp256r1AuthData {
  keyId: string; // Base64 encoded key ID
  authenticatorData: Uint8Array; // Raw bytes
  clientDataJson: string; // JSON string
  signature: Uint8Array; // 64 bytes (compact format)
}

/**
 * Build the auth credentials signature map for Secp256r1
 */
export function buildSecp256r1SignatureProofs(
  authData: Secp256r1AuthData
): xdr.ScVal {
  const signatureBytes = Buffer.from(authData.signature);
  if (signatureBytes.length !== 64) {
    throw new Error(`Signature must be exactly 64 bytes, got ${signatureBytes.length}`);
  }

  const keyIdBytes = Buffer.from(authData.keyId, 'base64');
  const signerKeyScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Secp256r1'),
    xdr.ScVal.scvBytes(keyIdBytes)
  ]);

  const mapEntries = [
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('authenticator_data'),
      val: xdr.ScVal.scvBytes(Buffer.from(authData.authenticatorData))
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('client_data_json'),
      val: xdr.ScVal.scvBytes(Buffer.from(authData.clientDataJson, 'utf8'))
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signature'),
      val: xdr.ScVal.scvBytes(signatureBytes)
    })
  ];

  mapEntries.sort((a, b) => {
    const aSym = a.key().sym()?.toString() || '';
    const bSym = b.key().sym()?.toString() || '';
    return aSym.localeCompare(bSym);
  });

  const secp256r1SignatureMap = xdr.ScVal.scvMap(mapEntries);

  const signerProofScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Secp256r1'),
    secp256r1SignatureMap
  ]);

  const signatureProofsEntries = [
    new xdr.ScMapEntry({
      key: signerKeyScVal,
      val: signerProofScVal
    })
  ];

  signatureProofsEntries.sort((a, b) => {
    const aXdr = a.key().toXDR();
    const bXdr = b.key().toXDR();
    const minLen = Math.min(aXdr.length, bXdr.length);
    for (let i = 0; i < minLen; i++) {
      if (aXdr[i] < bXdr[i]) return -1;
      if (aXdr[i] > bXdr[i]) return 1;
    }
    return aXdr.length - bXdr.length;
  });

  const signatureProofsMap = xdr.ScVal.scvMap(signatureProofsEntries);

  return xdr.ScVal.scvVec([signatureProofsMap]);
}

/**
 * Build complete auth credentials for contract invocation
 */
export function buildSecp256r1AuthCredentials(
  contractAddress: string,
  nonce: xdr.Int64 | bigint,
  signatureExpirationLedger: number,
  authData: Secp256r1AuthData,
  rootInvocation: xdr.SorobanAuthorizedInvocation
): xdr.SorobanAuthorizationEntry {
  const signatureMap = buildSecp256r1SignatureProofs(authData);

  const address = Address.fromString(contractAddress);

  const nonceXdr = nonce instanceof xdr.Int64
    ? nonce
    : xdr.Int64.fromString(nonce.toString());

  const addressCredentials = new xdr.SorobanAddressCredentials({
    address: address.toScAddress(),
    nonce: nonceXdr,
    signatureExpirationLedger,
    signature: signatureMap
  });

  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(addressCredentials);

  return new xdr.SorobanAuthorizationEntry({
    credentials,
    rootInvocation
  });
}

export async function extractAuthDataFromWebAuthn(
  webauthnResponse: any,
  keyId: string,
  signatureConverter: (signature: Buffer) => Buffer
): Promise<Secp256r1AuthData> {
  const signatureRaw = Buffer.from(webauthnResponse.response.signature);
  const signature = signatureConverter(signatureRaw);

  return {
    keyId,
    authenticatorData: new Uint8Array(webauthnResponse.response.authenticatorData),
    clientDataJson: webauthnResponse.response.clientDataJSON,
    signature: new Uint8Array(signature)
  };
}
