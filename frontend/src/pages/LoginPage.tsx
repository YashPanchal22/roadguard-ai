import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, LogIn, ShieldCheck, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AppProviders';
import { describeError } from '../services/api';
import { Button, Card, Field, InlineNotice, Input } from '../components/ui';

const DEMO_ACCOUNTS = [
  { role: 'Reviewer', email: 'reviewer@roadguard.demo', password: 'Reviewer@123' },
  { role: 'Administrator', email: 'admin@roadguard.demo', password: 'Admin@123' },
];

export function LoginPage() {
  const { login, register, user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; hints: string[] } | null>(null);

  if (user) {
    return <Navigate to="/reports" replace />;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
      navigate('/reports');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          <span className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-xl bg-ember-500/15 text-ember-400">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-bold text-white">RoadGuard AI</h1>
          <p className="mt-1 text-xs text-ink-400">Road damage detection & monitoring · authorised access</p>
        </div>

        <Card className="card-pad">
          <div className="mb-4 flex rounded-lg bg-ink-100 p-1 dark:bg-ink-800">
            {(['login', 'register'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  mode === option
                    ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-900 dark:text-white'
                    : 'text-ink-500 dark:text-ink-400'
                }`}
              >
                {option === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'register' ? (
              <Field label="Display name" htmlFor="name" required>
                <Input id="name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} placeholder="e.g. Asha Patel" />
              </Field>
            ) : null}
            <Field label="Email" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </Field>
            <Field
              label="Password"
              htmlFor="password"
              required
              hint={mode === 'register' ? 'At least 8 characters.' : undefined}
            >
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
              />
            </Field>

            {error ? (
              <InlineNotice tone="danger" title={error.message}>
                {error.hints.map((hint) => (
                  <p key={hint}>{hint}</p>
                ))}
              </InlineNotice>
            ) : null}

            <Button type="submit" className="w-full" loading={loading} icon={mode === 'login' ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}>
              {mode === 'login' ? 'Sign in' : 'Create citizen account'}
            </Button>
          </form>

          <div className="mt-4 rounded-lg border border-dashed border-ink-300 p-3 dark:border-ink-700">
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              <KeyRound className="h-3 w-3" /> Demo credentials (development seed only)
            </p>
            <ul className="space-y-1">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-ink-600 dark:text-ink-300">
                    {account.role}: <code className="font-mono">{account.email}</code>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setEmail(account.email);
                      setPassword(account.password);
                    }}
                    className="rounded border border-ink-300 px-1.5 py-0.5 font-semibold text-ink-700 hover:border-ember-400 dark:border-ink-600 dark:text-ink-200"
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] text-ink-400">
              These accounts exist only after the demo seed runs. Change or remove them before any real deployment.
            </p>
          </div>

          <div className="mt-3 text-center">
            <Link to="/" className="inline-flex items-center gap-1 text-[11px] font-semibold text-ember-600 hover:underline dark:text-ember-400">
              <ArrowLeft className="h-3 w-3" /> Continue browsing without signing in
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
