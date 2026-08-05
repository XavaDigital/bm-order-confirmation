'use client';

/**
 * Kanban board for orders and purchase orders.
 *
 * dnd-kit's low-level `useDraggable`/`useDroppable` rather than
 * `SortableContext`: there is no intra-column ordering to persist — a card's
 * position within a column carries no meaning — so the sortable machinery would
 * be weight for nothing.
 *
 * Moves are optimistic with a snapshot rollback, because the alternative (wait
 * for the round trip) makes dragging feel broken. A refused move snaps back and
 * opens a dialog listing what blocked it, rather than a toast that vanishes
 * before it has been read.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Empty,
  Modal,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { ClockCircleOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, getJson, postJson } from '@/lib/api-fetch';

export type BoardKey = 'order' | 'purchase_order';
export type StageUrgency = 'ok' | 'warn' | 'urgent';

export interface BoardCard {
  id: string;
  reference: string;
  title: string;
  subtitle: string | null;
  status: string;
  stageSlug: string;
  stageEnteredAt: string | null;
  hoursInStage: number | null;
  urgency: StageUrgency;
  outstandingTaskSlugs: string[];
  value: { amount: string; currency: string } | null;
  deadlineDate: string | null;
  supplierName?: string | null;
  orderId?: string;
}

export interface BoardColumn {
  slug: string;
  name: string;
  statusKey: string;
  color: string | null;
  isTerminal: boolean;
  cards: BoardCard[];
}

export interface Board {
  boardKey: BoardKey;
  columns: BoardColumn[];
  orphanedCount: number;
}

interface Props {
  /**
   * Which board to show. Controlled by the page rather than switched inside:
   * the board now lives on the Orders and Purchase Orders pages, each of which
   * already knows which one it wants, so an internal switcher would let a page
   * display the other page's cards.
   */
  boardKey: BoardKey;
}

const URGENCY_COLOR: Record<StageUrgency, string | undefined> = {
  ok: undefined,
  warn: 'warning',
  urgent: 'error',
};

/**
 * Space between the bottom of the board and the bottom of the viewport: the
 * shell's content margin (16) + panel padding (24) + borders. Kept as one
 * number so the board's height calc and the shell agree.
 */
const BOARD_BOTTOM_OFFSET = 42;

function formatAge(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Move a card between columns in an already-loaded board.
 *
 * Exported and pure so the optimistic-update logic can be tested directly:
 * jsdom has no layout, so dnd-kit's collision detection cannot run there and a
 * simulated drag would prove nothing. Returns the board unchanged if the card is
 * unknown or already in the target column.
 */
export function applyOptimisticMove(
  board: Board,
  cardId: string,
  toStageSlug: string,
): Board {
  const from = board.columns.find((column) => column.cards.some((c) => c.id === cardId));
  const moving = from?.cards.find((c) => c.id === cardId);
  if (!from || !moving) return board;
  if (from.slug === toStageSlug) return board;
  if (!board.columns.some((column) => column.slug === toStageSlug)) return board;

  return {
    ...board,
    columns: board.columns.map((column) => {
      if (column.slug === from.slug) {
        return { ...column, cards: column.cards.filter((c) => c.id !== cardId) };
      }
      if (column.slug === toStageSlug) {
        // Newest at the top: the card someone just moved should be where they
        // are looking, not at the bottom of a long column.
        return { ...column, cards: [{ ...moving, stageSlug: toStageSlug }, ...column.cards] };
      }
      return column;
    }),
  };
}

function cardHref(boardKey: BoardKey, card: BoardCard): string {
  // A PO card opens the PO itself, not the parent order (David, 2026-08-05) —
  // the card's id IS the purchase-order id on the purchase_order board.
  return boardKey === 'order'
    ? `/admin/orders/${card.id}`
    : `/admin/purchase-orders/${card.id}`;
}

function DraggableCard({
  card,
  boardKey,
  disabled,
  onOpen,
}: {
  card: BoardCard;
  boardKey: BoardKey;
  disabled: boolean;
  /** Open the order — a plain click anywhere on the card (David, 2026-08-04). */
  onOpen: (card: BoardCard) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(card)}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: disabled ? 'pointer' : 'grab' }}
    >
      <CardBody card={card} boardKey={boardKey} />
    </div>
  );
}

function CardBody({ card, boardKey }: { card: BoardCard; boardKey: BoardKey }) {
  const { token } = theme.useToken();
  const age = formatAge(card.hoursInStage);

  return (
    <Card
      size="small"
      style={{
        marginBottom: 8,
        borderLeft: `3px solid ${
          card.urgency === 'urgent'
            ? token.colorError
            : card.urgency === 'warn'
              ? token.colorWarning
              : token.colorBorderSecondary
        }`,
      }}
      styles={{ body: { padding: '8px 10px' } }}
    >
      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        <Space size={6} style={{ justifyContent: 'space-between', width: '100%' }}>
          {/* The link is deliberately not draggable — clicking a card to open it
              has to keep working, which is why the sensor needs a distance. */}
          <Link href={cardHref(boardKey, card)} style={{ fontSize: 12, fontWeight: 600 }}>
            {card.reference}
          </Link>
          {age && (
            <Tooltip
              title={
                card.stageEnteredAt
                  ? `In this stage since ${new Date(card.stageEnteredAt).toLocaleString()}`
                  : undefined
              }
            >
              <Tag
                color={URGENCY_COLOR[card.urgency]}
                icon={<ClockCircleOutlined />}
                style={{ marginInlineEnd: 0, fontSize: 11 }}
              >
                {age}
              </Tag>
            </Tooltip>
          )}
        </Space>
        <Typography.Text style={{ fontSize: 13 }}>{card.title}</Typography.Text>
        {card.subtitle && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {card.subtitle}
          </Typography.Text>
        )}
        {card.outstandingTaskSlugs.length > 0 && (
          <Tooltip title={`Outstanding: ${card.outstandingTaskSlugs.join(', ')}`}>
            <Tag icon={<WarningOutlined />} color="gold" style={{ fontSize: 11, marginTop: 2 }}>
              {card.outstandingTaskSlugs.length} to do
            </Tag>
          </Tooltip>
        )}
      </Space>
    </Card>
  );
}

function Column({
  column,
  boardKey,
  disabled,
  onOpen,
}: {
  column: BoardColumn;
  boardKey: BoardKey;
  disabled: boolean;
  onOpen: (card: BoardCard) => void;
}) {
  const { token } = theme.useToken();
  const { setNodeRef, isOver } = useDroppable({ id: column.slug });

  return (
    <div
      ref={setNodeRef}
      // Announced so a screen-reader user can tell the columns apart, and so the
      // tests can address a column by name.
      role="group"
      aria-label={`${column.name} (${column.cards.length})`}
      style={{
        flex: '0 0 260px',
        maxWidth: 260,
        background: isOver ? token.colorPrimaryBg : token.colorFillQuaternary,
        borderRadius: 8,
        padding: 8,
        transition: 'background 120ms',
        // Columns run the full board height (David, 2026-08-06: "the rows
        // should go all the way to the bottom"); each scrolls its own cards.
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Space size={6} style={{ marginBottom: 8, width: '100%', flexShrink: 0 }}>
        {column.color && (
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 4,
              background: column.color,
            }}
          />
        )}
        <Typography.Text strong style={{ fontSize: 13 }}>
          {column.name}
        </Typography.Text>
        <Badge count={column.cards.length} showZero color={token.colorTextQuaternary} />
      </Space>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {column.cards.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Nothing here
          </Typography.Text>
        ) : (
          column.cards.map((card) => (
            <DraggableCard
              key={card.id}
              card={card}
              boardKey={boardKey}
              disabled={disabled}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function WorkflowBoard({ boardKey }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [refused, setRefused] = useState<{ message: string; details?: unknown } | null>(null);
  // Suppress the focus refresh while a move is in flight, or the response can be
  // overwritten by a read that started before the write landed.
  const inFlight = useRef(0);

  // The board region fills the rest of the viewport (David, 2026-08-06: columns
  // run to the bottom of the page, and the ONE horizontal scrollbar sits at the
  // bottom rather than mid-page). The offset above the board varies with the
  // page header and any alerts above it, so it is measured, not hard-coded.
  const rootRef = useRef<HTMLDivElement>(null);
  const [boardHeight, setBoardHeight] = useState<string>();
  useLayoutEffect(() => {
    function measure() {
      const el = rootRef.current;
      if (!el) return;
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top));
      setBoardHeight(`calc(100vh - ${top + BOARD_BOTTOM_OFFSET}px)`);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await getJson<Board>(
        `/api/admin/workflow/board?boardKey=${boardKey}`,
        'Failed to load the board',
      );
      // The board is the landing view on both the Orders and Purchase Orders
      // pages, so a response that is not a board must surface as an error
      // rather than throwing during render and blanking the whole page.
      if (!Array.isArray(next?.columns)) {
        throw new Error('The board data was not in the expected shape.');
      }
      setBoard(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load the board');
    }
  }, [boardKey]);

  useEffect(() => {
    setBoard(null);
    void load();
  }, [load]);

  // Refresh on focus rather than polling: a board left open on a second monitor
  // should be current when looked at, without a request every few seconds.
  useEffect(() => {
    function onFocus() {
      if (inFlight.current === 0) void load();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const sensors = useSensors(
    // 8px before a drag starts, so clicking a card to open it still works.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // A board that can only be operated by dragging is unusable without a
    // pointer. dnd-kit drives this from the same handlers.
    useSensor(KeyboardSensor),
  );

  const cardsById = useMemo(() => {
    const map = new Map<string, BoardCard>();
    for (const column of board?.columns ?? []) {
      for (const card of column.cards) map.set(card.id, card);
    }
    return map;
  }, [board]);

  function onDragStart(event: DragStartEvent) {
    setDragging(cardsById.get(String(event.active.id)) ?? null);
  }

  // A completed drag fires a trailing click on the source card — swallow it,
  // or every drop would also navigate to the order (David, 2026-08-04:
  // clicking anywhere on a card opens the order; dragging must not).
  const justDragged = useRef(false);
  function markDragged() {
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
  }

  function openCard(card: BoardCard) {
    if (justDragged.current) return;
    router.push(cardHref(boardKey, card));
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    markDragged();
    const cardId = String(event.active.id);
    const toStageSlug = event.over ? String(event.over.id) : null;
    if (!toStageSlug || !board) return;

    const card = cardsById.get(cardId);
    if (!card || card.stageSlug === toStageSlug) return;

    // Optimistic: move it now, keep the old board to roll back to.
    const snapshot = board;
    setBoard(applyOptimisticMove(board, cardId, toStageSlug));

    inFlight.current += 1;
    try {
      await postJson(
        '/api/admin/workflow/move',
        { boardKey, entityId: cardId, toStageSlug },
        'Failed to move the card',
      );
      // Re-read: a move can change the status, and that changes what the card
      // shows beyond which column it is in.
      await load();
    } catch (err) {
      setBoard(snapshot);
      if (err instanceof ApiError && err.status === 409) {
        setRefused({
          message: err.message,
          details: (err.body as { details?: unknown } | undefined)?.details,
        });
      } else {
        message.error(err instanceof Error ? err.message : 'Failed to move the card');
      }
    } finally {
      inFlight.current -= 1;
    }
  }

  return (
    <div
      ref={rootRef}
      data-testid="workflow-board-region"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        width: '100%',
        // Until measured (first paint / jsdom) the board just sizes to content.
        height: boardHeight,
      }}
    >
      <Space wrap style={{ justifyContent: 'flex-end', width: '100%', flexShrink: 0 }}>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          Refresh
        </Button>
      </Space>

      {loadError && <Alert type="error" showIcon message={loadError} />}

      {board && board.orphanedCount > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`${board.orphanedCount} card${board.orphanedCount === 1 ? '' : 's'} could not be placed`}
          description="Their status has no active stage. Re-activate the stage for that status under workflow settings."
        />
      )}

      {board === null ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : board.columns.length === 0 ? (
        <Empty description="No stages configured for this board" />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setDragging(null);
            markDragged();
          }}
        >
          {/* The ONE horizontal scroll container: it takes all remaining board
              height, so its scrollbar renders at the bottom of the page, and
              the columns stretch to fill it. */}
          <div
            data-testid="workflow-board-scroll"
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              alignItems: 'stretch',
              gap: 12,
              overflowX: 'auto',
              paddingBottom: 4,
            }}
          >
            {board.columns.map((column) => (
              <Column
                key={column.slug}
                column={column}
                boardKey={board.boardKey}
                disabled={false}
                onOpen={openCard}
              />
            ))}
          </div>
          <DragOverlay>
            {dragging ? <CardBody card={dragging} boardKey={board.boardKey} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* A modal, not a toast: the reason a move was refused is a list of things
          to go and do, and it should not disappear on its own. */}
      <Modal
        open={refused !== null}
        title="That move isn't allowed"
        onCancel={() => setRefused(null)}
        onOk={() => setRefused(null)}
        okText="Got it"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <Typography.Paragraph>{refused?.message}</Typography.Paragraph>
        {Array.isArray(refused?.details) && (
          <ul>
            {(refused!.details as string[]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
