import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

/** Standard 400 response shape for a failed `schema.safeParse()`. */
export function badRequest(error: ZodError): NextResponse {
  return NextResponse.json({ error: 'Invalid request', details: error.flatten() }, { status: 400 });
}
