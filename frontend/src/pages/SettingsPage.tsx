import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, Gauge, Lock, Moon, Save, Server, ShieldCheck, Sun, Wrench } from 'lucide-react';
import { useAuth, useMeta, useTheme, useToast } from '../context/AppProviders';
import { useAsync } from '../hooks/useAsync';
import { describeError } from '../services/api';
import { metaApi, settingsApi } from '../services/endpoints';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  InlineNotice,
  Input,
  KeyValue,
  PageHeader,
  Spinner,
} from '../components/ui';

const WEIGHT_LABELS: Record<string, string> = {
  severity: 'Reviewed severity',
  category: 'Damage category',
  road_importance: 'Road importance',
  damage_size: 'Detected damage size',
  report_age: 'Age of unresolved report',
  repeat_reports: 'Nearby verified reports',
};

export function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { user, isAdmin, canReview } = useAuth();
  const { push } = useToast();
  const { options } = useMeta();
  const priority = useAsync(() => settingsApi.priority(), []);
  const health = useAsync(() => metaApi.health(), []);
  const [weights, setWeights] = useState<Record<string, number> | null>(null);
  const [ageDays, setAgeDays] = useState<number>(30);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (priority.data) {
      setWeights(priority.data.weights);
      setAgeDays(priority.data.age_full_days);
    }
  }, [priority.data]);

  const totalWeight = weights ? Object.values(weights).reduce((sum, value) => sum + value, 0) : 0;

  const save = async () => {
    if (!weights) return;
    setSaving(true);
    try {
      const updated = await settingsApi.updatePriority({ weights, age_full_days: ageDays });
      priority.reload();
      push({
        variant: 'success',
        title: 'Priority configuration saved',
        description: 'Scores were recomputed for every stored report.',
      });
      setWeights(updated.weights);
    } catch (error) {
      push({ variant: 'error', title: 'Could not save settings', description: describeError(error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Appearance, priority scoring rules and environment diagnostics. Restricted controls are disabled for your role."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Appearance" icon={theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />} />
          <div className="card-pad space-y-2">
            <p className="text-xs text-ink-600 dark:text-ink-300">
              Current theme: <strong>{theme}</strong>. The preference is stored locally in your browser.
            </p>
            <Button variant="outline" size="sm" onClick={toggleTheme} icon={theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}>
              Switch to {theme === 'dark' ? 'light' : 'dark'} theme
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Account" icon={<ShieldCheck className="h-4 w-4" />} />
          <div className="card-pad space-y-2 text-xs text-ink-600 dark:text-ink-300">
            {user ? (
              <dl className="space-y-1.5">
                <KeyValue label="Signed in as" value={user.name} />
                <KeyValue label="Email" value={user.email} />
                <KeyValue label="Role" value={<Badge tone={isAdmin ? 'violet' : canReview ? 'info' : 'neutral'}>{user.role}</Badge>} />
                <KeyValue label="Member since" value={new Date(user.created_at).toLocaleDateString()} />
              </dl>
            ) : (
              <div className="space-y-2">
                <p>You are browsing without an account. Reporting works, but review actions require a reviewer login.</p>
                <Link to="/login">
                  <Button size="sm" variant="outline" icon={<Lock className="h-3.5 w-3.5" />}>
                    Sign in
                  </Button>
                </Link>
              </div>
            )}
            {!canReview && user ? (
              <InlineNotice tone="info">Citizen accounts can submit reports only. Reviewer actions are role-gated server-side.</InlineNotice>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="System status" icon={<Server className="h-4 w-4" />} />
          <div className="card-pad">
            {health.loading ? (
              <Spinner label="Checking backend" />
            ) : health.error ? (
              <InlineNotice tone="danger">{health.error}</InlineNotice>
            ) : health.data ? (
              <dl className="space-y-1.5 text-xs">
                <KeyValue label="API" value={<Badge tone={health.data.status === 'ok' ? 'success' : 'warning'}>{health.data.status}</Badge>} />
                <KeyValue label="Database" value={<Badge tone={health.data.database.ok ? 'success' : 'danger'}>{health.data.database.ok ? 'connected' : 'error'}</Badge>} />
                <KeyValue label="Detector" value={<Badge tone={health.data.detector.available ? 'success' : 'warning'}>{health.data.detector.available ? 'loaded' : 'unavailable'}</Badge>} />
                <KeyValue label="Model version" value={health.data.detector.model_version} />
                <KeyValue label="Reports (real / demo)" value={`${health.data.reports.real} / ${health.data.reports.synthetic}`} />
                <KeyValue label="Environment" value={health.data.environment} />
              </dl>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Repair priority configuration"
          description="Weights feed the explainable score. They are configuration, not ground truth — administrative decisions still require human verification."
          icon={<Gauge className="h-4 w-4" />}
          actions={<Badge tone={isAdmin ? 'violet' : 'neutral'}>{isAdmin ? 'admin editable' : 'read only'}</Badge>}
        />
        <div className="card-pad">
          {priority.loading ? (
            <Spinner label="Loading priority settings" />
          ) : priority.error ? (
            <InlineNotice tone="danger">{priority.error}</InlineNotice>
          ) : weights ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(weights).map(([key, value]) => (
                  <Field key={key} label={`${WEIGHT_LABELS[key] ?? key} (${value.toFixed(2)})`} htmlFor={`weight-${key}`}>
                    <input
                      id={`weight-${key}`}
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={value}
                      disabled={!isAdmin}
                      onChange={(event) => setWeights({ ...weights, [key]: Number(event.target.value) })}
                      className="w-full accent-ember-500 disabled:opacity-50"
                    />
                  </Field>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Age saturation (days)" htmlFor="age-days" hint="An unresolved report reaches full age weight after this many days.">
                  <Input
                    id="age-days"
                    type="number"
                    min={1}
                    max={365}
                    value={ageDays}
                    disabled={!isAdmin}
                    onChange={(event) => setAgeDays(Number(event.target.value))}
                  />
                </Field>
                <div className="rounded-lg border border-ink-200 p-3 text-xs dark:border-ink-800">
                  <p className="text-ink-500 dark:text-ink-400">
                    Configured weights sum to <strong>{totalWeight.toFixed(2)}</strong>. Scores are renormalised over the
                    factors available for each report, so a missing value never silently counts as “low risk”.
                  </p>
                  <p className="mt-1 text-ink-500 dark:text-ink-400">
                    Duplicate detection window: {priority.data?.duplicate_radius_m} m / {priority.data?.duplicate_window_days} days.
                  </p>
                </div>
              </div>
              {isAdmin ? (
                <div className="flex justify-end">
                  <Button onClick={save} loading={saving} icon={<Save className="h-3.5 w-3.5" />}>
                    Save &amp; recompute
                  </Button>
                </div>
              ) : (
                <InlineNotice tone="info">
                  Sign in as an administrator to change these weights. Runtime overrides are not persisted to the
                  environment file — set <code>ROADGUARD_PRIORITY_*</code> variables for permanent changes.
                </InlineNotice>
              )}
            </div>
          ) : null}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Environment reference" icon={<Database className="h-4 w-4" />} />
          <div className="card-pad">
            <ul className="space-y-1.5 text-[11px] text-ink-600 dark:text-ink-300">
              {[
                ['ROADGUARD_MODEL_PATH', 'Path to the YOLO weight file'],
                ['ROADGUARD_CONF_THRESHOLD', 'Default confidence threshold'],
                ['ROADGUARD_IOU_THRESHOLD', 'NMS IoU threshold'],
                ['ROADGUARD_DEVICE', 'cpu or cuda'],
                ['ROADGUARD_MAX_UPLOAD_MB', 'Upload size limit'],
                ['ROADGUARD_JWT_SECRET', 'Token signing secret (set in production!)'],
                ['ROADGUARD_CORS_ORIGINS', 'Comma separated allowed origins'],
              ].map(([key, description]) => (
                <li key={key} className="flex flex-wrap justify-between gap-2 border-b border-ink-100 pb-1 last:border-0 dark:border-ink-800">
                  <code className="font-mono text-[10px] text-ember-600 dark:text-ember-400">{key}</code>
                  <span className="text-ink-500 dark:text-ink-400">{description}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-500 dark:text-ink-400">
              All runtime configuration lives in <code>.env</code>; nothing is hardcoded. Copy <code>.env.example</code>{' '}
              to get started.
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Operational notes" icon={<Wrench className="h-4 w-4" />} />
          <div className="card-pad space-y-2 text-[11px] text-ink-600 dark:text-ink-300">
            <p>• Demo dataset: <code>python -m app.services.demo_data --count 120</code> · purge with <code>--purge</code>.</p>
            <p>• Priority weights changed here are runtime-only; restart restores the .env values.</p>
            <p>• Rate limiting runs in-process. Behind a load balancer, enforce limits at the proxy.</p>
            <p>• Uploaded photos are re-encoded on save, which strips EXIF metadata including GPS.</p>
            <p>• OpenStreetMap tiles follow the OSM usage policy; use a dedicated provider for production traffic.</p>
            <p>• Review actions require the reviewer or admin role and are recorded in the audit log.</p>
            {options ? (
              <p className="pt-1 text-ink-400">
                Demo region: {options.demo_region_label} · detection {options.detection_available ? 'available' : 'unavailable'}
              </p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
