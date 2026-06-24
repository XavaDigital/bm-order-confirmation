import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listSizeCharts, createSizeChart } from '@/server/size-charts/service';

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
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const name = (formData.get('name') as string | null)?.trim();
  const description = (formData.get('description') as string | null)?.trim() || null;
  const file = formData.get('file');

  const nameResult = z.string().min(1).safeParse(name);
  if (!nameResult.success) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 });
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: 'Only PDF, JPEG, PNG and WebP files are allowed' },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 20 MB limit' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const chart = await createSizeChart({
      name: nameResult.data,
      description,
      buffer,
      mimeType: file.type,
      ext,
    });
    return NextResponse.json(chart, { status: 201 });
  } catch (err) {
    console.error('[size-charts POST]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
