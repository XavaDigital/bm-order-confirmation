import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

/** Standard 400 response shape for a failed `schema.safeParse()`. */
export function badRequest(error: ZodError): NextResponse {
  return NextResponse.json({ error: 'Invalid request', details: error.flatten() }, { status: 400 });
}

export function unauthorized(message = 'Unauthorized'): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = 'Forbidden'): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message = 'Not found'): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function conflict(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 409 });
}

export function serviceUnavailable(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 503 });
}

export function serverError(): NextResponse {
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
