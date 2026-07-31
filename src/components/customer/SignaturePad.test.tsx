import { forwardRef, useImperativeHandle } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignaturePad } from './SignaturePad';

const { isEmptyMock, clearMock } = vi.hoisted(() => ({
  isEmptyMock: vi.fn(() => false),
  clearMock: vi.fn(),
}));

vi.mock('react-signature-canvas', () => {
  const MockSignatureCanvas = forwardRef(
    (props: { onEnd?: () => void; canvasProps?: Record<string, unknown> }, ref) => {
      useImperativeHandle(ref, () => ({
        clear: clearMock,
        isEmpty: isEmptyMock,
        getCanvas: () => ({ toDataURL: () => 'data:image/png;base64,DRAWN' }),
      }));
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
      return (
        <canvas data-testid="signature-canvas" {...props.canvasProps} onClick={() => props.onEnd?.()} />
      );
    },
  );
  MockSignatureCanvas.displayName = 'MockSignatureCanvas';
  return { default: MockSignatureCanvas };
});

// jsdom's FileReader support is unreliable across environments; stub a deterministic one.
class MockFileReader {
  onload: ((ev: { target: { result: string } }) => void) | null = null;
  result: string | null = null;
  readAsDataURL(file: File) {
    this.result = `data:${file.type};base64,MOCKDATA`;
    queueMicrotask(() => this.onload?.({ target: { result: this.result! } }));
  }
}

beforeEach(() => {
  isEmptyMock.mockReturnValue(false);
  clearMock.mockClear();
  vi.stubGlobal('FileReader', MockFileReader);
});

describe('SignaturePad', () => {
  it('draw tab: the canvas has an accessible name and points to the alternatives', () => {
    render(<SignaturePad onChange={vi.fn()} />);

    expect(screen.getByTestId('signature-canvas')).toHaveAttribute(
      'aria-label',
      'Draw your signature',
    );
    expect(screen.getByText(/use the upload or skip tab above instead/i)).toBeInTheDocument();
  });

  it('draw tab: finishing a stroke reports the drawn data URL and enables Clear', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);

    expect(screen.getByRole('button', { name: /clear/i })).toBeDisabled();

    await user.click(screen.getByTestId('signature-canvas'));

    expect(onChange).toHaveBeenCalledWith({ dataUrl: 'data:image/png;base64,DRAWN', type: 'drawn' });
    expect(screen.getByRole('button', { name: /clear/i })).toBeEnabled();
  });

  it('draw tab: an end event on an empty canvas is ignored', async () => {
    const user = userEvent.setup();
    isEmptyMock.mockReturnValue(true);
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);

    await user.click(screen.getByTestId('signature-canvas'));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /clear/i })).toBeDisabled();
  });

  it('Clear button resets the canvas and reports type "none"', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);

    await user.click(screen.getByTestId('signature-canvas'));
    await user.click(screen.getByRole('button', { name: /clear/i }));

    expect(clearMock).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith({ dataUrl: null, type: 'none' });
    expect(screen.getByRole('button', { name: /clear/i })).toBeDisabled();
  });

  it('upload tab: a non-image file is rejected without calling onChange, and shows a visible error', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<SignaturePad onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /upload image/i }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['plain text'], 'notes.txt', { type: 'text/plain' });
    await user.upload(input, file);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByAltText('Uploaded signature')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't an image/i);
  });

  it('upload tab: a subsequent valid image clears the earlier error', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<SignaturePad onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /upload image/i }));
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['plain text'], 'notes.txt', { type: 'text/plain' }),
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    // Re-query: rc-upload may re-render its own <input> between selections.
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['fake-bytes'], 'sig.png', { type: 'image/png' }),
    );

    expect(await screen.findByAltText('Uploaded signature')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('upload tab: an image file shows a preview and reports the uploaded data URL; Remove clears it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<SignaturePad onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /upload image/i }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake-bytes'], 'sig.png', { type: 'image/png' });
    await user.upload(input, file);

    expect(await screen.findByAltText('Uploaded signature')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith({ dataUrl: 'data:image/png;base64,MOCKDATA', type: 'uploaded' });

    await user.click(screen.getByRole('button', { name: /remove/i }));

    expect(screen.queryByAltText('Uploaded signature')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({ dataUrl: null, type: 'none' });
  });

  it('skip tab: selecting it reports type "none"', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /skip/i }));

    expect(onChange).toHaveBeenCalledWith({ dataUrl: null, type: 'none' });
    expect(screen.getByText(/no signature will be attached/i)).toBeInTheDocument();
  });
});
