import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Crosshair,
  LocateFixed,
  MapPin,
  RotateCcw,
  Send,
  Sparkles,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { useMeta, useToast } from '../context/AppProviders';
import { useGeolocation } from '../hooks/useGeolocation';
import { describeError } from '../services/api';
import { detectionApi, reportApi } from '../services/endpoints';
import type { AnalyzeResponse, DamageCategory, ReportDetail, Severity } from '../types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Field,
  InlineNotice,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';
import { MapView } from '../components/MapView';
import { CATEGORY_LABELS } from '../components/badges';

const ACCEPTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

interface FormState {
  description: string;
  damage_category: DamageCategory | '';
  reviewed_severity: Severity | '';
  road_importance: 'local' | 'collector' | 'arterial' | 'highway';
  road_name: string;
  ward: string;
  latitude: string;
  longitude: string;
  reporter_label: string;
}

export function ReportDamagePage() {
  const { options } = useMeta();
  const { push } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const preloaded = (location.state as { analysis?: AnalyzeResponse } | null)?.analysis ?? null;

  const inputRef = useRef<HTMLInputElement>(null);
  const geo = useGeolocation();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(preloaded);
  const [analyzing, setAnalyzing] = useState(false);
  const [detectionError, setDetectionError] = useState<{ message: string; hints: string[] } | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<ReportDetail | null>(null);
  const [consentExif, setConsentExif] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const defaultCenter = options?.map_defaults ?? { lat: 23.0225, lng: 72.5714, zoom: 12 };

  const [form, setForm] = useState<FormState>({
    description: '',
    damage_category: '',
    reviewed_severity: '',
    road_importance: 'collector',
    road_name: '',
    ward: '',
    latitude: '',
    longitude: '',
    reporter_label: '',
  });

  useEffect(() => {
    if (preloaded?.suggested_category && preloaded.suggested_category !== 'unknown') {
      setForm((prev) => ({
        ...prev,
        damage_category: prev.damage_category || (preloaded.suggested_category as DamageCategory),
        description: prev.description,
      }));
    }
  }, [preloaded]);

  useEffect(() => {
    if (geo.lat !== null && geo.lng !== null) {
      setForm((prev) => ({ ...prev, latitude: geo.lat!.toFixed(6), longitude: geo.lng!.toFixed(6) }));
    }
  }, [geo.lat, geo.lng]);

  const pin = useMemo(() => {
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  }, [form.latitude, form.longitude]);

  const center = pin ?? { lat: defaultCenter.lat, lng: defaultCenter.lng };

  const handleFile = useCallback(
    async (incoming: File | null) => {
      setDetectionError(null);
      setValidation(null);
      setAnalysis(null);
      if (!incoming) return;
      if (!ACCEPTED.includes(incoming.type)) {
        setValidation('Please choose a JPG, JPEG, PNG or WEBP photograph.');
        return;
      }
      if (incoming.size > 10 * 1024 * 1024) {
        setValidation('That file is larger than 10 MB. Please choose a smaller photograph.');
        return;
      }
      setFile(incoming);
      setPreviewUrl(URL.createObjectURL(incoming));
      setAnalyzing(true);
      try {
        const result = await detectionApi.analyze(incoming);
        setAnalysis(result);
        if (result.suggested_category && result.suggested_category !== 'unknown') {
          setForm((prev) => ({ ...prev, damage_category: result.suggested_category }));
        }
      } catch (error) {
        const described = describeError(error);
        setDetectionError(described);
      } finally {
        setAnalyzing(false);
      }
    },
    [],
  );

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!form.latitude || !form.longitude) {
      errors.location = 'Set a location with the GPS button or by clicking the map.';
    } else if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.location = 'Latitude and longitude must be numbers.';
    } else if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      errors.location = 'Coordinates are outside the valid range.';
    } else if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) {
      errors.location = '(0, 0) is not a valid road location.';
    }
    if (form.description.length > 2000) errors.description = 'Keep the description under 2000 characters.';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        location_source: geo.status === 'granted' && geo.lat !== null ? 'gps' : 'manual',
        description: form.description || undefined,
        road_name: form.road_name || undefined,
        ward: form.ward || undefined,
        road_importance: form.road_importance,
        reporter_label: form.reporter_label || undefined,
      };
      if (analysis) payload.analysis_id = analysis.analysis_id;
      if (form.damage_category) payload.damage_category = form.damage_category;
      if (form.reviewed_severity) payload.reviewed_severity = form.reviewed_severity;
      const report = await reportApi.create(payload);
      setCreated(report);
      push({
        variant: 'success',
        title: 'Report submitted',
        description: `Reference ${report.reference} is now on the map and in the report register.`,
      });
    } catch (error) {
      const described = describeError(error);
      push({ variant: 'error', title: 'Submission failed', description: described.message });
      setFormErrors({ submit: described.message });
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="card-pad text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-bold text-ink-900 dark:text-white">Report submitted successfully</h1>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
            Your reference ID is{' '}
            <span className="font-mono text-base font-bold text-ember-600 dark:text-ember-400">{created.reference}</span>
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-ink-500 dark:text-ink-400">
            Status: {created.status.replace(/_/g, ' ')}. Damage category:{' '}
            {CATEGORY_LABELS[created.damage_category]}. Priority score: {created.priority_score.toFixed(1)}. A reviewer
            verifies the damage before any repair decision is made.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Link to={`/reports/${created.id}`}>
              <Button size="sm">View report</Button>
            </Link>
            <Link to="/map">
              <Button size="sm" variant="outline">
                See it on the map
              </Button>
            </Link>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreated(null);
                setFile(null);
                setPreviewUrl(null);
                setAnalysis(null);
                setForm({
                  description: '',
                  damage_category: '',
                  reviewed_severity: '',
                  road_importance: 'collector',
                  road_name: '',
                  ward: '',
                  latitude: '',
                  longitude: '',
                  reporter_label: '',
                });
              }}
            >
              Report another issue
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Citizen & field reporting"
        title="Report road damage"
        description="Upload a photograph, confirm the detected damage, then position the issue on the map. GPS is optional — manual pin placement always works."
      />

      <form onSubmit={submit} className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <Card>
            <CardHeader
              title="1 · Photograph & AI detection"
              description="The photo is validated and analysed by the configured model. You can submit without AI results if the model is unavailable."
              icon={<Sparkles className="h-4 w-4" />}
            />
            <div className="card-pad space-y-3">
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleFile(event.dataTransfer.files?.[0] ?? null);
                }}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300 px-4 py-6 text-center dark:border-ink-700"
              >
                <UploadCloud className="h-6 w-6 text-ink-400" />
                <p className="text-xs font-semibold text-ink-700 dark:text-ink-200">Drop a road photo or browse</p>
                <p className="text-[11px] text-ink-500 dark:text-ink-400">JPG · PNG · WEBP, max 10 MB</p>
                <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
                  Choose file
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED.join(',')}
                  className="hidden"
                  aria-label="Road damage photograph"
                  onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
                />
              </div>

              {validation ? <InlineNotice tone="danger">{validation}</InlineNotice> : null}
              {detectionError ? (
                <InlineNotice tone="warning" title={detectionError.message}>
                  <p>You can still submit the report without AI results — a reviewer will check it.</p>
                  {detectionError.hints.map((hint) => (
                    <p key={hint}>{hint}</p>
                  ))}
                </InlineNotice>
              ) : null}

              {analyzing ? (
                <InlineNotice tone="info">Running detection on your photograph…</InlineNotice>
              ) : null}

              {previewUrl ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="label mb-1">Your upload</p>
                    <img src={previewUrl} alt="Uploaded road photograph" className="max-h-52 w-full rounded-lg object-contain" />
                  </div>
                  {analysis ? (
                    <div>
                      <p className="label mb-1">AI annotated</p>
                      <img
                        src={analysis.annotated_url || analysis.original_url}
                        alt="Detected road damage with bounding boxes"
                        className="max-h-52 w-full rounded-lg object-contain"
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {analysis ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={analysis.detections_count ? 'success' : 'warning'}>
                    {analysis.detections_count} detection(s)
                  </Badge>
                  <Badge tone="info">
                    top confidence{' '}
                    {analysis.top_confidence !== null ? `${Math.round(analysis.top_confidence * 100)}%` : '—'}
                  </Badge>
                  <Badge tone="neutral">{analysis.latency_ms.toFixed(0)} ms</Badge>
                  <Badge tone="violet">suggested {CATEGORY_LABELS[analysis.suggested_category]}</Badge>
                  {analysis.image.exif_gps_present ? <Badge tone="warning">EXIF GPS present</Badge> : null}
                </div>
              ) : null}

              {analysis?.image.exif_gps_present ? (
                <InlineNotice tone="warning" title="This photo contains embedded GPS metadata">
                  <p>
                    The camera recorded a location in the image EXIF block. We do not use it automatically and we do not
                    store it: images are re-encoded without metadata on save. If you want that position, place the pin
                    yourself.
                  </p>
                  <Checkbox
                    id="exif-consent"
                    label="I understand EXIF location is not used and will not be retained"
                    checked={consentExif}
                    onChange={setConsentExif}
                  />
                </InlineNotice>
              ) : null}

              {!file ? (
                <InlineNotice tone="info" title="Photographs do not contain a location by default">
                  A normal road photo carries no coordinates unless the camera wrote EXIF GPS. Always confirm the
                  location yourself below.
                </InlineNotice>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="2 · Damage details" description="The AI suggestion is editable before submission." icon={<MapPin className="h-4 w-4" />} />
            <div className="card-pad space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Damage category" htmlFor="category" hint="Pre-filled from the strongest detection when available.">
                  <Select
                    id="category"
                    value={form.damage_category}
                    onChange={(event) => update({ damage_category: event.target.value as DamageCategory | '' })}
                  >
                    <option value="">Let the reviewer decide</option>
                    {options?.categories.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Severity assessment (optional)" htmlFor="severity" hint="Your impression — a reviewer confirms it.">
                  <Select
                    id="severity"
                    value={form.reviewed_severity}
                    onChange={(event) => update({ reviewed_severity: event.target.value as Severity | '' })}
                  >
                    <option value="">Not assessed</option>
                    {options?.severities.map((severity) => (
                      <option key={severity.value} value={severity.value}>
                        {severity.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label="Description (optional)"
                htmlFor="description"
                error={formErrors.description}
                hint={`${form.description.length}/2000 characters`}
              >
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(event) => update({ description: event.target.value })}
                  placeholder="e.g. Deep pothole in the middle lane near the bus stop, hard to see at night."
                  invalid={Boolean(formErrors.description)}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Road name or landmark" htmlFor="road">
                  <Input
                    id="road"
                    value={form.road_name}
                    onChange={(event) => update({ road_name: event.target.value })}
                    placeholder="e.g. Ashram Road, near Nehru Bridge"
                  />
                </Field>
                <Field label="Ward / area (optional)" htmlFor="ward">
                  <Input id="ward" value={form.ward} onChange={(event) => update({ ward: event.target.value })} placeholder="e.g. Navrangpura" />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Road importance" htmlFor="importance" hint="Feeds the priority score — not officially verified.">
                  <Select
                    id="importance"
                    value={form.road_importance}
                    onChange={(event) => update({ road_importance: event.target.value as FormState['road_importance'] })}
                  >
                    <option value="local">Local street</option>
                    <option value="collector">Collector road</option>
                    <option value="arterial">Arterial road</option>
                    <option value="highway">Highway</option>
                  </Select>
                </Field>
                <Field label="Your name or label (optional)" htmlFor="reporter" hint="Avoid sharing personal information.">
                  <Input id="reporter" value={form.reporter_label} onChange={(event) => update({ reporter_label: event.target.value })} placeholder="e.g. Resident, Sector 7" />
                </Field>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader
              title="3 · Location"
              description="Use GPS if you are on site, or click the map to drop the pin manually."
              icon={<LocateFixed className="h-4 w-4" />}
            />
            <div className="card-pad space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={geo.request}
                  loading={geo.status === 'requesting'}
                  icon={<Crosshair className="h-3.5 w-3.5" />}
                >
                  Use my GPS location
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    geo.reset();
                    update({ latitude: '', longitude: '' });
                  }}
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                >
                  Clear
                </Button>
              </div>

              {geo.error ? (
                <InlineNotice tone="warning" title="Location not available">
                  {geo.error}
                </InlineNotice>
              ) : null}
              {geo.status === 'granted' && geo.accuracy !== null ? (
                <InlineNotice tone="success" title="GPS position captured">
                  ±{Math.round(geo.accuracy)} m accuracy. Drag or click the map to correct it if needed.
                </InlineNotice>
              ) : null}

              <MapView
                center={center}
                zoom={pin ? 16 : defaultCenter.zoom}
                pin={pin}
                height="300px"
                onPick={(lat, lng) => update({ latitude: lat.toFixed(6), longitude: lng.toFixed(6) })}
              />
              <p className="text-[11px] text-ink-500 dark:text-ink-400">
                Click anywhere on the map to place the pin. Map data © OpenStreetMap contributors.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Latitude" htmlFor="lat" error={formErrors.location}>
                  <Input
                    id="lat"
                    inputMode="decimal"
                    value={form.latitude}
                    onChange={(event) => update({ latitude: event.target.value })}
                    placeholder="23.022500"
                    invalid={Boolean(formErrors.location)}
                  />
                </Field>
                <Field label="Longitude" htmlFor="lng">
                  <Input
                    id="lng"
                    inputMode="decimal"
                    value={form.longitude}
                    onChange={(event) => update({ longitude: event.target.value })}
                    placeholder="72.571400"
                    invalid={Boolean(formErrors.location)}
                  />
                </Field>
              </div>
              {pin ? (
                <p className="text-[11px] text-ink-500 dark:text-ink-400">
                  Pin at {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="4 · Submit" description="A reference ID is generated immediately." icon={<Send className="h-4 w-4" />} />
            <div className="card-pad space-y-3">
              {formErrors.submit ? <InlineNotice tone="danger">{formErrors.submit}</InlineNotice> : null}
              {formErrors.location ? <InlineNotice tone="danger">{formErrors.location}</InlineNotice> : null}
              <InlineNotice tone="info" title="What happens next">
                <p>The report starts as “Submitted”. A reviewer inspects the photo and location, may correct details, and verifies the damage.</p>
                <p>Only verified cases enter the repair priority queue.</p>
              </InlineNotice>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => navigate('/reports')}
                  icon={<XCircle className="h-3.5 w-3.5" />}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={submitting} icon={<Send className="h-4 w-4" />}>
                  Submit report
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </form>
    </div>
  );
}
