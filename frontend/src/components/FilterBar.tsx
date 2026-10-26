import { useState } from 'react';
import { Filter, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button, Checkbox, Field, Input, Select } from './ui';
import { CATEGORY_LABELS, SEVERITY_LABELS, STATUS_LABELS } from './badges';
import type { DamageCategory, ReportFilters, ReportStatus, Severity } from '../types';
import { useMeta } from '../context/AppProviders';

export interface FilterBarProps {
  filters: ReportFilters;
  onChange: (patch: Partial<ReportFilters>) => void;
  onReset: () => void;
  activeCount: number;
  showSearch?: boolean;
  showDates?: boolean;
  showPriority?: boolean;
  compact?: boolean;
}

export function FilterBar({
  filters,
  onChange,
  onReset,
  activeCount,
  showSearch = true,
  showDates = true,
  showPriority = false,
  compact = false,
}: FilterBarProps) {
  const { options } = useMeta();
  const [expanded, setExpanded] = useState(!compact);

  const statuses = (options?.statuses.map((item) => item.value) ?? Object.keys(STATUS_LABELS)) as ReportStatus[];
  const categories = (options?.categories.map((item) => item.value) ??
    Object.keys(CATEGORY_LABELS)) as DamageCategory[];
  const severities = (options?.severities.map((item) => item.value) ?? Object.keys(SEVERITY_LABELS)) as Severity[];

  const toggle = (key: 'status' | 'category' | 'severity', value: string) => {
    const current = (filters[key] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    onChange({ [key]: next } as Partial<ReportFilters>);
  };

  return (
    <div className="card mb-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {showSearch ? (
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              value={filters.q ?? ''}
              onChange={(event) => onChange({ q: event.target.value })}
              placeholder="Search reference, road, ward or description…"
              className="pl-8"
              aria-label="Search reports"
            />
          </div>
        ) : null}

        <Select
          value={filters.sort ?? 'reported_at'}
          onChange={(event) => onChange({ sort: event.target.value })}
          aria-label="Sort by"
          className="w-auto min-w-[9.5rem]"
        >
          <option value="reported_at">Newest first</option>
          <option value="priority_score">Priority score</option>
          <option value="detection_confidence">AI confidence</option>
          <option value="status">Status</option>
          <option value="reference">Reference</option>
        </Select>
        <Select
          value={filters.order ?? 'desc'}
          onChange={(event) => onChange({ order: event.target.value as 'asc' | 'desc' })}
          aria-label="Sort direction"
          className="w-auto"
        >
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </Select>

        <Button
          variant="outline"
          size="md"
          onClick={() => setExpanded((value) => !value)}
          icon={<SlidersHorizontal className="h-4 w-4" />}
          aria-expanded={expanded}
        >
          Filters{activeCount ? ` (${activeCount})` : ''}
        </Button>
        {activeCount > 0 ? (
          <Button variant="ghost" size="md" onClick={onReset} icon={<X className="h-4 w-4" />}>
            Clear
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-3 grid gap-4 border-t border-ink-100 pt-3 dark:border-ink-800 lg:grid-cols-3">
          <div>
            <p className="label">Status</p>
            <div className="flex flex-wrap gap-1.5">
              {statuses.map((status) => {
                const active = (filters.status ?? []).includes(status);
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggle('status', status)}
                    aria-pressed={active}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                      active
                        ? 'border-ember-500 bg-ember-50 text-ember-700 dark:bg-ember-950/60 dark:text-ember-200'
                        : 'border-ink-200 text-ink-600 hover:border-ink-300 dark:border-ink-700 dark:text-ink-300'
                    }`}
                  >
                    {STATUS_LABELS[status]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="label">Damage category</p>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((category) => {
                const active = (filters.category ?? []).includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => toggle('category', category)}
                    aria-pressed={active}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                      active
                        ? 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200'
                        : 'border-ink-200 text-ink-600 hover:border-ink-300 dark:border-ink-700 dark:text-ink-300'
                    }`}
                  >
                    {CATEGORY_LABELS[category]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="label">Severity</p>
            <div className="flex flex-wrap gap-1.5">
              {severities.map((severity) => {
                const active = (filters.severity ?? []).includes(severity);
                return (
                  <button
                    key={severity}
                    type="button"
                    onClick={() => toggle('severity', severity)}
                    aria-pressed={active}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                      active
                        ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-200'
                        : 'border-ink-200 text-ink-600 hover:border-ink-300 dark:border-ink-700 dark:text-ink-300'
                    }`}
                  >
                    {SEVERITY_LABELS[severity]}
                  </button>
                );
              })}
            </div>
          </div>

          {showDates ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="From date" htmlFor="date-from">
                <Input
                  id="date-from"
                  type="date"
                  value={filters.date_from?.slice(0, 10) ?? ''}
                  onChange={(event) =>
                    onChange({ date_from: event.target.value ? new Date(event.target.value).toISOString() : undefined })
                  }
                />
              </Field>
              <Field label="To date" htmlFor="date-to">
                <Input
                  id="date-to"
                  type="date"
                  value={filters.date_to?.slice(0, 10) ?? ''}
                  onChange={(event) =>
                    onChange({
                      date_to: event.target.value
                        ? new Date(`${event.target.value}T23:59:59`).toISOString()
                        : undefined,
                    })
                  }
                />
              </Field>
            </div>
          ) : null}

          {showPriority ? (
            <Field label={`Minimum priority score: ${filters.min_priority ?? 0}`} htmlFor="min-priority">
              <input
                id="min-priority"
                type="range"
                min={0}
                max={100}
                step={5}
                value={filters.min_priority ?? 0}
                onChange={(event) => onChange({ min_priority: Number(event.target.value) || undefined })}
                className="w-full accent-ember-500"
              />
            </Field>
          ) : null}

          <div className="space-y-2">
            <Checkbox
              id="include-demo"
              label="Include demo records"
              description="Synthetic data from the demo generator (badged DEMO)."
              checked={filters.include_synthetic ?? true}
              onChange={(checked) => onChange({ include_synthetic: checked })}
            />
            <Checkbox
              id="only-demo"
              label="Demo records only"
              description="Useful for project demonstrations without real submissions."
              checked={filters.only_synthetic ?? false}
              onChange={(checked) => onChange({ only_synthetic: checked })}
            />
          </div>
        </div>
      ) : null}
      <p className="mt-2 flex items-center gap-1 text-[11px] text-ink-400">
        <Filter className="h-3 w-3" /> Active filters apply to the table, KPIs and exports.
      </p>
    </div>
  );
}
