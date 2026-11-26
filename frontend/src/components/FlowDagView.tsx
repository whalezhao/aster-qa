import { Link } from 'react-router-dom';
import { Space, Tag, Typography } from 'antd';
import { dagLayers } from '../lib/dag';
import { fmtDuration, runStatusView } from '../lib/format';
import { t } from '../i18n';
import type { BatchRun } from '../api/batches';

export default function FlowDagView({ runs }: { runs: BatchRun[] }) {
  const flowRuns = runs.filter((run) => run.run_kind === 'flow');
  const ids = flowRuns.map((run) => run.id);
  const edges = flowRuns.flatMap((run) =>
    run.depends_on_run_ids.map((dependsOn) => ({
      case_id: run.id,
      depends_on_case_id: dependsOn,
    })),
  );
  const layers = dagLayers(ids, edges);
  if (layers === null || layers.length === 0) return null;

  const byId = new Map(flowRuns.map((run) => [run.id, run]));
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('编排执行顺序：同一层的节点没有依赖关系，并行执行')}
      </Typography.Text>
      {layers.map((layer, index) => (
        <Space key={index} wrap align="start">
          <Tag color="blue">{t('第 {n} 层', { n: index })}</Tag>
          {layer.map((runId) => {
            const run = byId.get(runId);
            if (!run) return null;
            const view = runStatusView({
              status: run.status,
              failed: run.failed,
              failure_kind: run.failure_kind,
            });
            return (
              <div
                key={runId}
                style={{
                  minWidth: 170,
                  maxWidth: 260,
                  border: '1px solid #f0f0f0',
                  borderRadius: 8,
                  padding: '8px 10px',
                }}
              >
                <div>
                  <Link to={`/runs/${runId}`}>
                    {run.case_name ?? runId.slice(0, 8)}
                    {run.loop_total && run.loop_total > 1
                      ? ` · ${run.loop_index}/${run.loop_total}`
                      : ''}
                  </Link>
                </div>
                <Space size={6} wrap>
                  <Tag color={view.color}>{view.label}</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {fmtDuration(run.duration_ms)}
                  </Typography.Text>
                </Space>
                {run.blocked_reason && (
                  <Typography.Text
                    type="warning"
                    style={{ display: 'block', fontSize: 12, marginTop: 4 }}
                  >
                    {run.blocked_reason}
                  </Typography.Text>
                )}
              </div>
            );
          })}
        </Space>
      ))}
    </Space>
  );
}