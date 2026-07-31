import { describe, expect, it } from 'vitest';
import {
  type DesignFlowAsset,
  importedAssetName,
  orderAssetKindFor,
  uploadFilenameFor,
} from './design-asset-import';

function asset(over: Partial<DesignFlowAsset> = {}): DesignFlowAsset {
  return {
    id: 'a1',
    kind: 'approved_design',
    name: 'Home strip',
    downloadUrl: 'https://bucket.s3.amazonaws.com/projects/p1/final.png?X-Amz-Signature=abc',
    ...over,
  };
}

describe('orderAssetKindFor', () => {
  it('maps the three DesignFlow classes onto our kinds', () => {
    expect(orderAssetKindFor('approved_design')).toBe('design');
    expect(orderAssetKindFor('font')).toBe('font');
    expect(orderAssetKindFor('reference')).toBe('other');
  });
});

describe('importedAssetName', () => {
  it('labels approved designs with their garment and variation', () => {
    expect(
      importedAssetName(asset({ garment: 'Jersey', variation: 'Home' })),
    ).toBe('Home strip (Jersey — Home)');
  });

  it('keeps the bare name when there is no context', () => {
    expect(importedAssetName(asset())).toBe('Home strip');
  });
});

describe('uploadFilenameFor', () => {
  it('takes the extension from the presigned URL path', () => {
    expect(uploadFilenameFor(asset(), null)).toBe('Home strip.png');
  });

  // Fonts arrive as octet-stream and their S3 keys carry the real extension.
  it('prefers the URL extension over a useless content-type', () => {
    const a = asset({ downloadUrl: 'https://s3/x/club-font.otf?sig=1' });
    expect(uploadFilenameFor(a, 'application/octet-stream')).toBe('Home strip.otf');
  });

  it('falls back to the content-type when the URL path has no known extension', () => {
    const a = asset({ downloadUrl: 'https://s3/x/asset-9f2?sig=1' });
    expect(uploadFilenameFor(a, 'image/jpeg')).toBe('Home strip.jpg');
    expect(uploadFilenameFor(a, 'image/png; charset=binary')).toBe('Home strip.png');
  });

  it('does not double an extension the name already carries', () => {
    const a = asset({ name: 'final.png' });
    expect(uploadFilenameFor(a, null)).toBe('final.png');
  });

  it('returns null when neither source yields an uploadable extension', () => {
    const a = asset({ downloadUrl: 'https://s3/x/asset-9f2?sig=1' });
    expect(uploadFilenameFor(a, 'application/zip')).toBeNull();
    expect(uploadFilenameFor(a, null)).toBeNull();
  });
});
