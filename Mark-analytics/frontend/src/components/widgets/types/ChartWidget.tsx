import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useWidgetData } from '@/hooks/useWidgetData';
import type { WidgetRead } from '@/types/widgets';
import { WidgetFrame } from './WidgetFrame';

export interface ChartWidgetProps {
  widget: WidgetRead;
  onEdit?: () => void;
  onDelete?: () => void;
}

const PALETTE = [
  '#6366f1',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#a855f7',
  '#10b981',
  '#f97316',
];

export function ChartWidget({ widget, onEdit, onDelete }: ChartWidgetProps): JSX.Element {
  const { data, isLoading, isError, error } = useWidgetData(widget);
  const title = typeof widget.params.title === 'string' ? widget.params.title : widget.name;
  const chart = data && data.type === 'chart' ? data : null;

  return (
    <WidgetFrame
      title={title}
      loading={isLoading}
      error={isError ? error.message : null}
      {...(onEdit ? { onEdit } : {})}
      {...(onDelete ? { onDelete } : {})}
    >
      <div className="h-full w-full">
        {chart && chart.series.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            {(() => {
              switch (chart.chart_kind) {
                case 'pie': {
                  const flat = chart.series[0]?.data.map((d, i) => ({
                    name: String(d.x),
                    value: d.y,
                    fill: PALETTE[i % PALETTE.length],
                  })) ?? [];
                  return (
                    <PieChart>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Pie data={flat} dataKey="value" nameKey="name" outerRadius="80%">
                        {flat.map((entry, i) => (
                          <Cell key={`c-${i}`} fill={entry.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  );
                }
                case 'line': {
                  const data0 = chart.series[0]?.data ?? [];
                  const flat = data0.map((d) => ({ x: String(d.x), y: d.y }));
                  return (
                    <LineChart data={flat}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="y" stroke="#6366f1" strokeWidth={2} dot={false} />
                    </LineChart>
                  );
                }
                case 'bar':
                default: {
                  const data0 = chart.series[0]?.data ?? [];
                  const flat = data0.map((d) => ({ x: String(d.x), y: d.y }));
                  return (
                    <BarChart data={flat}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="y" fill="#6366f1" />
                    </BarChart>
                  );
                }
              }
            })()}
          </ResponsiveContainer>
        ) : !isLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500 dark:text-neutral-400">
            No data
          </div>
        ) : null}
      </div>
    </WidgetFrame>
  );
}

export default ChartWidget;
