# Requirements checklist — Per-user token metering & quotas

- [X] CHK001 Per-turn usage (input/output/total + cache) recorded per user (FR-074, SC-001)
- [X] CHK002 Over-quota users blocked with 429 before any model call (FR-075, SC-002)
- [X] CHK003 Effective limit = per-user override (incl. 0=unlimited) → default → unlimited (FR-076)
- [X] CHK004 Cache hits weighted (default 0.1, configurable); raw breakdown preserved (FR-077, SC-003)
- [X] CHK005 Admin per-user view + set/clear limit + reset; admin-only (FR-078, SC-005)
- [X] CHK006 User self view of usage + quota (FR-079)
- [X] CHK007 Default limit, cache weight, max-output admin-configurable at runtime (FR-080, SC-004)
- [X] CHK008 Usage counted since reset; reset bumps timestamp, history kept (FR-081)
- [X] CHK009 Counts from provider usage; omitted field → 0 (FR-082)
- [X] CHK010 Hermetic tests for quota math, repo, and routes; suite green (SC-006)

## Notes

- Builds on spec 019 (gated chat, tiers, `platform_settings`). The default limit is **set via the
  admin setting, not hardcoded**, per an explicit decision. Token counts depend on the provider
  reporting usage (DeepSeek reports prompt-cache hits; others may record 0 cache).
