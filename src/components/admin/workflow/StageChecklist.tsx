'use client';

/**
 * The pre-production checklist for whatever stage a job is currently in.
 *
 * Ticking the last blocking item advances the job to the next stage, which the
 * server does in one transaction — this component just reports what came back,
 * so the UI can never disagree with the database about whether work moved.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { LockOutlined, UndoOutlined } from '@ant-design/icons';
import { deleteJson, getJson, postJson } from '@/lib/api-fetch';

export type BoardKey = 'order' | 'purchase_order';

export interface ChecklistTask {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isBlocking: boolean;
  policy: 'any' | 'all';
  gateKeys: string[];
  satisfied: boolean;
  confirmations: Array<{
    staffUserId: string | null;
    email: string | null;
    confirmedAt: string;
    note: string | null;
  }>;
  awaiting: string[];
}

export interface Checklist {
  entityType: BoardKey;
  entityId: string;
  stageSlug: string | null;
  stageName: string | null;
  tasks: ChecklistTask[];
  canLeaveStage: boolean;
  nextStageSlug: string | null;
}

interface Props {
  boardKey: BoardKey;
  entityId: string;
  isAdmin: boolean;
  /** Called after a change that may have moved the job on. */
  onAdvanced?: (toStageSlug: string | null) => void;
}

export function StageChecklist({ boardKey, entityId, isAdmin, onAdvanced }: Props) {
  const { message } = App.useApp();
  const [data, setData] = useState<Checklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getJson<Checklist>(
        `/api/admin/workflow/checklist?boardKey=${boardKey}&entityId=${encodeURIComponent(entityId)}`,
        'Failed to load the checklist',
      );
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the checklist');
    }
  }, [boardKey, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm(task: ChecklistTask) {
    setBusyTaskId(task.id);
    try {
      const result = await postJson<{ advancedToStageSlug: string | null }>(
        '/api/admin/workflow/tasks',
        { boardKey, entityId, taskId: task.id },
        'Failed to confirm the task',
      );
      if (result.advancedToStageSlug) {
        message.success(`All checks done — moved to ${result.advancedToStageSlug}`);
        onAdvanced?.(result.advancedToStageSlug);
      }
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to confirm the task');
    } finally {
      setBusyTaskId(null);
    }
  }

  async function reopen(task: ChecklistTask) {
    setBusyTaskId(task.id);
    try {
      await deleteJson(
        '/api/admin/workflow/tasks',
        { boardKey, entityId, taskId: task.id },
        'Failed to reopen the task',
      );
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to reopen the task');
    } finally {
      setBusyTaskId(null);
    }
  }

  if (data === null && error === null) return <Skeleton active paragraph={{ rows: 3 }} />;
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!data) return null;

  if (data.tasks.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          data.stageName
            ? `No checks on the ${data.stageName} stage`
            : 'This item is not in a workflow stage'
        }
      />
    );
  }

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Space size={8} wrap>
        <Typography.Text strong>{data.stageName}</Typography.Text>
        {data.canLeaveStage ? (
          <Tag color="success">Ready to move on</Tag>
        ) : (
          <Tag color="gold">Checks outstanding</Tag>
        )}
      </Space>

      {data.tasks.map((task) => (
        <Card key={task.id} size="small" styles={{ body: { padding: '8px 12px' } }}>
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Space size={8} align="start" style={{ width: '100%' }}>
              <Checkbox
                checked={task.satisfied}
                disabled={task.satisfied || busyTaskId === task.id}
                onChange={() => void confirm(task)}
                aria-label={`Confirm ${task.name}`}
              />
              <div style={{ flex: 1 }}>
                <Space size={6} wrap>
                  <Typography.Text
                    delete={task.satisfied}
                    type={task.satisfied ? 'secondary' : undefined}
                  >
                    {task.name}
                  </Typography.Text>
                  {/* Non-blocking work still holds the gate, so saying only
                      "optional" would be misleading. */}
                  {!task.isBlocking && (
                    <Tooltip title="Does not hold the job up, but still required before a purchase order is sent">
                      <Tag>Non-blocking</Tag>
                    </Tooltip>
                  )}
                  {task.policy === 'all' && <Tag color="blue">All owners</Tag>}
                  {task.gateKeys.length > 0 && (
                    <Tooltip title={`Gates: ${task.gateKeys.join(', ')}`}>
                      <Tag icon={<LockOutlined />} color="purple">
                        Gated
                      </Tag>
                    </Tooltip>
                  )}
                </Space>
                {task.description && (
                  <Typography.Paragraph
                    type="secondary"
                    style={{ fontSize: 12, marginBottom: 0 }}
                  >
                    {task.description}
                  </Typography.Paragraph>
                )}
                {task.confirmations.length > 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Confirmed by{' '}
                    {task.confirmations.map((c) => c.email ?? 'system').join(', ')}
                  </Typography.Text>
                )}
                {task.awaiting.length > 0 && (
                  <Typography.Text type="warning" style={{ fontSize: 12, display: 'block' }}>
                    Waiting on {task.awaiting.length} more owner
                    {task.awaiting.length === 1 ? '' : 's'}
                  </Typography.Text>
                )}
              </div>
              {task.satisfied && isAdmin && (
                <Tooltip title="Reopen this check">
                  <Button
                    type="text"
                    size="small"
                    icon={<UndoOutlined />}
                    aria-label={`Reopen ${task.name}`}
                    loading={busyTaskId === task.id}
                    onClick={() => void reopen(task)}
                  />
                </Tooltip>
              )}
            </Space>
          </Space>
        </Card>
      ))}
    </Space>
  );
}
