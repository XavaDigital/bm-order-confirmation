import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { RichTextEditor } from './RichTextEditor';

/**
 * jsdom implements neither `execCommand` nor `queryCommandState`, so formatting
 * itself can't be asserted here — that is the browser's job. These tests cover
 * the logic this component actually owns: emitting changes, not crashing when
 * the commands are missing, link validation, and the submit shortcut.
 */
function renderEditor(props: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) {
  const onChange = vi.fn();
  const result = render(
    <AntdApp>
      <RichTextEditor value="" onChange={onChange} {...props} />
    </AntdApp>,
  );
  return { ...result, onChange };
}

beforeEach(() => {
  // Present in browsers, absent in jsdom — install a spy so the calls are
  // observable, then individual tests can delete it to prove the guard works.
  (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => true);
  (document as unknown as { queryCommandState: unknown }).queryCommandState = vi.fn(() => false);
});

describe('RichTextEditor', () => {
  it('renders an accessible multiline textbox with a placeholder', () => {
    renderEditor({ placeholder: 'Add a note…', ariaLabel: 'New note' });

    const editor = screen.getByRole('textbox', { name: 'New note' });
    expect(editor).toHaveAttribute('aria-multiline', 'true');
    expect(editor).toHaveAttribute('data-placeholder', 'Add a note…');
    expect(editor).toHaveAttribute('contenteditable', 'true');
  });

  it('emits the editor HTML on input', () => {
    const { onChange } = renderEditor();

    const editor = screen.getByRole('textbox');
    editor.innerHTML = '<p>hello</p>';
    fireEvent.input(editor);

    expect(onChange).toHaveBeenCalledWith('<p>hello</p>');
  });

  it('seeds the node when the value changes from outside', () => {
    const { rerender, onChange } = renderEditor();

    rerender(
      <AntdApp>
        <RichTextEditor value="<p>seeded</p>" onChange={onChange} />
      </AntdApp>,
    );

    expect(screen.getByRole('textbox').innerHTML).toBe('<p>seeded</p>');
  });

  // Reseeding on every render would send the caret back to the start on each
  // keystroke, so the effect must ignore the value it just produced.
  it('does not reseed the node with the value it just emitted', () => {
    const { rerender, onChange } = renderEditor();
    const editor = screen.getByRole('textbox');

    editor.innerHTML = '<p>typed by the user</p>';
    fireEvent.input(editor);
    // The parent stores what it was given and renders it straight back.
    rerender(
      <AntdApp>
        <RichTextEditor value="<p>typed by the user</p>" onChange={onChange} />
      </AntdApp>,
    );

    expect(editor.innerHTML).toBe('<p>typed by the user</p>');
  });

  it('is not editable when disabled', () => {
    renderEditor({ disabled: true });

    expect(screen.getByRole('textbox')).toHaveAttribute('contenteditable', 'false');
  });

  it('exposes every toolbar action by name', () => {
    renderEditor();

    for (const label of [
      'Bold',
      'Italic',
      'Strikethrough',
      'Bullet list',
      'Numbered list',
      'Add link',
      'Clear formatting',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('runs the matching command for a toolbar button', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Bold' }));

    expect(document.execCommand).toHaveBeenCalledWith('bold', false, undefined);
  });

  // The editor must degrade to a plain box rather than throw where the
  // deprecated commands are unavailable.
  it('survives a browser with no execCommand at all', async () => {
    const user = userEvent.setup();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
    delete (document as unknown as { queryCommandState?: unknown }).queryCommandState;
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Bold' }));

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('survives execCommand throwing', async () => {
    const user = userEvent.setup();
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => {
      throw new Error('not supported');
    });
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Italic' }));

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('pastes as plain text so foreign markup never enters the editor', () => {
    renderEditor();

    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: { getData: () => 'plain <b>text</b>' },
    });

    expect(document.execCommand).toHaveBeenCalledWith(
      'insertText',
      false,
      'plain <b>text</b>',
    );
  });

  it('calls onSubmit for Ctrl+Enter but not for a bare Enter', () => {
    const onSubmit = vi.fn();
    renderEditor({ onSubmit });
    const editor = screen.getByRole('textbox');

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('RichTextEditor — links', () => {
  it('refuses to add a link that is not http(s)', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(await screen.findByLabelText('Link URL'), 'javascript:alert(1)');

    // The confirm button stays disabled, so the scheme never reaches the editor.
    expect(screen.getByRole('button', { name: 'Insert link' })).toBeDisabled();
    expect(document.execCommand).not.toHaveBeenCalledWith(
      'createLink',
      false,
      'javascript:alert(1)',
    );
  });

  it('wraps the selection in a link for a valid URL', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(await screen.findByLabelText('Link URL'), 'https://drive.example/x');
    await user.click(screen.getByRole('button', { name: 'Insert link' }));

    // Nothing is selected in this test, so the URL is inserted as its own link
    // rather than the click doing nothing.
    expect(document.execCommand).toHaveBeenCalledWith(
      'insertHTML',
      false,
      '<a href="https://drive.example/x">https://drive.example/x</a>',
    );
  });
});
