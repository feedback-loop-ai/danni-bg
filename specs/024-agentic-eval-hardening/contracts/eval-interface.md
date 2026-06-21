# Eval ↔ chat interface

The eval adds **no server endpoints**. It is a client of the existing chat + read API; this records
how it consumes them after the hardening.

## Auth

The eval holds a Kratos session (self-registered throwaway user, or `EVAL_AUTH_*` account) and sends
it on every request as `Cookie: ory_kratos_session=<token>` (the proxied jar cookie isn't reliably
re-sent by httpx, so it's pinned explicitly). Registration/login go through the single-port proxy:

- `GET /kratos/self-service/registration/browser` → flow (csrf token)
- `POST /kratos/self-service/registration?flow=<id>` `{csrf_token, method:"password", traits:{email}, password}`
- (or the `login` flow when `EVAL_AUTH_EMAIL` is set)

## Grading a turn

`POST /api/chat` (authenticated) with:

```jsonc
{
  "message": "<case.question>",
  "debug": true,                       // → server emits the `grounding` event (exact injected context)
  "provider": { "kind": "...", "model": "...", "baseUrl": "...", "apiKey": "..." },  // EVAL_SUBJECT_*
  "scope": { "geoUnitIds": ["geo:bg-oblast-…"] }  // optional, from case.scope (spec 023 behavior)
}
```

SSE events the client parses into a `ChatResult`:

| event | used for |
|---|---|
| `session` | session id |
| `token` | concatenated answer text |
| `tool` (status `start`) | tools_called (tool-correctness) |
| `grounding` | the exact injected context (faithfulness ground truth + guard input) |
| `citations` | cited dataset records |
| `anchors` | map anchors |
| `error` | provider/config error surfaced as a case error |

## Read endpoints (faithfulness reconstruction fallback)

`GET /api/datasets/:id` and `…/resources/:rid/rows` — used only when reconstructing context if the
`grounding` event is absent. Also authenticated (same client), though these are public.

## Compatibility

No request/response shapes changed on the server side; the hardening is entirely client-side (auth,
guards, judge config, cases). The only server dependency is the spec-019 gate and the spec-023
`scope.geoUnitIds` semantics, both already shipped.
