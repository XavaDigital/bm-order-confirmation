'use client';

/**
 * Supplier colour-book picker (David, 2026-08-05). Loads the supplier's books
 * newest-first — the FIRST is the default for new POs and is labelled
 * "(latest)" — and offers an inline "Add new book…" flow. Books are added as
 * new editions arrive and never deleted (old POs and reprints reference them),
 * so adding one immediately makes it the supplier's default.
 *
 * Used by CreatePoModal (pick at raise time) and PoDetailView (edit in place).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { App, Button, Input, Select, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ApiError, getJson, postJson } from '@/lib/api-fetch';

export interface ColorBook {
  id: string;
  name: string;
  createdAt: string;
}

interface Props {
  supplierId: string;
  /** Selected book id; null = none selected. */
  value: string | null;
  onChange: (id: string | null) => void;
  /**
   * Reports the book list (newest first) after every load AND after an inline
   * add — callers track `books[0]?.id` to know the supplier's current default.
   */
  onBooksLoaded?: (books: ColorBook[]) => void;
  /** Offer the × clear affordance (clears to null). */
  allowClear?: boolean;
  /** Select the supplier's newest book once the list arrives. */
  autoSelectDefault?: boolean;
  style?: CSSProperties;
}

export function ColorBookSelect({
  supplierId,
  value,
  onChange,
  onBooksLoaded,
  allowClear,
  autoSelectDefault,
  style,
}: Props) {
  const { message } = App.useApp();
  const [books, setBooks] = useState<ColorBook[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingBook, setSavingBook] = useState(false);

  // Latest callbacks without re-firing the load effect when a parent re-renders.
  const callbacksRef = useRef({ onChange, onBooksLoaded, autoSelectDefault });
  callbacksRef.current = { onChange, onBooksLoaded, autoSelectDefault };

  useEffect(() => {
    let cancelled = false;
    setBooks(null);
    getJson<{ items: ColorBook[] }>(
      `/api/admin/suppliers/${supplierId}/color-books`,
      'Failed to load colour books',
    )
      .then((res) => {
        if (cancelled) return;
        setBooks(res.items);
        callbacksRef.current.onBooksLoaded?.(res.items);
        if (callbacksRef.current.autoSelectDefault) {
          callbacksRef.current.onChange(res.items[0]?.id ?? null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setBooks([]);
        message.error(err instanceof Error ? err.message : 'Failed to load colour books');
      });
    return () => {
      cancelled = true;
    };
  }, [supplierId, message]);

  async function addBook() {
    const name = nameDraft.trim();
    if (!name) return;
    setSavingBook(true);
    try {
      const book = await postJson<ColorBook>(
        `/api/admin/suppliers/${supplierId}/color-books`,
        { name },
        'Failed to add the colour book',
      );
      const next = [book, ...(books ?? [])];
      setBooks(next);
      onBooksLoaded?.(next);
      onChange(book.id);
      setAddOpen(false);
      setNameDraft('');
      message.success(
        `"${book.name}" added — it is now this supplier's default colour book for new purchase orders`,
      );
    } catch (err) {
      message.error(
        err instanceof ApiError ? err.message : 'Failed to add the colour book',
      );
    } finally {
      setSavingBook(false);
    }
  }

  return (
    <Space direction="vertical" size={4} style={style}>
      <Space wrap size={8}>
        <Select
          aria-label="Colour book"
          style={{ minWidth: 220 }}
          placeholder={books?.length === 0 ? 'No colour books yet' : 'Select a colour book'}
          loading={books === null}
          value={value ?? undefined}
          onChange={(v?: string) => onChange(v ?? null)}
          allowClear={allowClear}
          options={(books ?? []).map((b, i) => ({
            value: b.id,
            // Newest first — the first row is the default for new POs.
            label: i === 0 ? `${b.name} (latest)` : b.name,
          }))}
        />
        {!addOpen && (
          <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            Add new book…
          </Button>
        )}
      </Space>
      {addOpen && (
        <Space wrap size={8}>
          <Input
            size="small"
            placeholder="New colour book name"
            aria-label="New colour book name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onPressEnter={() => void addBook()}
            maxLength={120}
            style={{ width: 220 }}
          />
          <Button
            size="small"
            type="primary"
            loading={savingBook}
            disabled={!nameDraft.trim()}
            onClick={() => void addBook()}
          >
            Add
          </Button>
          <Button
            size="small"
            onClick={() => {
              setAddOpen(false);
              setNameDraft('');
            }}
          >
            Cancel
          </Button>
        </Space>
      )}
    </Space>
  );
}
