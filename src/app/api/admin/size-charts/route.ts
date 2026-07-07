import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listSizeCharts, createSizeChart } from '@/server/size-charts/service';
import { parseMultipartFormData, parseUploadedFile } from '@/lib/uploads';

const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function GET() {
  try {
    const charts = await listSizeCharts();
    return NextResponse.json(charts);
  } catch (err) {
    console.error('[size-charts GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const formData = await parseMultipartFormData(request);
  if (formData instanceof NextResponse) return formData;

  const name = (formData.get('name') as string | null)?.trim();
  const description = (formData.get('description') as string | null)?.trim() || null;

  const nameResult = z.string().min(1).safeParse(name);
  if (!nameResult.success) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const upload = await parseUploadedFile(formData, {
    allowedTypes: Object.keys(ALLOWED_TYPES),
    maxBytes: MAX_BYTES,
    typeErrorMessage: 'Only PDF, JPEG, PNG and WebP files are allowed',
  });
  if (upload instanceof NextResponse) return upload;
  const { file, buffer } = upload;

  try {
    const chart = await createSizeChart({
      name: nameResult.data,
      description,
      buffer,
      mimeType: file.type,
      ext: ALLOWED_TYPES[file.type],
    });
    return NextResponse.json(chart, { status: 201 });
  } catch (err) {
    console.error('[size-charts POST]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
