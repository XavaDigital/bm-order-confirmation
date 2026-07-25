'use client';

import { Modal } from 'antd';
import { BRAND } from '@/lib/theme';
import type { SizeChartLink } from '@/types/customer';

export interface SizeChartPreviewModalProps {
  /** The chart being previewed, or null when closed. */
  chart: SizeChartLink | null;
  onClose: () => void;
}

/**
 * Full-width preview of a size chart — PDF in an iframe, anything else as an
 * image — with a Download footer link when a download URL is available.
 */
export function SizeChartPreviewModal({ chart, onClose }: SizeChartPreviewModalProps) {
  return (
    <Modal
      open={!!chart}
      onCancel={onClose}
      footer={
        chart?.downloadUrl ? (
          <a href={chart.downloadUrl} style={{ color: BRAND.primaryDark, fontSize: 14 }}>
            Download
          </a>
        ) : null
      }
      title={chart?.name}
      width="80vw"
      styles={{ body: { padding: 0, textAlign: 'center', background: '#111' } }}
      centered
    >
      {chart?.url &&
        (chart.storageKey?.endsWith('.pdf') ? (
          <iframe
            src={chart.url}
            style={{ width: '100%', height: '75vh', border: 'none' }}
            title={chart.name}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={chart.url}
            alt={chart.name}
            style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
          />
        ))}
    </Modal>
  );
}
