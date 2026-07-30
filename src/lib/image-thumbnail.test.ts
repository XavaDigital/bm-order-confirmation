import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { generateThumbnail } from './image-thumbnail';

describe('generateThumbnail', () => {
  it('resizes a large image down to within the thumbnail bound as webp', async () => {
    const original = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 200, g: 50, b: 50 } },
    })
      .png()
      .toBuffer();

    const thumb = await generateThumbnail(original);

    expect(thumb).not.toBeNull();
    const meta = await sharp(thumb!).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(480);
    expect(meta.height).toBeLessThanOrEqual(480);
    expect(thumb!.length).toBeLessThan(original.length);
  });

  it('does not upscale an image smaller than the thumbnail bound', async () => {
    const original = await sharp({
      create: { width: 100, height: 80, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .png()
      .toBuffer();

    const thumb = await generateThumbnail(original);
    const meta = await sharp(thumb!).metadata();

    expect(meta.width).toBe(100);
    expect(meta.height).toBe(80);
  });

  it('returns null for data that is not a decodable image', async () => {
    const thumb = await generateThumbnail(Buffer.from('not an image'));
    expect(thumb).toBeNull();
  });
});
