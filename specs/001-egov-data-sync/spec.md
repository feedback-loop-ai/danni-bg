# Feature Specification: Local Sync of data.egov.bg with Curation and Machine-Readable Index

**Feature Branch**: `001-egov-data-sync`
**Created**: 2026-05-08
**Status**: Draft
**Input**: User description: "I would like to have a sync of the data in https://data.egov.bg/ locally, that will be curated and indexed for faster 'machine' reading downstream."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bootstrap a complete local mirror of the portal (Priority: P1)

A data operator wants to obtain a working local copy of the datasets published on data.egov.bg so that downstream automated consumers (LLM agents, analytics jobs, search tools) can read Bulgarian open-government data without depending on the live portal. The operator runs a single command that discovers all available datasets, downloads their metadata and data resources, stores them in an organized local layout, and produces a manifest describing what was captured and when.

**Why this priority**: Without a complete, reproducible local snapshot the rest of the system has no source of truth. Every other capability (curation, indexing, incremental updates) builds on this baseline.

**Independent Test**: After running the bootstrap on an empty machine, verify that (a) the on-disk layout contains every dataset listed by the portal at the time of capture, (b) each dataset has both its metadata and its downloadable resources, and (c) a manifest file enumerates every dataset with its source URL, capture timestamp, and a content hash. The local mirror is usable as a static archive even if no further curation or indexing has happened yet.

**Acceptance Scenarios**:

1. **Given** an empty local store, **When** the operator triggers a full sync, **Then** the system enumerates every dataset published on data.egov.bg, downloads each dataset's metadata and resource files, and writes a manifest covering the entire snapshot.
2. **Given** the portal lists N datasets, **When** the sync completes successfully, **Then** the manifest contains exactly N entries and the local store contains the corresponding files for each entry.
3. **Given** a dataset resource is unavailable or returns an error, **When** the sync runs, **Then** the system records the failure against that resource in the manifest, continues processing remaining datasets, and exits with a non-zero status that summarizes failures.
4. **Given** a previously completed sync, **When** the operator re-runs the sync, **Then** the system reuses unchanged content (avoids redundant downloads) and only fetches resources whose source has changed.

---

### User Story 2 - Curated, normalized representation suitable for machine consumption (Priority: P2)

A downstream consumer (e.g., an AI agent answering questions about Bulgarian public data) needs a normalized, predictable, *enriched* representation of each dataset rather than the raw heterogeneous formats published on the portal (mixed encodings, inconsistent column naming, mixed Cyrillic/Latin transliterations, varying file types). A curation step transforms each captured dataset into a canonical form: stable field/column names, declared data types, consistent character encoding, normalized dates and numbers, and standard metadata fields. On top of that normalization, the system extracts entities (organizations, geographic units, time periods, named registry subjects), links records across datasets that share entities, and produces machine-generated English translations of titles and descriptions alongside the originals — every enrichment carries explicit provenance and confidence.

**Why this priority**: Raw open-data resources are inconsistent across publishing agencies. Curation is what makes the local mirror more valuable than the live portal for automated use.

**Independent Test**: Pick a sample of datasets covering the most common formats (tabular, JSON, hierarchical, geospatial). Verify that each has a curated representation with declared schema, consistent encoding, normalized dates/numbers, an extracted set of entities, cross-dataset links where shared entities exist, and an English translation of the title/description that retains the original Bulgarian. Every enrichment carries a provenance and confidence note. The curated artifacts must be readable by a generic consumer with no knowledge of the original source quirks.

**Acceptance Scenarios**:

1. **Given** a captured dataset with a tabular resource, **When** the curation step runs, **Then** the system produces a canonical tabular artifact with declared column names, declared data types, and UTF-8 encoding regardless of the source encoding.
2. **Given** a captured dataset whose source has multiple resources of different types, **When** the curation step runs, **Then** each resource is curated independently and the dataset's curated metadata cross-references all resources.
3. **Given** a resource cannot be confidently curated (unknown structure, corrupt content), **When** the curation step runs, **Then** the resource is retained in its raw form, marked as "uncurated" in the manifest, and the reason is recorded.
4. **Given** the curation rules change, **When** the operator re-runs curation against the existing local mirror, **Then** the system can re-curate without re-downloading from the portal.
5. **Given** a curated dataset, **When** enrichment runs, **Then** the dataset carries an extracted set of entities (publishing organization, geographic units, time periods, named subjects where applicable), each entity recording the extractor that produced it and a confidence value.
6. **Given** two curated datasets that share an identifiable entity (e.g., the same publishing organization or the same municipality), **When** enrichment runs, **Then** both datasets expose a cross-link to each other through that entity with the heuristic and confidence recorded.
7. **Given** a curated dataset with Bulgarian title and description, **When** enrichment runs, **Then** the curated metadata contains both the original Bulgarian text and a machine-generated English translation marked as such, with the translator and confidence recorded.

---

### User Story 3 - Index optimized for machine reading and retrieval (Priority: P2)

A downstream agent needs to answer questions like "find datasets related to budget execution by ministry" or "what fields does the registry of public organizations expose" without scanning every dataset on disk. An index over the curated mirror lets consumers locate relevant datasets and the right fields/rows by keyword and by semantic similarity, returning pointers to the curated artifacts.

**Why this priority**: Without an index, every downstream query must brute-force the corpus, which is slow and impractical at scale. The index is what makes "faster machine reading downstream" real.

**Independent Test**: Submit a representative set of natural-language and keyword queries against the index. Verify that (a) keyword queries return datasets whose curated metadata or content contains the keywords, (b) semantic queries return datasets whose meaning matches the query even when exact words differ, and (c) every result includes a pointer back to the curated artifact and its source so the consumer can read the underlying data.

**Acceptance Scenarios**:

1. **Given** a curated local mirror, **When** the indexing step runs, **Then** an index is produced that supports both keyword lookup and semantic similarity over dataset titles, descriptions (Bulgarian and English), publishing agency, column/field labels, and extracted entities.
2. **Given** an index, **When** a downstream consumer issues a query, **Then** the consumer receives ranked dataset pointers, each linking to the curated artifact and the original source URL.
3. **Given** new or updated datasets after a re-sync, **When** the indexing step runs, **Then** the index is updated incrementally rather than rebuilt from scratch.
4. **Given** Bulgarian-language content (Cyrillic), **When** a query is issued in either Bulgarian or English, **Then** results include relevant datasets regardless of query language.
5. **Given** an extracted entity (e.g., a specific municipality or organization), **When** a consumer queries by that entity, **Then** the index returns every dataset linked to that entity through enrichment.

---

### Edge Cases

- A dataset is removed from the portal after a previous sync — the system marks it as withdrawn in the manifest but retains the previously captured copy for reproducibility (no silent deletion).
- A resource file is extremely large — the sync streams it to disk rather than buffering it in memory and reports progress per resource.
- The portal is unreachable mid-sync — the system records partial progress, can be resumed, and never leaves the local store in a state where the manifest disagrees with on-disk content.
- A resource is published behind a redirect chain or with an unusual content-type header — the system follows redirects and identifies the real format from content rather than only the declared type.
- The same logical dataset is republished with a new identifier — captured as a new dataset; reconciling duplicates is out of scope for v1.
- Curation produces ambiguous results (e.g., a column that could be a date or a string) — the system records the chosen interpretation and a confidence note, and never fails the whole dataset over a single column.
- The portal rate-limits requests — the system respects rate limits and back-off signals; throttled syncs take longer but never get the operator banned.
- A scheduled run is due while a previous run is still in progress — the system either skips the new run or queues it (per FR-017c), records the decision in the run history, and never executes the two concurrently.
- The operator narrows the scope filter so that previously-captured datasets are no longer in scope — the system marks them as out-of-scope in the manifest but retains the captured copies (no silent deletion).
- An entity extractor returns multiple ambiguous candidates for the same field — the system records all candidates with their confidences instead of committing to one, and lets downstream consumers decide.
- A machine translation is low-confidence or empty — the system retains the original Bulgarian unchanged, records the translation as low-confidence (or absent), and never substitutes the translation for the original.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST discover the full set of datasets published on data.egov.bg using the portal's published catalog interface.
- **FR-002**: System MUST download, for every discovered dataset, both its metadata (title, description, publisher, license, tags, timestamps) and every linked resource file.
- **FR-003**: System MUST write a manifest of every sync run that records, per dataset and per resource: source URL, capture timestamp, content hash, byte size, declared format, and outcome (success / failure / skipped-unchanged).
- **FR-004**: System MUST support incremental re-sync: on subsequent runs, only resources whose source content has changed are re-downloaded; unchanged resources are reused.
- **FR-005**: System MUST persist the captured raw resources in their original byte form so that the local copy can serve as a faithful archive of the source.
- **FR-006**: System MUST continue past per-resource failures, record them in the manifest, and surface a summary at the end of the run.
- **FR-007**: System MUST respect the portal's stated rate limits and back-off signals, and MUST be resumable after interruption without re-downloading already-captured resources.
- **FR-008**: System MUST produce, for each captured dataset, a curated representation with consistent character encoding (UTF-8), declared field/column names, and declared data types where the source structure permits.
- **FR-009**: System MUST normalize date and numeric values in curated artifacts into a single declared form per field, and MUST record any normalization rules applied.
- **FR-010**: System MUST mark resources that cannot be confidently curated as "uncurated" with a recorded reason, and MUST retain their raw form regardless.
- **FR-011**: System MUST allow curation to be re-run against an existing local mirror without re-fetching from the portal.
- **FR-012**: System MUST produce an index over the curated mirror that supports both keyword lookup and semantic similarity search over dataset metadata and field/column labels.
- **FR-013**: Every index result MUST include a pointer to the curated artifact and to the original source URL so consumers can trace any answer back to the source.
- **FR-014**: System MUST support indexing of Bulgarian-language (Cyrillic) content and MUST return relevant results for queries in either Bulgarian or English.
- **FR-015**: System MUST update the index incrementally when new or changed datasets are detected by a re-sync.
- **FR-016**: System MUST treat a dataset that disappears from the portal as "withdrawn" in the manifest and MUST retain the previously captured copy for reproducibility.
- **FR-017**: System MUST run on a configurable recurring schedule (e.g., daily) and MUST also support manual on-demand invocation; each scheduled or manual invocation is a distinct Sync Run.
- **FR-017a**: System MUST retain a history of recent Sync Runs accessible to the operator, recording start/end timestamps, totals (datasets discovered, captured, skipped-unchanged, failed, withdrawn), and a summary outcome.
- **FR-017b**: System MUST notify the operator when a Sync Run fails outright or when the per-resource failure rate exceeds a configurable threshold.
- **FR-017c**: System MUST prevent overlapping Sync Runs — if a scheduled run is due while a previous run is still in progress, the new run is either skipped or queued, never executed concurrently.
- **FR-018**: System MUST support a configurable scope filter that selects datasets by publisher, category, tag, and/or explicit dataset identifier; an empty/unset filter means "every public dataset on the portal".
- **FR-018a**: When the scope filter changes between runs, the system MUST capture newly-included datasets and MUST mark previously-included-but-now-excluded datasets as out-of-scope in the manifest without deleting their captured copies.
- **FR-019**: Curation MUST produce, for each dataset, the standard normalized representation (consistent encoding, declared schema, normalized dates and numeric formats per FR-008/FR-009) AND the enriched outputs defined in FR-019a–FR-019d.
- **FR-019a**: System MUST extract recognizable entities from dataset metadata and curated content (at minimum: publishing organizations, geographic units, time periods, and named registry subjects where applicable) and attach them to the curated dataset.
- **FR-019b**: System MUST link records across datasets where they share identifiable entities (e.g., the same publishing organization, the same geographic unit) and expose those links from the curated metadata.
- **FR-019c**: System MUST produce an English translation of each dataset's title and description alongside the original Bulgarian, mark the translation as machine-generated, and preserve the original Bulgarian text unchanged.
- **FR-019d**: System MUST record the provenance and confidence of every enrichment (which extractor produced an entity, which heuristic produced a cross-dataset link, which translator produced an English text) so downstream consumers can decide how much to trust enriched fields.

### Key Entities

- **Dataset**: A publication unit on data.egov.bg with metadata (title, description, publisher, license, tags, publish/update timestamps) and one or more resources.
- **Resource**: A downloadable file or endpoint linked from a dataset, with a declared format, source URL, byte size, and content hash.
- **Sync Run**: A single execution of the sync process, identified by a timestamp, recording which datasets and resources were captured, skipped-unchanged, failed, or detected as withdrawn.
- **Manifest**: The authoritative record of what is in the local mirror, including per-dataset and per-resource provenance (source URL, capture time, hash) and per-run outcomes.
- **Curated Artifact**: A normalized representation of a resource with declared schema, consistent encoding, and recorded transformation rules; cross-referenced from the dataset's curated metadata.
- **Index Entry**: A searchable record covering a curated dataset, its fields, its descriptive metadata (Bulgarian and English), and its extracted entities, supporting keyword and semantic retrieval and pointing back to the curated artifact and source URL.
- **Scope Filter**: A configurable selector (by publisher, category, tag, and/or explicit dataset identifier) that determines which datasets the system attempts to sync; an empty filter means "every public dataset on the portal".
- **Schedule**: The configured cadence (e.g., daily) at which Sync Runs are triggered automatically; the operator may also trigger Sync Runs manually.
- **Entity**: An identifiable referent extracted from dataset metadata or curated content (e.g., a publishing organization, a geographic unit, a time period, a named registry subject), recorded with its extractor and a confidence value.
- **Cross-Dataset Link**: A relationship between two curated datasets that share an Entity, recorded with the heuristic that produced it and a confidence value.
- **Translation**: A machine-generated English rendering of a Bulgarian text field (title or description), stored alongside — never replacing — the original, with the translator and a confidence value recorded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a clean machine, a full bootstrap sync completes for every dataset listed on data.egov.bg with a per-resource success rate of at least 95%, and every failure is recorded in the manifest with a diagnosable reason.
- **SC-002**: A subsequent re-sync over an unchanged portal completes in under 10% of the bootstrap time by reusing unchanged resources.
- **SC-003**: For 95% of captured tabular resources, the curated artifact has a declared schema (named, typed columns) and UTF-8 encoding regardless of the source encoding.
- **SC-004**: A downstream consumer can locate the most relevant dataset for a natural-language query (Bulgarian or English) within the top 5 indexed results in at least 90% of a representative test query set.
- **SC-005**: Every answer a downstream consumer derives from the local mirror can be traced, in one hop, back to the original source URL on data.egov.bg via the manifest or index entry.
- **SC-006**: The local mirror remains usable (read-only) even if data.egov.bg is unreachable, and remains internally consistent (manifest matches on-disk content) after any interruption.
- **SC-007**: A new or updated dataset appearing in a re-sync is reflected in the index within the same run, without requiring a full index rebuild.
- **SC-008**: At least 95% of scheduled Sync Runs over a representative 30-day window complete with a recorded summary outcome (success, partial, or failed) and a non-empty run-history entry; failed runs trigger an operator notification within one run window.
- **SC-009**: At least 90% of curated datasets carry at least one extracted entity, and at least 80% of curated tabular datasets carry an entity attached to at least one column-level field.
- **SC-010**: At least 95% of curated datasets have a non-empty English translation of their title and a translation of their description, with the original Bulgarian preserved unchanged in every case.
- **SC-011**: A consumer querying by a known entity (e.g., a specific municipality) recovers every curated dataset linked to that entity in a representative test set, with a recall of at least 90%.

## Assumptions

- The primary downstream consumers are automated (LLM agents, analytics jobs, retrieval systems), not interactive end-users browsing a UI; "machine reading" is the explicit design target.
- The portal exposes a discoverable catalog of datasets and resources through its public interface; if the portal changes that interface, the discovery step is expected to change accordingly (out of scope: scraping a UI that has no machine-readable catalog).
- The local mirror is operated on infrastructure with sufficient storage to hold the captured resources and curated artifacts; storage planning is the operator's responsibility.
- Bulgarian (Cyrillic) is the dominant content language; English is a secondary query language. Other languages are not first-class.
- The system is operated cooperatively with the portal's published terms — it identifies itself in requests and respects rate limits; aggressive scraping or evasion is explicitly out of scope.
- Reconciling republished/duplicate datasets across different identifiers is out of scope for v1; each portal identifier is treated as its own dataset.
- The curated representation is derived from the captured raw form, not from a separate source of truth; the raw capture remains authoritative.
- Authentication-gated datasets (if any) are out of scope for v1; only publicly accessible resources are captured.
- The operator decides the scheduled cadence and the failure-rate threshold that triggers notifications; the system enforces those settings but does not prescribe a fixed schedule.
- Enrichment outputs (extracted entities, cross-dataset links, English translations) are best-effort and probabilistic; downstream consumers are expected to consult the recorded confidence/provenance before relying on enrichment for high-stakes decisions.
- Entity extraction targets a pragmatic set of categories — publishing organizations, geographic units, time periods, and named registry subjects — rather than an open-ended ontology.
- English translations are machine-generated for searchability and for consumers who do not read Bulgarian; they are not authoritative legal/administrative translations and are never substituted for the original Bulgarian text.
