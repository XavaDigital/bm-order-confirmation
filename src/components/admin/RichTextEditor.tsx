'use client';

/**
 * A small WYSIWYG editor for note bodies, matching bm-designflow's
 * `RichNoteEditor` so the two apps feel the same (fleet parity).
 *
 * `contentEditable` + `document.execCommand` rather than a ProseMirror-based
 * editor: DesignFlow ships exactly this in production, the formatting set is
 * five buttons wide, and it costs no dependencies. `execCommand` is deprecated
 * but universally implemented, and there is no replacement API — the upgrade
 * path, if the feature set ever outgrows this, is a real editor library.
 *
 * The HTML this produces is NOT trusted. It is sanitised server-side on write
 * (`notes-service.ts`) and again on render (`NoteBody`) — see `@/lib/rich-text`.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, Space, Tooltip, theme } from 'antd';
import {
  BoldOutlined,
  ClearOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  StrikethroughOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
  ariaLabel?: string;
  /** Ctrl/Cmd+Enter — wired to "send" so the composer works like a chat box. */
  onSubmit?: () => void;
}

type Command = 'bold' | 'italic' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList';

/**
 * jsdom implements neither `execCommand` nor `queryCommandState`, and Firefox
 * throws on the latter outside a focused editable. Feature-detect both so the
 * editor degrades to a plain text box instead of crashing.
 */
function execCommand(command: string, value?: string): void {
  if (typeof document.execCommand !== 'function') return;
  try {
    document.execCommand(command, false, value);
  } catch {
    /* unsupported command — leave the content alone */
  }
}

function queryState(command: string): boolean {
  if (typeof document.queryCommandState !== 'function') return false;
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

function ToolbarButton({
  active,
  label,
  icon,
  onActivate,
  disabled,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onActivate: () => void;
  disabled?: boolean;
}) {
  const { token } = theme.useToken();
  return (
    <Tooltip title={label} mouseEnterDelay={0.6}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        // onMouseDown + preventDefault, not onClick: clicking a button would
        // otherwise blur the editable and collapse the selection being styled.
        onMouseDown={(event) => {
          event.preventDefault();
          if (!disabled) onActivate();
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          padding: 0,
          border: 'none',
          borderRadius: 4,
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: active ? token.colorPrimaryBg : 'transparent',
          color: active ? token.colorPrimary : token.colorTextSecondary,
          fontSize: 12,
        }}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write a note…',
  minHeight = 72,
  disabled = false,
  ariaLabel = 'Note',
  onSubmit,
}: Props) {
  const { token } = theme.useToken();
  const editorRef = useRef<HTMLDivElement>(null);
  // What we last handed to the parent. Reseeding the node on every render would
  // reset the caret to the start on each keystroke, so we only reseed when the
  // incoming value is something we did not produce (e.g. a cleared composer).
  const lastEmitted = useRef<string>('');
  const [formats, setFormats] = useState({
    bold: false,
    italic: false,
    strike: false,
    bullet: false,
    ordered: false,
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    const node = editorRef.current;
    if (!node) return;
    if (value === lastEmitted.current) return;
    node.innerHTML = value;
    lastEmitted.current = value;
  }, [value]);

  function emit() {
    const html = editorRef.current?.innerHTML ?? '';
    lastEmitted.current = html;
    onChange(html);
  }

  function refreshFormats() {
    setFormats({
      bold: queryState('bold'),
      italic: queryState('italic'),
      strike: queryState('strikeThrough'),
      bullet: queryState('insertUnorderedList'),
      ordered: queryState('insertOrderedList'),
    });
  }

  function run(command: Command) {
    editorRef.current?.focus();
    execCommand(command);
    refreshFormats();
    emit();
  }

  function openLinkModal() {
    // Stash the selection: opening the modal moves focus, which would otherwise
    // lose the range the link is meant to wrap.
    const selection = window.getSelection();
    savedRange.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    setLinkUrl('');
    setLinkOpen(true);
  }

  function applyLink() {
    const url = linkUrl.trim();
    // Only http(s). `javascript:` would be stripped by the sanitiser anyway, but
    // there is no reason to let the editor produce it in the first place.
    if (!/^https?:\/\//i.test(url)) return;

    setLinkOpen(false);
    editorRef.current?.focus();
    if (savedRange.current) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedRange.current);
    }
    const collapsed = window.getSelection()?.isCollapsed ?? true;
    if (collapsed) {
      // Nothing selected — insert the URL as its own link rather than silently
      // doing nothing.
      execCommand('insertHTML', `<a href="${url}">${url}</a>`);
    } else {
      execCommand('createLink', url);
    }
    emit();
  }

  const linkValid = /^https?:\/\//i.test(linkUrl.trim());

  return (
    <div>
      <Space size={2} style={{ marginBottom: 4 }} wrap>
        <ToolbarButton
          active={formats.bold}
          label="Bold"
          icon={<BoldOutlined />}
          onActivate={() => run('bold')}
          disabled={disabled}
        />
        <ToolbarButton
          active={formats.italic}
          label="Italic"
          icon={<ItalicOutlined />}
          onActivate={() => run('italic')}
          disabled={disabled}
        />
        <ToolbarButton
          active={formats.strike}
          label="Strikethrough"
          icon={<StrikethroughOutlined />}
          onActivate={() => run('strikeThrough')}
          disabled={disabled}
        />
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 1,
            height: 16,
            margin: '0 4px',
            verticalAlign: 'middle',
            background: token.colorBorderSecondary,
          }}
        />
        <ToolbarButton
          active={formats.bullet}
          label="Bullet list"
          icon={<UnorderedListOutlined />}
          onActivate={() => run('insertUnorderedList')}
          disabled={disabled}
        />
        <ToolbarButton
          active={formats.ordered}
          label="Numbered list"
          icon={<OrderedListOutlined />}
          onActivate={() => run('insertOrderedList')}
          disabled={disabled}
        />
        <ToolbarButton
          active={false}
          label="Add link"
          icon={<LinkOutlined />}
          onActivate={openLinkModal}
          disabled={disabled}
        />
        <ToolbarButton
          active={false}
          label="Clear formatting"
          icon={<ClearOutlined />}
          onActivate={() => {
            editorRef.current?.focus();
            execCommand('removeFormat');
            refreshFormats();
            emit();
          }}
          disabled={disabled}
        />
      </Space>

      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        className="bm-rich-editor"
        onInput={emit}
        onBlur={emit}
        onKeyUp={refreshFormats}
        onMouseUp={refreshFormats}
        onKeyDown={(event) => {
          if (onSubmit && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
        // Paste as plain text: pasting from Word or a browser otherwise drops in
        // a wall of markup that the sanitiser then strips unevenly.
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData('text/plain');
          execCommand('insertText', text);
          emit();
        }}
        style={{
          border: `1px solid ${token.colorBorder}`,
          borderRadius: 6,
          padding: '8px 10px',
          minHeight,
          maxHeight: 320,
          overflowY: 'auto',
          outline: 'none',
          fontSize: 13,
          lineHeight: 1.5,
          background: disabled ? token.colorBgContainerDisabled : token.colorBgContainer,
        }}
      />

      <Modal
        open={linkOpen}
        title="Add a link"
        onCancel={() => setLinkOpen(false)}
        onOk={applyLink}
        okText="Insert link"
        okButtonProps={{ disabled: !linkValid }}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={linkUrl}
          onChange={(event) => setLinkUrl(event.target.value)}
          onPressEnter={() => linkValid && applyLink()}
          placeholder="https://…"
          aria-label="Link URL"
        />
      </Modal>
    </div>
  );
}
