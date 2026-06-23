import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { addMockupImage } from '@/server/orders/service';
import { uploadFile, getSignedUrl, mockupKey } from '@/lib/storage';

type Params = { params: Promise<{ id: string; garmentId: string }> };

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest, { params }: Params) {
  const { id: orderId, garmentId } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, WebP and GIF images are allowed' }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 });
  }

  const caption = (formData.get('caption') as string | null) ?? null;
  const ext = file.name.split('.').pop() ?? 'jpg';
  const filename = `${randomBytes(8).toString('hex')}.${ext}`;
  const key = mockupKey(orderId, garmentId, filename);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadFile(key, buffer, file.type);

    const image = await addMockupImage(garmentId, { storageKey: key, caption });
    const url = await getSignedUrl(key, 4 * 3600); // 4-hour signed URL for immediate admin preview

    return NextResponse.json({ ...image, url }, { status: 201 });
  } catch (err) {
    console.error('[admin/images POST]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
