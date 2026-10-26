import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Camera,
  Clock,
  Copy,
  ExternalLink,
  History,
  Image as ImageIcon,
  Link2,
  MapPin,
  Pencil,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth, useToast } from '../context/AppProviders';
import { useAsync } from '../hooks/useAsync';
import { describeError } from '../services/api';
import { reportApi } from '../services/endpoints';
import type { ReportDetail, ReportStatus, Severity } from '../types';
import {
  CategoryBadge,
  ConfidenceMeter,
  DemoBadge,
  PriorityBadge,
  SEVERITY_LABELS,
  StatusBadge,
  STATUS_LABELS,
} from './badges';
import { Badge, Button, Field, InlineNotice, Input, KeyValue, Modal, ProgressBar, Select, Spinner, Textarea } from './ui';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AnnotatedImage({ report }: { report: ReportDetail }) {
  const image = report.images[0];
  const [variant, setVariant] = useState<'annotated' | 'original'>(
    image?.annotated_url ? 'annotated' : 'original',
  );
  if (!image) {
    return <InlineNotice tone="info">No photograph is attached to this report.</InlineNotice>;
  }
  const src = variant === 'annotated' && image.annotated_url ? image.annotated_url : image.original_url;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex gap-1" role="tablist" aria-label="Image variant">
          <button
            type="button"
            role="tab"
            aria-selected={variant === 'annotated'}
            disabled={!image.annotated_url}
            onClick={() => setVariant('annotated')}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
              variant === 'annotated'
                ? 'bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900'
                : 'border border-ink-200 text-ink-600 disabled:opacity-40 dark:border-ink-700 dark:text-ink-300'
            }`}
          >
            AI annotated
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={variant === 'original'}
            onClick={() => setVariant('original')}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
              variant === 'original'
                ? 'bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900'
                : 'border border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300'
            }`}
          >
            Original
          </button>
        </div>
        <span className="text-[11px] text-ink-500 dark:text-ink-400">
          {image.width}×{image.height}px · {Math.round(image.size_bytes / 1024)} KB
        </span>
      </div>
      <a href={src} target="_blank" rel="noreferrer noopener" className="group block">
        <img
          src={src}
          alt={`Road damage photograph for report ${report.reference}`}
          className="max-h-[280px] w-full rounded-lg border border-ink-200 object-contain dark:border-ink-800"
          loading="lazy"
        />
      </a>
      <p className="mt-1 flex items-center gap-1 text-[10px] text-ink-500 dark:text-ink-400">
        <ImageIcon className="h-3 w-3" />
        {variant === 'annotated' ? 'Boxes and labels drawn by the configured YOLO model.' : 'Original upload.'}
        {image.exif_gps_present ? ' EXIF GPS metadata was present in the original file.' : ''}
      </p>
    </div>
  );
}

function PriorityBreakdown({ report }: { report: ReportDetail }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label mb-0">Repair priority</span>
        <span className="text-xs font-semibold text-ink-700 dark:text-ink-200">
          {report.priority_score.toFixed(1)} / 100
        </span>
      </div>
      <ProgressBar value={report.priority_score} tone={report.priority_score >= 75 ? 'red' : 'ember'} />
      <ul className="mt-2.5 space-y-1.5">
        {report.priority_breakdown.map((factor) => (
          <li key={factor.key} className="text-[11px] leading-snug">
            <div className="flex items-center justify-between gap-2">
              <span className={factor.available ? 'font-medium text-ink-700 dark:text-ink-200' : 'text-ink-400 line-through'}>
                {factor.label}
              </span>
              <span className="tabular-nums text-ink-500 dark:text-ink-400">
                {factor.available ? `+${factor.contribution.toFixed(1)} pts` : 'not available'}
              </span>
            </div>
            <p className="text-ink-400 dark:text-ink-500">{factor.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface StatusActionProps {
  report: ReportDetail;
  onUpdated: (report: ReportDetail) => void;
}

function StatusActions({ report, onUpdated }: StatusActionProps) {
  const { canReview, user } = useAuth();
  const { push } = useToast();
  const [nextStatus, setNextStatus] = useState<ReportStatus | ''>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const transitions: ReportStatus[] = {
    submitted: ['under_review', 'rejected'],
    under_review: ['verified', 'rejected'],
    verified: ['assigned_for_repair', 'rejected'],
    assigned_for_repair: ['in_progress'],
    in_progress: ['resolved'],
    resolved: [],
    rejected: ['under_review'],
  }[report.status] as ReportStatus[];

  const submit = async () => {
    if (!nextStatus) return;
    setSaving(true);
    try {
      const updated = await reportApi.changeStatus(report.id, nextStatus as ReportStatus, notes || undefined);
      onUpdated(updated);
      push({
        variant: 'success',
        title: 'Status updated',
        description: `${report.reference} → ${STATUS_LABELS[nextStatus as ReportStatus]}`,
      });
      setNextStatus('');
      setNotes('');
    } catch (error) {
      const described = describeError(error);
      push({ variant: 'error', title: 'Could not update status', description: described.message });
    } finally {
      setSaving(false);
    }
  };

  if (!canReview) {
    return (
      <InlineNotice tone="info" title="Reviewer access required">
        Sign in as a reviewer or administrator to verify damage, assign repairs or resolve reports. Current view:{' '}
        {user ? user.role : 'public'}.
      </InlineNotice>
    );
  }

  if (!transitions.length) {
    return (
      <InlineNotice tone="success" title={`Report ${STATUS_LABELS[report.status]}`}>
        This report reached a terminal state. Its status history is preserved below.
      </InlineNotice>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Next status" htmlFor="next-status">
          <Select
            id="next-status"
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value as ReportStatus)}
          >
            <option value="">Select…</option>
            {transitions.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="status-notes" hint="Required when rejecting a report.">
          <Input
            id="status-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. verified on site by ward inspector"
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} loading={saving} disabled={!nextStatus} icon={<ArrowRight className="h-3.5 w-3.5" />}>
          Apply transition
        </Button>
      </div>
    </div>
  );
}

function EditDialog({
  report,
  open,
  onClose,
  onSaved,
}: {
  report: ReportDetail;
  open: boolean;
  onClose: () => void;
  onSaved: (report: ReportDetail) => void;
}) {
  const { push } = useToast();
  const [form, setForm] = useState({
    description: report.description ?? '',
    road_name: report.road_name ?? '',
    ward: report.ward ?? '',
    damage_category: report.damage_category,
    reviewed_severity: report.reviewed_severity ?? '',
    road_importance: report.road_importance,
    latitude: report.latitude ?? 0,
    longitude: report.longitude ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        description: form.description || null,
        road_name: form.road_name || null,
        ward: form.ward || null,
        damage_category: form.damage_category,
        road_importance: form.road_importance,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      };
      if (form.reviewed_severity) payload.reviewed_severity = form.reviewed_severity as Severity;
      const updated = await reportApi.update(report.id, payload);
      onSaved(updated);
      push({ variant: 'success', title: 'Report updated', description: 'Changes were written to the audit log.' });
      onClose();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${report.reference}`}
      description="Only reviewers and administrators can change these fields. Every change is audited."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} size="sm">
            Cancel
          </Button>
          <Button onClick={save} loading={saving} size="sm">
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
        <Field label="Description" htmlFor="edit-description">
          <Textarea
            id="edit-description"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Road / landmark" htmlFor="edit-road">
            <Input id="edit-road" value={form.road_name} onChange={(event) => setForm({ ...form, road_name: event.target.value })} />
          </Field>
          <Field label="Ward / area" htmlFor="edit-ward">
            <Input id="edit-ward" value={form.ward} onChange={(event) => setForm({ ...form, ward: event.target.value })} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Damage category" htmlFor="edit-category">
            <Select
              id="edit-category"
              value={form.damage_category}
              onChange={(event) => setForm({ ...form, damage_category: event.target.value as ReportDetail['damage_category'] })}
            >
              {Object.entries({
                pothole: 'Pothole',
                longitudinal_crack: 'Longitudinal crack',
                transverse_crack: 'Transverse crack',
                alligator_crack: 'Alligator crack',
                broken_surface: 'Broken surface',
                other: 'Other',
                unknown: 'Unclassified',
              }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reviewed severity" htmlFor="edit-severity">
            <Select
              id="edit-severity"
              value={form.reviewed_severity}
              onChange={(event) => setForm({ ...form, reviewed_severity: event.target.value })}
            >
              <option value="">Not rated</option>
              {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Latitude" htmlFor="edit-lat">
            <Input
              id="edit-lat"
              type="number"
              step="0.000001"
              value={form.latitude}
              onChange={(event) => setForm({ ...form, latitude: Number(event.target.value) })}
            />
          </Field>
          <Field label="Longitude" htmlFor="edit-lng">
            <Input
              id="edit-lng"
              type="number"
              step="0.000001"
              value={form.longitude}
              onChange={(event) => setForm({ ...form, longitude: Number(event.target.value) })}
            />
          </Field>
        </div>
        <Field label="Road importance" htmlFor="edit-importance" hint="Used by the priority score; treat as unverified unless supplied by an authority.">
          <Select
            id="edit-importance"
            value={form.road_importance}
            onChange={(event) => setForm({ ...form, road_importance: event.target.value as ReportDetail['road_importance'] })}
          >
            <option value="local">Local</option>
            <option value="collector">Collector</option>
            <option value="arterial">Arterial</option>
            <option value="highway">Highway</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function DuplicatesPanel({ reportId }: { reportId: string }) {
  const { canReview } = useAuth();
  const { push } = useToast();
  const duplicates = useAsync(() => reportApi.duplicates(reportId), [reportId]);
  const [linking, setLinking] = useState<string | null>(null);

  const link = async (candidateId: string) => {
    setLinking(candidateId);
    try {
      await reportApi.linkDuplicate(reportId, candidateId, 'Linked by reviewer from the duplicate panel');
      duplicates.reload();
      push({ variant: 'success', title: 'Duplicate linked', description: 'Both reports are preserved in the audit trail.' });
    } catch (error) {
      push({ variant: 'error', title: 'Link failed', description: describeError(error).message });
    } finally {
      setLinking(null);
    }
  };

  return (
    <div className="space-y-2">
      {duplicates.loading ? <Spinner label="Checking for duplicates" /> : null}
      {duplicates.error ? <InlineNotice tone="danger">{duplicates.error}</InlineNotice> : null}
      {duplicates.data ? (
        <>
          <p className="text-[11px] leading-snug text-ink-500 dark:text-ink-400">{duplicates.data.method}</p>
          {duplicates.data.linked.length ? (
            <ul className="space-y-1">
              {duplicates.data.linked.map((linkRow) => (
                <li key={linkRow.id} className="flex items-center gap-1.5 text-[11px] text-ink-600 dark:text-ink-300">
                  <Link2 className="h-3 w-3" /> {linkRow.duplicate_reference} linked (similarity {linkRow.similarity.toFixed(2)})
                </li>
              ))}
            </ul>
          ) : null}
          {duplicates.data.candidates.length === 0 ? (
            <p className="text-[11px] text-ink-500 dark:text-ink-400">No nearby reports found within the proximity window.</p>
          ) : (
            <ul className="space-y-1.5">
              {duplicates.data.candidates.map((candidate) => (
                <li
                  key={candidate.report.id}
                  className="rounded-lg border border-ink-200 p-2 dark:border-ink-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-ink-800 dark:text-ink-100">
                      {candidate.report.reference}
                    </span>
                    <Badge tone="warning">match {Math.round(candidate.score * 100)}%</Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-400">{candidate.reasons.join(' · ')}</p>
                  {canReview ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1.5"
                      loading={linking === candidate.report.id}
                      onClick={() => link(candidate.report.id)}
                      icon={<Copy className="h-3 w-3" />}
                    >
                      Link as duplicate
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

export function ReportDetailPanel({
  reportId,
  onClose,
  onChanged,
  embedded = false,
}: {
  reportId: string;
  onClose?: () => void;
  onChanged?: () => void;
  embedded?: boolean;
}) {
  const state = useAsync(() => reportApi.get(reportId), [reportId]);
  const [current, setCurrent] = useState<ReportDetail | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (state.data) setCurrent(state.data);
  }, [state.data]);

  const report = current ?? state.data;

  const handleUpdated = (updated: ReportDetail) => {
    setCurrent(updated);
    state.reload();
    onChanged?.();
  };

  const body = (
    <>
      {state.loading && !report ? <Spinner label="Loading report" /> : null}
      {state.error ? <InlineNotice tone="danger">{state.error}</InlineNotice> : null}
      {report ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-base font-bold text-ink-900 dark:text-white">{report.reference}</h3>
                <DemoBadge show={report.is_synthetic} />
                {report.duplicate_of_id ? <Badge tone="neutral">Duplicate linked</Badge> : null}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-500 dark:text-ink-400">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatDate(report.reported_at)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {report.latitude !== null && report.longitude !== null
                    ? `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`
                    : 'no coordinates'}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Camera className="h-3 w-3" /> {report.location_source ?? 'unknown source'}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={report.status} />
              <CategoryBadge category={report.damage_category} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <AnnotatedImage report={report} />
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-2">
                <KeyValue label="Reviewed severity" value={report.reviewed_severity ? SEVERITY_LABELS[report.reviewed_severity] : 'Not rated'} />
                <KeyValue label="Priority" value={<span className="inline-flex items-center gap-1"><PriorityBadge score={report.priority_score} /> <span className="text-[11px] text-ink-400">/100</span></span>} />
                <KeyValue label="AI confidence" value={<ConfidenceMeter value={report.detection_confidence} />} />
                <KeyValue label="Detections" value={report.detections.length} />
                <KeyValue label="Road" value={report.road_name ?? '—'} />
                <KeyValue label="Ward" value={report.ward ?? '—'} />
                <KeyValue label="Road importance" value={report.road_importance} />
                <KeyValue label="Verified" value={report.is_verified ? 'Yes' : 'No'} />
              </dl>
              {report.latitude !== null && report.longitude !== null ? (
                <a
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-ember-600 hover:underline dark:text-ember-400"
                  href={`https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=18/${report.latitude}/${report.longitude}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <ExternalLink className="h-3 w-3" /> Open in OpenStreetMap
                </a>
              ) : null}
            </div>
          </div>

          {report.description ? (
            <div>
              <p className="label">Citizen description</p>
              <p className="rounded-lg bg-ink-50 p-2.5 text-xs leading-relaxed text-ink-700 dark:bg-ink-800/60 dark:text-ink-200">
                {report.description}
              </p>
            </div>
          ) : null}

          {report.detections.length ? (
            <div>
              <p className="label">Detection results (real model output)</p>
              <div className="overflow-hidden rounded-lg border border-ink-200 dark:border-ink-800">
                <table className="table-base text-xs">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Confidence</th>
                      <th>Box (px)</th>
                      <th>Area</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.detections.map((detection) => (
                      <tr key={detection.id}>
                        <td className="font-medium">{detection.class_label}</td>
                        <td className="tabular-nums">{Math.round(detection.confidence * 100)}%</td>
                        <td className="tabular-nums text-[10px] text-ink-500 dark:text-ink-400">
                          {Math.round(detection.bbox_x1)},{Math.round(detection.bbox_y1)} →{' '}
                          {Math.round(detection.bbox_x2)},{Math.round(detection.bbox_y2)}
                        </td>
                        <td className="tabular-nums">{(detection.area_ratio * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-ink-500 dark:text-ink-400">
                Model: {report.detections[0].model_version}. Confidence reflects the model, not the danger of the damage.
              </p>
            </div>
          ) : null}

          <PriorityBreakdown report={report} />

          <div>
            <p className="label">Status &amp; repair history</p>
            {report.repair_updates.length === 0 ? (
              <p className="text-[11px] text-ink-500 dark:text-ink-400">No status transitions recorded yet.</p>
            ) : (
              <ol className="space-y-2 border-l border-ink-200 pl-3 dark:border-ink-700">
                {report.repair_updates.map((update) => (
                  <li key={update.id} className="relative">
                    <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-ember-500" />
                    <p className="text-[11px] font-semibold text-ink-800 dark:text-ink-100">
                      {STATUS_LABELS[update.previous_status]} → {STATUS_LABELS[update.new_status]}
                    </p>
                    <p className="text-[10px] text-ink-500 dark:text-ink-400">
                      {formatDate(update.created_at)} · {update.actor_label ?? 'system'}
                    </p>
                    {update.notes ? <p className="mt-0.5 text-[11px] text-ink-600 dark:text-ink-300">{update.notes}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="rounded-lg border border-ink-200 p-2.5 dark:border-ink-800">
            <p className="label mb-1.5 flex items-center gap-1">
              <History className="h-3 w-3" /> Audit trail
            </p>
            <ul className="max-h-36 space-y-1 overflow-y-auto">
              {report.audit_trail.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-2 text-[10px] text-ink-500 dark:text-ink-400">
                  <span>
                    <span className="font-semibold text-ink-700 dark:text-ink-200">{entry.action}</span> ·{' '}
                    {entry.actor_label ?? 'system'}
                  </span>
                  <span className="whitespace-nowrap">{formatDate(entry.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="label flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" /> Lifecycle action
            </p>
            <StatusActions report={report} onUpdated={handleUpdated} />
          </div>

          <div>
            <p className="label flex items-center gap-1">
              <Copy className="h-3 w-3" /> Duplicate assistance
            </p>
            <DuplicatesPanel reportId={report.id} />
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
            <Button variant="outline" size="sm" onClick={() => state.reload()} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
            {useAuth().canReview ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)} icon={<Pencil className="h-3.5 w-3.5" />}>
                Edit review fields
              </Button>
            ) : null}
          </div>

          {editing ? (
            <EditDialog report={report} open={editing} onClose={() => setEditing(false)} onSaved={handleUpdated} />
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="card card-pad">{body}</div>;
  }

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end bg-ink-950/50 backdrop-blur-sm">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-pop dark:bg-ink-900">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-ink-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-ink-800 dark:bg-ink-900/95">
          <p className="text-sm font-semibold text-ink-900 dark:text-white">Report details</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-500 transition hover:bg-ink-100 dark:hover:bg-ink-800"
            aria-label="Close report details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{body}</div>
      </div>
    </div>
  );
}
