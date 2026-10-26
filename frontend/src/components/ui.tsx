import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';

/* --------------------------------------------------------------- Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-ember-600 text-white hover:bg-ember-700 active:bg-ember-800 shadow-sm disabled:bg-ember-600/50 dark:bg-ember-500 dark:hover:bg-ember-600',
  secondary:
    'bg-ink-900 text-white hover:bg-ink-800 dark:bg-ink-100 dark:text-ink-900 dark:hover:bg-white',
  outline:
    'border border-ink-300 bg-white text-ink-800 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 dark:hover:bg-ink-800',
  ghost: 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
  danger: 'bg-signal-red text-white hover:bg-red-600 disabled:bg-red-400',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className = '', children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ----------------------------------------------------------------- Input */

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
}

export function Field({ label, hint, error, required, children, htmlFor }: FieldProps) {
  return (
    <div>
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-ember-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-signal-red" role="alert">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className = '', invalid, ...props }, ref) {
    return <input ref={ref} className={`field ${invalid ? 'field-error' : ''} ${className}`} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className = '', invalid, ...props }, ref) {
  return <textarea ref={ref} className={`field min-h-[90px] resize-y ${invalid ? 'field-error' : ''} ${className}`} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = '', children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={`field ${className}`} {...props}>
      {children}
    </select>
  );
});

export function Checkbox({
  label,
  checked,
  onChange,
  id,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  id: string;
  description?: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-ink-300 text-ember-600 focus:ring-ember-500 dark:border-ink-600 dark:bg-ink-800"
      />
      <span>
        <span className="font-medium text-ink-800 dark:text-ink-100">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-ink-500 dark:text-ink-400">{description}</span> : null}
      </span>
    </label>
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return <Tag className={`card ${className}`}>{children}</Tag>;
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-4 py-3.5 dark:border-ink-800 sm:px-5">
      <div className="flex items-start gap-2.5">
        {icon ? <span className="mt-0.5 text-ember-500">{icon}</span> : null}
        <div>
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink-500 dark:text-ink-400">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Badge */

export function Badge({
  children,
  tone = 'neutral',
  className = '',
  dot = false,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'accent';
  className?: string;
  dot?: boolean;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    warning: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    danger: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
    info: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
    violet: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
    accent: 'bg-ember-100 text-ember-800 dark:bg-ember-950 dark:text-ember-200',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5 ${tones[tone]} ${className}`}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- Feedback */

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-500 dark:text-ink-400">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}…</span>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-ink-200/70 dark:bg-ink-800 ${className}`}
      aria-hidden
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="mb-1 rounded-full bg-ink-100 p-3 text-ink-500 dark:bg-ink-800 dark:text-ink-300">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden />}
      </div>
      <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{title}</p>
      <p className="max-w-md text-xs leading-relaxed text-ink-500 dark:text-ink-400">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  hints,
  onRetry,
}: {
  title?: string;
  message: string;
  hints?: string[];
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" role="alert">
      <div className="rounded-full bg-red-100 p-2.5 text-red-600 dark:bg-red-950 dark:text-red-300">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</p>
      <p className="max-w-lg text-xs leading-relaxed text-ink-600 dark:text-ink-300">{message}</p>
      {hints?.length ? (
        <ul className="mt-1 max-w-lg list-disc space-y-1 pl-5 text-left text-xs text-ink-500 dark:text-ink-400">
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function InlineNotice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: 'border-sky-300/70 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-100',
    warning: 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100',
    danger: 'border-red-300/70 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-100',
    success:
      'border-emerald-300/70 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-100',
  };
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed ${tones[tone]}`}>
      {title ? <p className="mb-0.5 text-[13px] font-semibold">{title}</p> : null}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-ink-950/60 p-3 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card w-full ${width} max-h-[90vh] overflow-y-auto animate-fade-in`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-3.5 dark:border-ink-800">
          <div>
            <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-md p-1 text-ink-500 transition hover:bg-ink-100 dark:hover:bg-ink-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 px-5 py-3 dark:border-ink-800">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Pagination */

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-ink-600 dark:text-ink-300">
      <p>
        Showing <span className="font-semibold text-ink-900 dark:text-ink-50">{start}</span>–
        <span className="font-semibold text-ink-900 dark:text-ink-50">{end}</span> of{' '}
        <span className="font-semibold text-ink-900 dark:text-ink-50">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {onPageSize ? (
          <Select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            aria-label="Rows per page"
            className="h-8 w-[5.5rem] py-1 text-xs"
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}/page
              </option>
            ))}
          </Select>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          icon={<ChevronLeft className="h-3.5 w-3.5" />}
        >
          Prev
        </Button>
        <span className="tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ misc */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ember-600 dark:text-ember-400">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-0.5 text-xl font-bold tracking-tight text-ink-900 dark:text-white sm:text-2xl">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-500 dark:text-ink-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">{label}</dt>
      <dd className="text-sm font-medium text-ink-900 dark:text-ink-50">{value}</dd>
    </div>
  );
}

export function ProgressBar({ value, tone = 'ember' }: { value: number; tone?: 'ember' | 'emerald' | 'red' | 'sky' }) {
  const tones = {
    ember: 'bg-ember-500',
    emerald: 'bg-emerald-500',
    red: 'bg-signal-red',
    sky: 'bg-sky-500',
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
      <div className={`h-full rounded-full ${tones[tone]}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
