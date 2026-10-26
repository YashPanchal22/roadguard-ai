import { useState } from 'react';
import { AlertTriangle, Cpu, Gauge, RefreshCw, ShieldAlert, Sigma, Timer, Wrench } from 'lucide-react';
import { useAuth, useToast } from '../context/AppProviders';
import { useAsync } from '../hooks/useAsync';
import { describeError } from '../services/api';
import { modelApi } from '../services/endpoints';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  InlineNotice,
  KeyValue,
  PageHeader,
  ProgressBar,
  Skeleton,
} from '../components/ui';

export function ModelPage() {
  const { isAdmin } = useAuth();
  const { push } = useToast();
  const info = useAsync(() => modelApi.info(), []);
  const evaluation = useAsync(() => modelApi.evaluation(), []);
  const [reloading, setReloading] = useState(false);

  const reload = async () => {
    setReloading(true);
    try {
      await modelApi.reload();
      info.reload();
      push({ variant: 'success', title: 'Model reloaded', description: 'Weights were re-read from disk.' });
    } catch (error) {
      push({ variant: 'error', title: 'Reload failed', description: describeError(error).message });
    } finally {
      setReloading(false);
    }
  };

  const model = info.data;
  const evalData = evaluation.data;

  return (
    <div>
      <PageHeader
        eyebrow="Machine learning"
        title="Model performance"
        description="What this deployment actually runs, on which data, and what has been measured locally. Unmeasured values are shown as unavailable rather than invented."
        actions={
          isAdmin ? (
            <Button size="sm" variant="outline" onClick={reload} loading={reloading} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Reload weights
            </Button>
          ) : null
        }
      />

      {info.error ? (
        <Card>
          <ErrorState message={info.error} hints={info.hints} onRetry={info.reload} />
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Configured detector" icon={<Cpu className="h-4 w-4" />} />
          <div className="card-pad">
            {info.loading && !model ? (
              <Skeleton className="h-32 w-full" />
            ) : model ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={model.available ? 'success' : 'danger'} dot>
                    {model.available ? 'Loaded and ready' : 'Unavailable'}
                  </Badge>
                  <Badge tone="neutral">{model.device.toUpperCase()}</Badge>
                  <Badge tone="neutral">{model.model_version}</Badge>
                  {model.load_time_ms ? <Badge tone="neutral">load {model.load_time_ms.toFixed(0)} ms</Badge> : null}
                </div>

                {!model.available ? (
                  <InlineNotice tone="danger" title="Detection is disabled">
                    <p>{model.error ?? 'The model could not be loaded.'}</p>
                    <ul className="list-disc pl-4">
                      {model.hints.map((hint) => (
                        <li key={hint}>{hint}</li>
                      ))}
                    </ul>
                  </InlineNotice>
                ) : null}

                {model.class_match_warning ? (
                  <InlineNotice tone="warning" title="Class labels do not look like road damage">
                    {model.class_match_warning}
                  </InlineNotice>
                ) : null}

                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <KeyValue label="Model name" value={model.model_name} />
                  <KeyValue label="Weight file" value={model.model_path} />
                  <KeyValue label="Weights present" value={model.weights_present ? 'Yes' : 'No'} />
                  <KeyValue label="Size" value={model.weights_size_mb ? `${model.weights_size_mb} MB` : '—'} />
                  <KeyValue label="Confidence threshold" value={model.conf_threshold} />
                  <KeyValue label="NMS IoU" value={model.iou_threshold} />
                  <KeyValue label="Max detections" value={model.max_detections} />
                  <KeyValue label="Classes" value={model.class_count} />
                </dl>

                <div>
                  <p className="label">Trained class labels</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(model.class_labels).map(([id, label]) => (
                      <Badge key={id} tone="info">
                        {id}: {label}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-500 dark:text-ink-400">
                    Only these classes are recognised. The UI never claims detection of a category the model was not
                    trained on.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Dataset & provenance" icon={<Sigma className="h-4 w-4" />} />
          <div className="card-pad space-y-2 text-xs leading-relaxed text-ink-600 dark:text-ink-300">
            {model?.dataset_note ? <p>{model.dataset_note}</p> : <Skeleton className="h-24 w-full" />}
            {model?.training_config ? (
              <dl className="space-y-1.5">
                {Object.entries(model.training_config).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2">
                    <dt className="text-ink-500 dark:text-ink-400">{key.replace(/_/g, ' ')}</dt>
                    <dd className="max-w-[60%] text-right font-medium text-ink-800 dark:text-ink-100">
                      {Array.isArray(value) ? value.join(', ') : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Local evaluation"
          description="Metrics stored from a real evaluation run on a held-out test split."
          icon={<Gauge className="h-4 w-4" />}
        />
        <div className="card-pad">
          {evaluation.loading ? (
            <Skeleton className="h-32 w-full" />
          ) : evaluation.error ? (
            <ErrorState message={evaluation.error} onRetry={evaluation.reload} />
          ) : evalData?.available && evalData.evaluation ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: 'Precision', value: evalData.evaluation.precision },
                  { label: 'Recall', value: evalData.evaluation.recall },
                  { label: `mAP@${evalData.evaluation.iou_threshold}`, value: evalData.evaluation.map50 },
                  { label: 'mAP@0.5:0.95', value: evalData.evaluation.map50_95 },
                ].map((metric) => (
                  <div key={metric.label} className="rounded-lg border border-ink-200 p-3 dark:border-ink-800">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                      {metric.label}
                    </p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-ink-900 dark:text-white">
                      {(metric.value * 100).toFixed(1)}%
                    </p>
                    <ProgressBar value={metric.value * 100} />
                  </div>
                ))}
              </div>

              <dl className="grid gap-3 sm:grid-cols-3">
                <KeyValue label="Dataset" value={evalData.evaluation.dataset_name} />
                <KeyValue label="Split" value={evalData.evaluation.dataset_split} />
                <KeyValue label="Images / instances" value={`${evalData.evaluation.image_count} / ${evalData.evaluation.instance_count}`} />
                <KeyValue label="Evaluated at" value={new Date(evalData.evaluation.evaluated_at).toLocaleString()} />
                <KeyValue label="Latency mean" value={evalData.evaluation.latency_ms_mean ? `${evalData.evaluation.latency_ms_mean.toFixed(0)} ms` : '—'} />
                <KeyValue label="Latency p95" value={evalData.evaluation.latency_ms_p95 ? `${evalData.evaluation.latency_ms_p95.toFixed(0)} ms` : '—'} />
              </dl>

              {evalData.evaluation.per_class ? (
                <div className="overflow-x-auto">
                  <table className="table-base text-xs">
                    <thead>
                      <tr>
                        <th>Class</th>
                        <th className="text-right">Precision</th>
                        <th className="text-right">Recall</th>
                        <th className="text-right">mAP@0.5</th>
                        <th className="text-right">mAP@0.5:0.95</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(evalData.evaluation.per_class).map(([label, metrics]) => (
                        <tr key={label}>
                          <td className="font-medium">{label}</td>
                          <td className="text-right tabular-nums">{(metrics.precision * 100).toFixed(1)}%</td>
                          <td className="text-right tabular-nums">{(metrics.recall * 100).toFixed(1)}%</td>
                          <td className="text-right tabular-nums">{(metrics.map50 * 100).toFixed(1)}%</td>
                          <td className="text-right tabular-nums">{(metrics.map50_95 * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {evalData.evaluation.confusion_matrix?.labels && evalData.evaluation.confusion_matrix.matrix ? (
                <div>
                  <p className="label">Confusion matrix</p>
                  <div className="overflow-x-auto">
                    <table className="table-base text-[11px]">
                      <thead>
                        <tr>
                          <th>true ↓ / pred →</th>
                          {evalData.evaluation.confusion_matrix.labels.map((label) => (
                            <th key={label} className="text-center">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {evalData.evaluation.confusion_matrix.matrix.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            <td className="font-medium">{evalData.evaluation?.confusion_matrix?.labels?.[rowIndex]}</td>
                            {row.map((value, colIndex) => (
                              <td
                                key={colIndex}
                                className={`text-center tabular-nums ${rowIndex === colIndex ? 'font-bold text-emerald-600 dark:text-emerald-400' : ''}`}
                              >
                                {value}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {evalData.evaluation.notes ? <p className="text-xs text-ink-500 dark:text-ink-400">{evalData.evaluation.notes}</p> : null}
            </div>
          ) : (
            <div className="space-y-3">
              <InlineNotice tone="warning" title={evalData?.message ?? 'Evaluation not yet available'}>
                <p>
                  No metrics exist in this database yet. Precision, recall and mAP are intentionally left blank instead of
                  being estimated.
                </p>
              </InlineNotice>
              <EmptyState
                icon={<Sigma className="h-5 w-5" />}
                title="How to produce real metrics"
                description="Annotate a held-out test split, run the evaluation script, import the artefact, then reload this page."
                action={
                  <ol className="mx-auto max-w-xl list-decimal space-y-1 pl-5 text-left text-[11px] text-ink-600 dark:text-ink-300">
                    {(evalData?.instructions ?? []).map((instruction) => (
                      <li key={instruction}>
                        <code className="rounded bg-ink-100 px-1 py-0.5 text-[10px] dark:bg-ink-800">{instruction}</code>
                      </li>
                    ))}
                  </ol>
                }
              />
            </div>
          )}
          {evalData?.restrictions?.length ? (
            <div className="mt-3">
              <InlineNotice tone="info" title="Reporting rules enforced by this page">
                <ul className="list-disc pl-4">
                  {evalData.restrictions.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </InlineNotice>
            </div>
          ) : null}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Inference latency" icon={<Timer className="h-4 w-4" />} />
          <div className="card-pad space-y-2 text-xs text-ink-600 dark:text-ink-300">
            <p>
              The model is loaded once at process start and reused. A CPU run on this installation takes roughly
              200–300 ms per 1-megapixel photograph; the exact figure for each upload is shown in the detection view and
              stored with the report's detections.
            </p>
            <p className="text-[11px] text-ink-500 dark:text-ink-400">
              GPU (CUDA) inference can be enabled with <code>ROADGUARD_DEVICE=cuda</code> when a compatible device and
              PyTorch build are present.
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Honest AI limitations" icon={<ShieldAlert className="h-4 w-4" />} />
          <div className="card-pad space-y-2 text-xs text-ink-600 dark:text-ink-300">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              A high confidence score means the model is sure it found the class it was trained on — not that the road is
              dangerous.
            </p>
            <p className="flex items-start gap-2">
              <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
              Wet, night or oblique photographs degrade accuracy. Human verification is mandatory before maintenance work.
            </p>
            <p className="flex items-start gap-2">
              <Sigma className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
              Dataset coverage matters: this model was trained on drone/dashcam road-distress imagery; unseen damage types
              may be missed entirely.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
