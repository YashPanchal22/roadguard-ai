import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  ImagePlus,
  Info,
  ScanSearch,
  Sparkles,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { useMeta } from '../context/AppProviders';
import { describeError } from '../services/api';
import { detectionApi } from '../services/endpoints';
import type { AnalyzeResponse } from '../types';
import { Badge, Button, Card, CardHeader, EmptyState, InlineNotice, PageHeader, Spinner } from '../components/ui';
import { CATEGORY_LABELS } from '../components/badges';

const ACCEPTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_MB = 10;

interface LocalPreview {
  url: string;
  name: string;
  size: number;
  type: string;
}

export function DetectionPage() {
  const { options } = useMeta();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<LocalPreview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; hints: string[]; code?: string } | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [conf, setConf] = useState<number>(0.35);
  const [showOriginal, setShowOriginal] = useState(false);

  const pick = useCallback((incoming: File | null) => {
    setResult(null);
    setError(null);
    setValidation(null);
    if (!incoming) return;
    if (!ACCEPTED.includes(incoming.type)) {
      setValidation(`Unsupported type "${incoming.type || 'unknown'}". Upload a JPG, JPEG, PNG or WEBP image.`);
      return;
    }
    if (incoming.size > MAX_MB * 1024 * 1024) {
      setValidation(`File is ${(incoming.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_MB} MB.`);
      return;
    }
    setFile(incoming);
    setPreview({ url: URL.createObjectURL(incoming), name: incoming.name, size: incoming.size, type: incoming.type });
  }, []);

  const runDetection = async () => {
    if (!file) {
      setValidation('Choose a road photograph before running detection.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const analysis = await detectionApi.analyze(file, { conf });
      setResult(analysis);
      setShowOriginal(false);
    } catch (err) {
      const described = describeError(err);
      setError(described);
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    pick(event.dataTransfer.files?.[0] ?? null);
  };

  const classList = useMemo(() => Object.entries(result?.class_labels ?? {}), [result]);
  const detectionAvailable = options?.detection_available ?? true;

  return (
    <div>
      <PageHeader
        eyebrow="Computer vision"
        title="AI road damage detection"
        description="Upload a road photograph. The image is validated (type, size, magic bytes, integrity) before the configured YOLO model runs. Results are real inference output — never simulated."
        actions={
          <Link to="/report">
            <Button size="sm" variant="outline">
              Continue to report form
            </Button>
          </Link>
        }
      />

      {!detectionAvailable ? (
        <InlineNotice tone="warning" title="Detection model not loaded">
          Weights are missing or failed to load. Uploads will return an honest 503 error with setup instructions instead
          of fabricated predictions. See <Link to="/model" className="link">Model performance</Link> for the exact
          steps.
        </InlineNotice>
      ) : null}

      <div className="mt-3 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="1 · Choose a photograph" icon={<ImagePlus className="h-4 w-4" />} />
          <div className="card-pad space-y-3">
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300 px-4 py-8 text-center transition hover:border-ember-400 dark:border-ink-700"
            >
              <UploadCloud className="h-7 w-7 text-ink-400" aria-hidden />
              <p className="text-xs font-semibold text-ink-700 dark:text-ink-200">Drag &amp; drop a road photo</p>
              <p className="text-[11px] text-ink-500 dark:text-ink-400">JPG · JPEG · PNG · WEBP — up to {MAX_MB} MB</p>
              <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
                Browse files
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED.join(',')}
                className="hidden"
                aria-label="Upload road photograph"
                onChange={(event) => pick(event.target.files?.[0] ?? null)}
              />
            </div>

            {validation ? <InlineNotice tone="danger">{validation}</InlineNotice> : null}

            {preview ? (
              <div className="rounded-lg border border-ink-200 p-2 dark:border-ink-800">
                <img src={preview.url} alt="Selected road photograph preview" className="max-h-56 w-full rounded object-contain" />
                <p className="mt-1.5 truncate text-[11px] text-ink-600 dark:text-ink-300">
                  {preview.name} · {(preview.size / 1024).toFixed(0)} KB · {preview.type}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                    setResult(null);
                  }}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-signal-red hover:underline"
                >
                  <XCircle className="h-3 w-3" /> Remove
                </button>
              </div>
            ) : null}

            <div>
              <label htmlFor="conf" className="label">
                Confidence threshold: {conf.toFixed(2)}
              </label>
              <input
                id="conf"
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={conf}
                onChange={(event) => setConf(Number(event.target.value))}
                className="w-full accent-ember-500"
              />
              <p className="hint">Lower values surface more candidate boxes at the cost of false positives.</p>
            </div>

            <Button className="w-full" onClick={runDetection} loading={loading} icon={<Sparkles className="h-4 w-4" />}>
              Run detection
            </Button>
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="2 · Detection results"
            description="Bounding boxes and labels are drawn by the model. Confidence describes the model, not the severity of the damage."
            icon={<ScanSearch className="h-4 w-4" />}
            actions={
              result ? (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setShowOriginal(false)}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                      !showOriginal ? 'bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900' : 'border border-ink-200 dark:border-ink-700'
                    }`}
                  >
                    Annotated
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowOriginal(true)}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                      showOriginal ? 'bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900' : 'border border-ink-200 dark:border-ink-700'
                    }`}
                  >
                    Original
                  </button>
                </div>
              ) : null
            }
          />
          <div className="card-pad">
            {loading ? (
              <div className="flex flex-col items-center gap-2 py-14">
                <Spinner label="Running inference" />
                <p className="text-[11px] text-ink-500 dark:text-ink-400">
                  A CPU run typically takes 0.2–3 s depending on image size.
                </p>
              </div>
            ) : error ? (
              <div className="space-y-2">
                <InlineNotice tone={error.code === 'MODEL_UNAVAILABLE' ? 'warning' : 'danger'} title={error.message}>
                  {error.code ? <p>Error code: {error.code}</p> : null}
                  {error.hints.length ? (
                    <ul className="list-disc pl-4">
                      {error.hints.map((hint) => (
                        <li key={hint}>{hint}</li>
                      ))}
                    </ul>
                  ) : null}
                </InlineNotice>
                <p className="text-[11px] text-ink-500 dark:text-ink-400">
                  The API never substitutes fake predictions when inference fails.
                </p>
              </div>
            ) : result ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {result.detections_count > 0 ? (
                    <Badge tone="success" dot>
                      <CheckCircle2 className="h-3 w-3" /> {result.detections_count} detection(s)
                    </Badge>
                  ) : (
                    <Badge tone="warning" dot>
                      <AlertTriangle className="h-3 w-3" /> No damage detected
                    </Badge>
                  )}
                  <Badge tone="info">top confidence {result.top_confidence ? `${Math.round(result.top_confidence * 100)}%` : '—'}</Badge>
                  <Badge tone="neutral">{result.latency_ms.toFixed(0)} ms inference</Badge>
                  <Badge tone="violet">suggested: {CATEGORY_LABELS[result.suggested_category]}</Badge>
                </div>

                <img
                  src={showOriginal ? result.original_url : result.annotated_url || result.original_url}
                  alt={`Road damage detection result (${result.detections_count} detections)`}
                  className="max-h-[380px] w-full rounded-lg border border-ink-200 object-contain dark:border-ink-800"
                />

                {result.detections_count === 0 ? (
                  <InlineNotice tone="info" title="Nothing above the confidence threshold">
                    The model produced no boxes at {result.conf_threshold.toFixed(2)} confidence. This can mean a clean
                    road, an unusual camera angle, or simply that this model was not trained for that damage type. You
                    can still submit a report — a reviewer will verify it.
                  </InlineNotice>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-ink-200 dark:border-ink-800">
                    <table className="table-base text-xs">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Class label</th>
                          <th>Confidence</th>
                          <th>Bounding box (px)</th>
                          <th>Share of frame</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.detections.map((detection, index) => (
                          <tr key={`${detection.class_label}-${index}`}>
                            <td className="text-ink-400">{index + 1}</td>
                            <td className="font-medium">{detection.class_label}</td>
                            <td className="tabular-nums">{Math.round(detection.confidence * 100)}%</td>
                            <td className="tabular-nums text-[10px] text-ink-500 dark:text-ink-400">
                              {Math.round(detection.bbox.x1)},{Math.round(detection.bbox.y1)} →{' '}
                              {Math.round(detection.bbox.x2)},{Math.round(detection.bbox.y2)}
                            </td>
                            <td className="tabular-nums">{(detection.area_ratio * 100).toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {result.warnings.map((warning) => (
                  <InlineNotice key={warning} tone="warning">
                    {warning}
                  </InlineNotice>
                ))}

                <InlineNotice tone="info" title="Model context">
                  <p>
                    {result.model_name} · version <code>{result.model_version}</code> · conf {result.conf_threshold} · IoU{' '}
                    {result.iou_threshold}
                  </p>
                  <p>Trained classes: {classList.map(([, label]) => label).join(', ')}</p>
                  <p>{result.notice}</p>
                </InlineNotice>

                <div className="flex flex-wrap justify-end gap-2">
                  <Link to="/report" state={{ analysis: result }}>
                    <Button size="sm" icon={<Crosshair className="h-3.5 w-3.5" />}>
                      Turn into a report
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Info className="h-5 w-5" />}
                title="No analysis yet"
                description="Choose a road photo and press “Run detection”. Results appear here with the annotated image, per-box confidence and latency."
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
