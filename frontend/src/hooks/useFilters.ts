import { useCallback, useMemo, useState } from 'react';
import type { DamageCategory, ReportFilters, ReportStatus, Severity } from '../types';

export const EMPTY_FILTERS: ReportFilters = {
  q: '',
  status: [],
  category: [],
  severity: [],
  include_synthetic: true,
  sort: 'reported_at',
  order: 'desc',
  page: 1,
  page_size: 25,
};

export function useReportFilters(initial: Partial<ReportFilters> = {}) {
  const [filters, setFilters] = useState<ReportFilters>({ ...EMPTY_FILTERS, ...initial });

  const update = useCallback((patch: Partial<ReportFilters>) => {
    setFilters((prev) => {
      // Any filter change (other than paging) resets to page 1.
      const resetPage = Object.keys(patch).some((key) => key !== 'page' && key !== 'page_size');
      return { ...prev, ...patch, ...(resetPage ? { page: 1 } : {}) };
    });
  }, []);

  const toggleArrayValue = useCallback(
    (key: 'status' | 'category' | 'severity', value: string) => {
      setFilters((prev) => {
        const current = (prev[key] as string[] | undefined) ?? [];
        const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
        return { ...prev, [key]: next, page: 1 };
      });
    },
    [],
  );

  const reset = useCallback(() => setFilters({ ...EMPTY_FILTERS, ...initial }), [initial]);

  const activeCount = useMemo(() => {
    let count = 0;
    if (filters.q) count += 1;
    count += filters.status?.length ?? 0;
    count += filters.category?.length ?? 0;
    count += filters.severity?.length ?? 0;
    if (filters.date_from) count += 1;
    if (filters.date_to) count += 1;
    if (filters.min_priority) count += 1;
    if (filters.only_synthetic) count += 1;
    if (filters.include_synthetic === false) count += 1;
    return count;
  }, [filters]);

  return {
    filters,
    update,
    toggleArrayValue,
    reset,
    activeCount,
    setStatuses: (values: ReportStatus[]) => update({ status: values }),
    setCategories: (values: DamageCategory[]) => update({ category: values }),
    setSeverities: (values: Severity[]) => update({ severity: values }),
  };
}
