import { NextResponse } from 'next/server';

export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

export const ERROR_CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
  WALLET_ALREADY_DEPLOYED: 'WALLET_ALREADY_DEPLOYED',
  WALLET_DEPLOYMENT_FAILED: 'WALLET_DEPLOYMENT_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INVALID_TRANSACTION: 'INVALID_TRANSACTION',
  SIMULATION_FAILED: 'SIMULATION_FAILED',
  SEQUENCE_MISMATCH: 'SEQUENCE_MISMATCH',
  MISSING_PARAMS: 'MISSING_PARAMS',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  RPC_ERROR: 'RPC_ERROR',
  PAYMASTER_ERROR: 'PAYMASTER_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  DATABASE_ERROR: 'DATABASE_ERROR',
  CONTRACT_ERROR: 'CONTRACT_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  DAILY_LIMIT_EXCEEDED: 'DAILY_LIMIT_EXCEEDED',
} as const;

export function createErrorResponse(
  code: string,
  message: string,
  statusCode: number = 500,
  details?: any
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(details && { details }),
      },
    },
    { status: statusCode }
  );
}

export function createSuccessResponse(data: any, meta?: any, statusCode: number = 200): NextResponse {
  return NextResponse.json({
    success: true,
    data,
    ...(meta && { meta }),
  }, { status: statusCode });
}

export function handleApiError(error: unknown, context?: string): NextResponse {
  console.error(`[API Error]${context ? ` [${context}]` : ''}:`, error);

  if (error instanceof Error) {
    if (error.message.includes('not found')) {
      return createErrorResponse(ERROR_CODES.WALLET_NOT_FOUND, error.message, 404);
    }
    if (error.message.includes('unauthorized') || error.message.includes('authentication')) {
      return createErrorResponse(ERROR_CODES.UNAUTHORIZED, error.message, 401);
    }
    if (error.message.includes('forbidden') || error.message.includes('permission')) {
      return createErrorResponse(ERROR_CODES.FORBIDDEN, error.message, 403);
    }
    if (error.message.includes('validation') || error.message.includes('invalid')) {
      return createErrorResponse(ERROR_CODES.INVALID_INPUT, error.message, 400);
    }
  }

  return createErrorResponse(
    ERROR_CODES.INTERNAL_ERROR,
    'An unexpected error occurred',
    500,
    process.env.NODE_ENV === 'development'
      ? { error: error instanceof Error ? error.message : String(error) }
      : undefined
  );
}
