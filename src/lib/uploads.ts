import { NextRequest, NextResponse } from 'next/server';

/**
 * Parse `request.formData()`, returning a 400 response when the body is not
 * multipart/form-data instead of throwing.
 */
export async function parseMultipartFormData(request: NextRequest): Promise<FormData | NextResponse> {
  try {
    return await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }
}

/**
 * Pull the `file` field out of a multipart form, validate its content type
 * and size, and read it into a Buffer. Returns a 400 response on any
 * validation failure. `maxBytes` must be a whole number of megabytes (it is
 * echoed back in the size-limit error message).
 */
export async function parseUploadedFile(
  formData: FormData,
  {
    allowedTypes,
    maxBytes,
    typeErrorMessage,
  }: { allowedTypes: readonly string[]; maxBytes: number; typeErrorMessage: string },
): Promise<{ file: File; buffer: Buffer } | NextResponse> {
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 });
  }

  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: typeErrorMessage }, { status: 400 });
  }

  if (file.size > maxBytes) {
    return NextResponse.json(
      { error: `File exceeds ${maxBytes / (1024 * 1024)} MB limit` },
      { status: 400 },
    );
  }

  return { file, buffer: Buffer.from(await file.arrayBuffer()) };
}
