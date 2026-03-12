import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse, ERROR_CODES } from './api-error';

export const walletDeploySchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  signers: z.array(
    z.object({
      type: z.enum(['Secp256r1', 'Ed25519']),
      keyId: z.string().optional(),
      publicKey: z.string().min(1, 'Public key is required'),
      role: z.enum(['Admin', 'Standard']),
    })
  ).min(1, 'At least one signer is required'),
  recoverySigner: z.object({
    type: z.literal('Ed25519'),
    publicKey: z.string().min(1, 'Recovery signer public key is required'),
  }).optional(),
  salt: z.string().optional(),
});

export const assetSendSchema = z.object({
  from: z.string().regex(/^C[A-Z0-9]{55}$/, 'Invalid C-address format'),
  to: z.string().regex(/^(C|G)[A-Z0-9]{55}$/, 'Invalid address format'),
  assetContract: z.string().regex(/^C[A-Z0-9]{55}$/, 'Invalid contract address format'),
  amount: z.string().regex(/^\d+$/, 'Amount must be a numeric string'),
});

export const passkeySignerSchema = z.object({
  walletAddress: z.string().regex(/^C[A-Z0-9]{55}$/, 'Invalid wallet address format'),
  credentialId: z.string().min(1, 'Credential ID is required'),
  publicKey: z.string().min(1, 'Public key is required'),
});

export async function validateRequest<T>(
  request: NextRequest,
  schema: z.ZodSchema<T>
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
  try {
    const body = await request.json();
    const validated = schema.parse(body);
    return { data: validated, error: null };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = (error as any).issues || (error as any).errors || [];
      const errorMessages = issues.map((err: any) => ({
        path: Array.isArray(err.path) ? err.path.join('.') : String(err.path || ''),
        message: err.message || 'Validation error',
      }));
      return {
        data: null,
        error: createErrorResponse(ERROR_CODES.INVALID_INPUT, 'Validation failed', 400, { errors: errorMessages }),
      };
    }
    return {
      data: null,
      error: createErrorResponse(ERROR_CODES.INVALID_INPUT, 'Invalid JSON in request body', 400),
    };
  }
}

export function validateQuery<T>(
  request: NextRequest,
  schema: z.ZodSchema<T>
): { data: T; error: null } | { data: null; error: NextResponse } {
  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const validated = schema.parse(params);
    return { data: validated, error: null };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = (error as any).issues || (error as any).errors || [];
      const errorMessages = issues.map((err: any) => ({
        path: Array.isArray(err.path) ? err.path.join('.') : String(err.path || ''),
        message: err.message || 'Validation error',
      }));
      return {
        data: null,
        error: createErrorResponse(ERROR_CODES.INVALID_INPUT, 'Invalid query parameters', 400, { errors: errorMessages }),
      };
    }
    return {
      data: null,
      error: createErrorResponse(ERROR_CODES.INVALID_INPUT, 'Invalid query parameters', 400),
    };
  }
}
