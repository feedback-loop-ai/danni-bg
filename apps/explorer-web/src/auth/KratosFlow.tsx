// Generic Ory Kratos self-service flow UI (spec 019): login / registration / recovery / verification.
// Inits the flow (create, or fetch an existing ?flow=id), renders flow.ui.nodes as a form, and submits
// via the SDK — so it stays in the SPA. Validation errors (400) re-render with messages; a 422
// browser_location_change is followed; success returns to the app with a fresh session.

import type {
  UiContainer,
  UiNode,
  UiNodeInputAttributes,
  UpdateLoginFlowBody,
  UpdateRecoveryFlowBody,
  UpdateRegistrationFlowBody,
  UpdateVerificationFlowBody,
} from '@ory/client';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { type FlowKind, flowMessages, kratos } from '../lib/kratos.ts';
import { useAuth } from './AuthContext.tsx';

interface Flow {
  id: string;
  ui: UiContainer;
}

async function createFlow(kind: FlowKind): Promise<Flow> {
  if (kind === 'login') return (await kratos.createBrowserLoginFlow()).data;
  if (kind === 'registration') return (await kratos.createBrowserRegistrationFlow()).data;
  if (kind === 'recovery') return (await kratos.createBrowserRecoveryFlow()).data;
  return (await kratos.createBrowserVerificationFlow()).data;
}

async function getFlow(kind: FlowKind, id: string): Promise<Flow> {
  if (kind === 'login') return (await kratos.getLoginFlow({ id })).data;
  if (kind === 'registration') return (await kratos.getRegistrationFlow({ id })).data;
  if (kind === 'recovery') return (await kratos.getRecoveryFlow({ id })).data;
  return (await kratos.getVerificationFlow({ id })).data;
}

async function submitFlow(kind: FlowKind, id: string, body: Record<string, string>): Promise<void> {
  if (kind === 'login') {
    await kratos.updateLoginFlow({
      flow: id,
      updateLoginFlowBody: body as unknown as UpdateLoginFlowBody,
    });
  } else if (kind === 'registration') {
    await kratos.updateRegistrationFlow({
      flow: id,
      updateRegistrationFlowBody: body as unknown as UpdateRegistrationFlowBody,
    });
  } else if (kind === 'recovery') {
    await kratos.updateRecoveryFlow({
      flow: id,
      updateRecoveryFlowBody: body as unknown as UpdateRecoveryFlowBody,
    });
  } else {
    await kratos.updateVerificationFlow({
      flow: id,
      updateVerificationFlowBody: body as unknown as UpdateVerificationFlowBody,
    });
  }
}

const INPUT_CLASS =
  'w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function NodeField({ node }: { node: UiNode }) {
  if (node.type !== 'input') return null;
  const a = node.attributes as UiNodeInputAttributes;
  const label = node.meta?.label?.text;
  const value = a.value === undefined || a.value === null ? '' : String(a.value);

  if (a.type === 'hidden') return <input type="hidden" name={a.name} defaultValue={value} />;
  if (a.type === 'submit' || a.type === 'button') {
    return (
      <button
        type="submit"
        name={a.name}
        value={value}
        disabled={a.disabled}
        className="w-full rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {label ?? 'Изпрати'}
      </button>
    );
  }
  return (
    <label className="block space-y-1">
      {label ? <span className="text-sm text-muted-foreground">{label}</span> : null}
      <input
        className={INPUT_CLASS}
        name={a.name}
        type={a.type}
        defaultValue={value}
        required={a.required}
        disabled={a.disabled}
        autoComplete={a.autocomplete}
      />
      {(node.messages ?? []).map((m) => (
        <span key={m.id} className="block text-xs text-destructive">
          {m.text}
        </span>
      ))}
    </label>
  );
}

const ALT_LINKS: Record<FlowKind, { to: string; label: string }[]> = {
  login: [
    { to: '/auth/register', label: 'Създай профил' },
    { to: '/auth/recovery', label: 'Забравена парола' },
  ],
  registration: [{ to: '/auth/login', label: 'Вече имам профил' }],
  recovery: [{ to: '/auth/login', label: 'Назад към вход' }],
  verification: [{ to: '/', label: 'Към началото' }],
};

export function KratosFlow({ kind, title }: { kind: FlowKind; title: string }) {
  const [params] = useSearchParams();
  const flowId = params.get('flow');
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const f = flowId ? await getFlow(kind, flowId) : await createFlow(kind);
        // Guard against a non-flow response (e.g. when /kratos isn't proxied and the request returns
        // the SPA's index.html): show a clear error instead of crashing the render on `f.ui.nodes`.
        if (!f?.ui?.nodes) throw new Error('invalid flow response');
        if (active) setFlow(f);
      } catch {
        if (active) {
          setFatal(
            'Услугата за вход е недостъпна. Отворете приложението през dev сървъра (http://localhost:5173) или проверете дали Ory стекът работи.',
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [kind, flowId]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!flow) return;
    const fd = new FormData(
      e.currentTarget,
      (e.nativeEvent as SubmitEvent).submitter as HTMLElement,
    );
    const body: Record<string, string> = {};
    fd.forEach((v, k) => {
      body[k] = String(v);
    });
    try {
      await submitFlow(kind, flow.id, body);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      const res = (err as { response?: { status?: number; data?: unknown } }).response;
      if (res?.status === 400 && res.data) {
        setFlow(res.data as Flow); // re-render with field messages
      } else if (res?.status === 422) {
        window.location.href = (res.data as { redirect_browser_to: string }).redirect_browser_to;
      } else if (res?.status === 410) {
        setFlow(null); // expired → re-init
        navigate(`/auth/${kind}`, { replace: true });
      } else {
        setFatal('Възникна грешка. Опитайте отново.');
      }
    }
  }

  return (
    <div className="mx-auto mt-16 w-full max-w-sm space-y-4 px-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      {fatal ? <p className="text-sm text-destructive">{fatal}</p> : null}
      {flow ? (
        <form onSubmit={onSubmit} className="space-y-3">
          {flowMessages(flow.ui).map((m) => (
            <p key={m} className="text-sm text-muted-foreground">
              {m}
            </p>
          ))}
          {flow.ui.nodes.map((node, i) => (
            <NodeField key={`${node.group}-${i}`} node={node} />
          ))}
        </form>
      ) : (
        !fatal && <p className="text-sm text-muted-foreground">Зареждане…</p>
      )}
      <div className="flex gap-4 text-sm">
        {ALT_LINKS[kind].map((l) => (
          <Link key={l.to} to={l.to} className="text-primary hover:underline">
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
