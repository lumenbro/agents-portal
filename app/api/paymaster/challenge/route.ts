import { NextResponse } from 'next/server';
import { generateSignedChallenge } from '@/lib/paymaster-challenge-store';
import { createSuccessResponse } from '@/lib/api-error';

export async function GET() {
  const expiresIn = 120;
  const challenge = generateSignedChallenge(expiresIn);
  return createSuccessResponse({ challenge, expiresIn });
}
