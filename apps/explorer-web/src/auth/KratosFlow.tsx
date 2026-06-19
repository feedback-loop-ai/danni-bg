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
  UpdateSettingsFlowBody,
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
  if (kind === 'settings') return (await kratos.createBrowserSettingsFlow()).data;
  return (await kratos.createBrowserVerificationFlow()).data;
}

async function getFlow(kind: FlowKind, id: string): Promise<Flow> {
  if (kind === 'login') return (await kratos.getLoginFlow({ id })).data;
  if (kind === 'registration') return (await kratos.getRegistrationFlow({ id })).data;
  if (kind === 'recovery') return (await kratos.getRecoveryFlow({ id })).data;
  if (kind === 'settings') return (await kratos.getSettingsFlow({ id })).data;
  return (await kratos.getVerificationFlow({ id })).data;
}

/** Submit a flow step; returns the updated flow (multi-step flows like recovery continue in place). */
async function submitFlow(
  kind: FlowKind,
  id: string,
  body: Record<string, string>,
): Promise<{ ui?: UiContainer } | undefined> {
  if (kind === 'login') {
    return (
      await kratos.updateLoginFlow({
        flow: id,
        updateLoginFlowBody: body as unknown as UpdateLoginFlowBody,
      })
    ).data as { ui?: UiContainer };
  }
  if (kind === 'registration') {
    return (
      await kratos.updateRegistrationFlow({
        flow: id,
        updateRegistrationFlowBody: body as unknown as UpdateRegistrationFlowBody,
      })
    ).data as { ui?: UiContainer };
  }
  if (kind === 'recovery') {
    return (
      await kratos.updateRecoveryFlow({
        flow: id,
        updateRecoveryFlowBody: body as unknown as UpdateRecoveryFlowBody,
      })
    ).data as { ui?: UiContainer };
  }
  if (kind === 'settings') {
    return (
      await kratos.updateSettingsFlow({
        flow: id,
        updateSettingsFlowBody: body as unknown as UpdateSettingsFlowBody,
      })
    ).data as { ui?: UiContainer };
  }
  return (
    await kratos.updateVerificationFlow({
      flow: id,
      updateVerificationFlowBody: body as unknown as UpdateVerificationFlowBody,
    })
  ).data as { ui?: UiContainer };
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
  settings: [{ to: '/', label: 'Към началото' }],
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
            'Услугата за вход е недостъпна. Отворете приложението на http://localhost:8790 или проверете дали Ory стекът работи.',
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
      const out = await submitFlow(kind, flow.id, body);
      if (kind === 'login' || kind === 'registration' || kind === 'settings') {
        // Terminal: a session now exists (or the password was changed). Go home.
        await refresh();
        navigate('/', { replace: true });
        return;
      }
      // A valid recovery code hands off to the settings (new-password) flow. Kratos signals this
      // either as a 422 redirect (caught below) or — in v1.x — a 200 with a `continue_with` item;
      // handle the latter here by navigating into the settings flow.
      const cont = (out as { continue_with?: { action: string; flow?: { id: string } }[] })
        .continue_with;
      const toSettings = cont?.find((c) => c.action === 'show_settings_ui');
      if (toSettings?.flow?.id) {
        navigate(`/auth/settings?flow=${toSettings.flow.id}`, { replace: true });
        return;
      }
      // Otherwise recovery / verification are multi-step: re-render with the returned flow so the
      // next step (e.g. the emailed-code input) and its "code sent" message appear in place.
      if (out?.ui) setFlow(out as Flow);
    } catch (err) {
      const res = (err as { response?: { status?: number; data?: unknown } }).response;
      const data = res?.data as (Flow & { redirect_browser_to?: string }) | undefined;
      if (res?.status === 422 && data?.redirect_browser_to) {
        // e.g. recovery code accepted → Kratos hands off to the settings flow to set a new password.
        // Navigate SAME-ORIGIN (strip the configured host) so it works on whatever port we're on.
        goSameOrigin(data.redirect_browser_to);
      } else if ((res?.status === 400 || res?.status === 410) && data?.ui) {
        setFlow(data); // validation messages, or the next step rendered with an error
      } else {
        setFatal('Възникна грешка. Опитайте отново.');
      }
    }
  }

  function goSameOrigin(target: string) {
    try {
      const u = new URL(target, window.location.origin);
      navigate(u.pathname + u.search, { replace: true });
    } catch {
      navigate('/', { replace: true });
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
          {flow.ui.nodes
            // The settings flow ("Смяна на парола") carries both a `profile` and a `password`
            // method group, each with its own submit — rendering both gives two Save buttons. This
            // page only changes the password, so keep the `password` group (+ the `default` csrf).
            .filter(
              (node) =>
                kind !== 'settings' || node.group === 'password' || node.group === 'default',
            )
            .map((node, i) => (
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
