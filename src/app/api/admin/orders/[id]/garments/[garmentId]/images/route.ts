import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { addMockupImage } from '@/server/orders/service';
import { uploadFile, getSignedUrl, mockupKey } from '@/lib/storage';
import { parseMultipartFormData, parseUploadedFile } from '@/lib/uploads';

type Params = { params: Promise<{ id: string; garmentId: string }> };

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest, { params }: Params) {
  const { id: orderId, garmentId } = await params;

  const formData = await parseMultipartFormData(request);
  if (formData instanceof NextResponse) return formData;

  const upload = await parseUploadedFile(formData, {
    allowedTypes: ALLOWED_TYPES,
    maxBytes: MAX_BYTES,
    typeErrorMessage: 'Only JPEG, PNG, WebP and GIF images are allowed',
  });
  if (upload instanceof NextResponse) return upload;
  const { file, buffer } = upload;

  const caption = (formData.get('caption') as string | null) ?? null;
  const ext = file.name.split('.').pop() ?? 'jpg';
  const filename = `${randomBytes(8).toString('hex')}.${ext}`;
  const key = mockupKey(orderId, garmentId, filename);

  try {
    await uploadFile(key, buffer, file.type);

    const image = await addMockupImage(garmentId, { storageKey: key, caption });
    const url = await getSignedUrl(key, 4 * 3600); // 4-hour signed URL for immediate admin preview

    return NextResponse.json({ ...image, url }, { status: 201 });
  } catch (err) {
    console.error('[admin/images POST]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
