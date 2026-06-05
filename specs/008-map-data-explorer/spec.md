# Feature Specification: Interactive Bulgarian Map Data Explorer

**Feature Branch**: `008-map-data-explorer`  
**Created**: 2026-06-05  
**Status**: Draft  
**Input**: User description: "Interactive Bulgarian map explorer web UI for the curated data.egov.bg mirror. Core capabilities: (1) A zoomable/pannable map of Bulgaria showing public datasets geolocated to administrative units (oblast/municipality); user can zoom in/out and click regions. (2) Advanced filter panel — filter datasets on the map by category/tag, publisher, geographic unit, freshness, and free-text search over the curated mirror. (3) A chat window with a configurable LLM provider (user can pick/configure the provider and model) that has access to the danni-bg MCP mirror tools (mirror_search, mirror_info, mirror_entity_search, read_resource) so users can ask natural-language questions about the public data and get answers grounded in the curated datasets. Map filters and chat context should be linked: filtering the map narrows what the chat searches, and chat results can highlight regions/datasets on the map."

## Overview

A public web application that turns the curated `data.egov.bg` mirror into an explorable map of Bulgaria. Citizens, journalists, researchers, and public-sector analysts can visually browse which public datasets exist for each region, narrow the view with rich filters, and ask plain-language questions in a chat panel that answers using only the curated datasets — with answers and the map kept in sync so the user always knows *where* and *what* the data covers.

The feature builds on the existing curated mirror and its read/search capabilities (datasets carry titles in Bulgarian and English, publishers, tags, extracted geographic/organization/tag entities, cross-dataset links, freshness, and curated resource rows). This spec describes the user-facing explorer; it does not change how the mirror is synced or curated.

## Clarifications

### Session 2026-06-05

- Q: Where does the chat run its retrieval and LLM calls — directly from the browser, or via a backend? → A: Backend-mediated — a server component runs the danni-bg mirror tools (search, dataset records, entity lookup, resource reads) and calls the LLM provider; the browser never calls the mirror tools or the provider directly.
- Q: Which LLM providers must the configurable chat support in v1? → A: Any OpenAI-compatible API endpoint (covers OpenAI and self-hosted/local models such as the project's vLLM stack) plus Anthropic; a server-configured provider is the out-of-the-box default.
- Q: Where do the administrative-boundary shapes for the map come from? → A: Bundle an open administrative-boundary dataset (province + municipality polygons) and join it to the mirror's geographic entities by official administrative code.
- Q: How are user-supplied LLM credentials handled? → A: Per-user keys are stored client-side on the user's device and sent to the backend per request over TLS; they are never persisted or logged server-side. The optional server default provider's key lives only in server configuration.
- Q: Are chat conversations persisted across sessions in v1? → A: No — conversations are session-only (kept in memory for the active session) and are not stored server-side in v1.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Explore public data on a map of Bulgaria (Priority: P1)

A visitor opens the explorer and sees a map of Bulgaria divided into administrative units. Regions are visually weighted by how much public data is available for them (e.g. shading or a count badge). The visitor zooms from the national view down to a province (oblast) and then a municipality, panning to their area of interest. Clicking a region reveals the list of public datasets geolocated to it, each showing its title (Bulgarian/English), publisher, freshness, and a link back to the original `data.egov.bg` source for traceability.

**Why this priority**: This is the core value and the minimum viable product — making the otherwise flat, hard-to-navigate open-data catalogue spatially explorable. It delivers standalone value even without filtering or chat.

**Independent Test**: Load the app, confirm the national map renders with per-region data indicators, zoom/pan to a municipality, click it, and verify the dataset list for that region matches what the mirror holds for the corresponding geographic entity, each with a working source link.

**Acceptance Scenarios**:

1. **Given** the explorer is loaded at the national view, **When** the user zooms in on a province, **Then** the province subdivides into its municipalities and each shows an indication of available dataset volume.
2. **Given** the user has zoomed to a municipality, **When** they click it, **Then** a panel lists the datasets linked to that geographic unit with title, publisher, and freshness.
3. **Given** a dataset is shown in the region panel, **When** the user selects it, **Then** they can view its details (description, resources, tags, linked datasets) and a link to the original source URL.
4. **Given** a region has no geolocated datasets, **When** the user clicks it, **Then** the panel clearly states no datasets are linked to that region rather than showing an error or blank panel.

---

### User Story 2 - Narrow the view with advanced filters (Priority: P2)

A researcher wants only environment-related datasets published recently by regional inspectorates. They open the filter panel and combine filters — category/tag, publisher, geographic unit, and freshness — and add a free-text query. The map and the dataset lists update to show only matching datasets, with non-matching regions de-emphasized. Active filters are visible as removable chips, and the filtered state can be cleared in one action.

**Why this priority**: Filtering makes the explorer useful at scale (thousands of datasets, hundreds of publishers). It depends on the map (P1) being present but adds major discovery value.

**Independent Test**: Apply each filter type individually and in combination, and confirm the visible datasets and highlighted regions update to exactly the matching set; confirm clearing filters restores the full view.

**Acceptance Scenarios**:

1. **Given** the full map is shown, **When** the user selects a category/tag filter, **Then** only datasets carrying that tag remain visible and regions without matches are visually de-emphasized.
2. **Given** a tag filter is active, **When** the user adds a publisher filter, **Then** results narrow to datasets matching both filters (logical AND across filter types).
3. **Given** any filters are active, **When** the user types a free-text query, **Then** the visible results are further constrained to those matching the query within the curated mirror, ranked by relevance.
4. **Given** a freshness filter (e.g. "synced within last 24h" or "stale") is selected, **When** applied, **Then** only datasets matching that freshness state remain.
5. **Given** several filters are active, **When** the user clears all filters, **Then** the map and lists return to the unfiltered national view.

---

### User Story 3 - Ask questions in a grounded chat (Priority: P2)

A journalist opens the chat panel and asks, in Bulgarian or English, "Which regions publish air-quality data and how fresh is it?" The assistant answers using only the curated mirror — searching datasets, reading dataset records, following entity links, and reading sample resource rows as needed — and cites the specific datasets (with source links) it relied on. The user can continue the conversation with follow-ups, and the assistant stays grounded in the mirror rather than inventing data.

**Why this priority**: The chat turns discovery into answers, dramatically lowering the expertise needed to use open data. It is high value but depends on the dataset/search foundation being in place.

**Independent Test**: Ask a question whose answer is verifiable against the mirror, and confirm the response is grounded (cites real datasets that exist in the mirror, with source links) and that fabricated or unsupported claims do not appear.

**Acceptance Scenarios**:

1. **Given** the chat panel is open, **When** the user asks a natural-language question in Bulgarian or English, **Then** the assistant responds using only data retrieved from the curated mirror and cites the datasets it used.
2. **Given** the assistant references a dataset, **When** the user views the citation, **Then** it links to that dataset's detail view and original source URL.
3. **Given** the mirror contains no data relevant to a question, **When** the user asks it, **Then** the assistant states that no relevant public data was found rather than fabricating an answer.
4. **Given** an ongoing conversation, **When** the user asks a follow-up, **Then** the assistant retains the prior context within the session.

---

### User Story 4 - Configure the LLM provider and model (Priority: P3)

A power user opens settings and chooses which LLM provider and model the chat uses, supplying any needed connection details/credentials. They can switch providers, and the chat continues to function with the newly selected provider. If a provider is misconfigured or unreachable, the chat surfaces a clear, actionable error instead of failing silently.

**Why this priority**: Configurability is explicitly requested and important for cost, privacy, and capability control, but the chat can ship first against a default provider; provider switching is an enhancement on top.

**Independent Test**: Configure at least two distinct providers/models, send the same question to each, confirm both produce grounded answers, and confirm an intentionally invalid configuration yields a clear error.

**Acceptance Scenarios**:

1. **Given** the settings panel, **When** the user selects a provider and model and saves valid connection details, **Then** subsequent chat messages are served by that provider/model.
2. **Given** a configured provider, **When** the user switches to a different provider, **Then** new messages use the new provider without requiring a page reload that loses session context.
3. **Given** invalid or missing provider credentials, **When** the user sends a message, **Then** a clear error explains the configuration problem and how to fix it, and no partial/fabricated answer is shown.
4. **Given** a provider configuration is saved, **When** the user returns in a later session on the same device, **Then** their provider choice is remembered (credentials handled per the security assumptions below).

---

### User Story 5 - Linked map and chat (Priority: P3)

A user filters the map to a single province and a category, then asks the chat a question. The assistant's search is automatically scoped to the currently visible/filtered datasets, so answers reflect what the user is looking at. Conversely, when the assistant's answer references particular regions or datasets, those are highlighted on the map and the relevant region is brought into view, so the user can move fluidly between reading and seeing.

**Why this priority**: This bidirectional linkage is the differentiating "magic" of the product, but it requires map, filters, and chat (P1–P3) to exist first.

**Independent Test**: Apply a filter, ask a question, and confirm the answer only draws on the filtered subset; then ask a question whose answer names specific regions/datasets and confirm those are highlighted and focused on the map.

**Acceptance Scenarios**:

1. **Given** active map filters, **When** the user asks the chat a question, **Then** the assistant's retrieval is constrained to the filtered/visible dataset set and the answer reflects that scope.
2. **Given** an assistant answer that references specific regions, **When** it is displayed, **Then** those regions are highlighted on the map and the map view adjusts to bring them into focus.
3. **Given** an assistant answer that references specific datasets, **When** the user selects a cited dataset, **Then** the map highlights the dataset's region(s) and opens its detail view.
4. **Given** the chat scope is currently constrained by filters, **When** the user clears the filters, **Then** the chat's available scope expands back to the full mirror and this scope change is evident to the user.

---

### Edge Cases

- **Non-geolocated datasets**: Many datasets have no geographic entity (national registers, ministry-wide data). These MUST be discoverable through a dedicated "national / not georeferenced" grouping and through filters/chat, not silently dropped because they don't fit on the map.
- **Datasets spanning multiple regions**: A dataset linked to several geographic units MUST appear under each relevant region and be de-duplicated in list/count views.
- **Ambiguous or low-confidence geo extraction**: Geographic links carry confidence; low-confidence placements MUST be distinguishable (e.g. flagged) so users don't over-trust an uncertain placement.
- **Bilingual content gaps**: Some datasets have only Bulgarian titles/descriptions (English missing or machine-translated with low confidence). The UI MUST degrade gracefully, showing the available language and indicating when text is machine-translated.
- **Large result volumes**: A single region or filter may match thousands of datasets/rows. Results MUST be paginated or virtualized and remain responsive.
- **Stale or withdrawn datasets**: Datasets may be stale or withdrawn from the source; their state MUST be visible and filterable, and withdrawn datasets handled per a clear rule (hidden by default, surfaced on request).
- **Chat retrieval returns nothing**: The assistant MUST distinguish "no relevant public data exists" from "an error occurred while searching."
- **Provider/network failure mid-answer**: If the LLM provider fails or times out during a response, the user MUST get a clear failure state and be able to retry, with no fabricated content persisted.
- **Sensitive coded data**: Some curated resources use opaque codes (e.g. numeric station/parameter IDs). The chat SHOULD avoid presenting coded values as if self-explanatory and should note when a legend is unavailable.
- **Rapid filter/zoom changes**: Quick successive interactions MUST not produce stale or out-of-order results on the map or in chat.

## Requirements *(mandatory)*

### Functional Requirements

**Map exploration**
- **FR-001**: System MUST render a map of Bulgaria with administrative subdivisions at least to province (oblast) and municipality levels.
- **FR-002**: Users MUST be able to zoom in/out and pan the map smoothly across at least the national, provincial, and municipal levels.
- **FR-003**: System MUST indicate, per region, the volume of available public datasets (e.g. shading and/or counts) so users can see where data concentrates.
- **FR-004**: Users MUST be able to select a region to see the list of datasets geolocated to it, each showing title (BG/EN as available), publisher, and freshness.
- **FR-005**: System MUST provide a dataset detail view exposing description, tags, resources, linked/related datasets, freshness, and a link to the original `data.egov.bg` source URL for one-hop traceability.
- **FR-006**: System MUST surface datasets that are not georeferenced through a dedicated national/non-geographic grouping rather than omitting them.
- **FR-006a**: System MUST render administrative boundaries from a bundled open boundary dataset (province + municipality polygons), joined to the mirror's geographic entities by official administrative code, so map regions align with the datasets placed on them.

**Filtering & search**
- **FR-007**: Users MUST be able to filter visible datasets by category/tag.
- **FR-008**: Users MUST be able to filter by publisher.
- **FR-009**: Users MUST be able to filter by geographic unit (province/municipality), consistent with map selection.
- **FR-010**: Users MUST be able to filter by freshness state (e.g. recently synced vs. stale).
- **FR-011**: Users MUST be able to enter a free-text query (Bulgarian or English) that searches the curated mirror and ranks results by relevance.
- **FR-012**: System MUST combine multiple active filters as a logical AND and reflect the combined result on both the map and dataset lists.
- **FR-013**: System MUST show active filters as individually removable controls and allow clearing all filters in a single action.
- **FR-014**: System MUST keep the map highlighting and the dataset lists consistent with the current filter state at all times.

**Chat (grounded assistant)**
- **FR-015**: System MUST provide a chat panel where users can ask natural-language questions in Bulgarian or English.
- **FR-016**: The assistant MUST answer using only information retrieved from the curated mirror (dataset search, dataset records, entity links, and curated resource rows) and MUST NOT fabricate datasets, values, or sources. All such retrieval MUST execute server-side via a backend that runs the mirror tools; the browser MUST NOT access the mirror tools or the LLM provider directly.
- **FR-017**: The assistant MUST cite the specific datasets it used, each linking to the dataset detail view and original source URL.
- **FR-018**: When no relevant data exists in the mirror, the assistant MUST say so explicitly rather than inventing an answer.
- **FR-019**: System MUST retain conversation context across turns within a session. Conversations are session-only (held in memory for the active session) and MUST NOT be persisted server-side in v1.
- **FR-020**: The assistant MUST indicate when underlying values are coded/uncertain or text is machine-translated, so users do not over-trust the answer.

**LLM provider configuration**
- **FR-021**: Users MUST be able to select and configure which LLM provider and model the chat uses. Supported configurations in v1 MUST include any OpenAI-compatible API endpoint (covering OpenAI and self-hosted/local models) and Anthropic, with a server-configured provider available as the default.
- **FR-022**: Users MUST be able to switch providers/models without losing the current conversation context.
- **FR-023**: System MUST validate provider configuration and present clear, actionable errors when a provider is misconfigured or unreachable, without showing fabricated answers.
- **FR-024**: System MUST persist a user's provider/model selection across sessions on the same device. User-supplied credentials MUST be stored client-side on the user's device and transmitted to the backend per request over TLS; they MUST NOT be persisted or logged server-side. Any server default provider's key MUST reside only in server configuration.

**Linked map ↔ chat**
- **FR-025**: When map filters are active, the assistant's retrieval scope MUST be constrained to the filtered/visible dataset set, and the answer MUST reflect that scope.
- **FR-026**: When an assistant answer references regions or datasets, the system MUST highlight them on the map and bring the relevant area into focus.
- **FR-027**: Selecting a dataset cited by the assistant MUST highlight its region(s) on the map and open its detail view.
- **FR-028**: Changes to filter scope (including clearing filters) MUST be reflected in the chat's available scope and made evident to the user.

**Cross-cutting**
- **FR-029**: System MUST be usable without authentication for browsing, filtering, and viewing datasets (public read-only access).
- **FR-030**: System MUST remain responsive and paginate/virtualize large result sets (regions or filters matching very large numbers of datasets or rows).
- **FR-031**: System MUST present content bilingually where available and clearly indicate missing or machine-translated text.
- **FR-032**: System MUST keep map, filter, and chat state mutually consistent under rapid successive interactions (no stale or out-of-order results).

### Key Entities *(include if feature involves data)*

- **Dataset**: A curated public dataset from the mirror — identified by a dataset id, with bilingual title/description, publisher, tags, lifecycle state, freshness, source URL, resources, extracted entities, and links to related datasets.
- **Resource**: A data artifact within a dataset (tabular/NDJSON, JSON/GeoJSON document, or text/XML) with a schema and curated rows; the unit the chat reads sample values from.
- **Geographic Unit**: An administrative area (province/oblast, municipality) used to place datasets on the map; datasets link to one or more with an associated confidence.
- **Publisher / Organization**: The entity that published a dataset (e.g. a ministry, regional inspectorate, or municipality), used for display and filtering.
- **Tag / Category**: A topical label on a dataset used for filtering and grouping.
- **Filter State**: The current combination of active filters and free-text query that scopes the map, lists, and chat retrieval.
- **Conversation**: A session's ordered exchange of user questions and grounded assistant answers, including the dataset citations used.
- **Provider Configuration**: The user's chosen LLM provider, model, and connection settings governing how chat messages are answered.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can locate the public datasets available for a specific municipality within 60 seconds of opening the app, without instructions.
- **SC-002**: From any dataset shown in the explorer, a user can reach the original `data.egov.bg` source in a single action (one-hop traceability) for 100% of datasets.
- **SC-003**: Applying or changing filters updates the map and dataset lists within 2 seconds for typical filter combinations.
- **SC-004**: For a benchmark set of questions with known answers in the mirror, at least 90% of chat responses are grounded — every factual claim is supported by a cited dataset that actually exists in the mirror.
- **SC-005**: Across the same benchmark, fabricated datasets, values, or source links appear in 0% of responses.
- **SC-006**: For questions with no relevant data in the mirror, the assistant correctly states "no relevant public data found" in at least 95% of cases instead of inventing an answer.
- **SC-007**: A user can configure a different LLM provider/model and successfully receive a grounded answer from it in under 3 minutes, with no developer assistance.
- **SC-008**: With map filters active, 100% of the assistant's cited datasets fall within the current filter scope.
- **SC-009**: Non-georeferenced datasets remain discoverable: 100% of datasets in the mirror are reachable through either the map (a region) or the national/non-geographic grouping.
- **SC-010**: The explorer remains responsive (interactions acknowledged within 2 seconds) when a region or filter matches at least several thousand datasets.

## Assumptions

- **Data source**: The explorer reads from the existing curated `data.egov.bg` mirror and its established read/search capabilities (dataset search, dataset records, entity-based lookup, and resource row reads). Mirror sync/curation is out of scope for this feature.
- **Read-only scope**: The explorer only reads public data; it does not create, edit, or delete datasets, and requires no user accounts for browsing.
- **Geographic granularity**: Map placement uses the geographic entities already extracted into the mirror (province and municipality level). Finer-grained (settlement/point) placement is out of scope for v1 unless such entities exist in the mirror.
- **Bring-your-own LLM (security)**: Users supply their own provider credentials/keys, stored client-side on the user's device and sent to the backend per request over TLS; they are never persisted or logged server-side and are not shared between users. A server-managed default provider is offered, with its key held only in server configuration. (See Clarifications, FR-016, FR-024.)
- **Provider neutrality**: "Configurable LLM provider" means support for any OpenAI-compatible endpoint (including self-hosted/local models) and Anthropic, chosen by the user, with a server-configured provider as the default that produces grounded answers out of the box. (See Clarifications, FR-021.)
- **Backend-mediated chat**: The chat is served by a backend component that runs the danni-bg mirror tools and brokers LLM calls; the browser never contacts the mirror tools or the provider directly. (See Clarifications, FR-016.)
- **Map geometry**: Administrative-boundary polygons are not assumed to exist in the mirror; a bundled open boundary dataset supplies province/municipality geometry, joined to mirror geographic entities by official administrative code. (See Clarifications, FR-006a.)
- **Grounding mechanism**: "Grounded" means the assistant answers strictly from data retrieved from the mirror at question time and cites it; it does not rely on the model's training knowledge for factual claims about Bulgarian public data.
- **Language**: The UI and chat support Bulgarian and English; machine-translated text is labelled as such, reflecting translation-confidence already present in the mirror.
- **Platform**: Target is a desktop-first responsive web browser experience; full mobile optimization is a later enhancement.
- **Withdrawn datasets**: Datasets withdrawn at the source are hidden by default and surfaced only when the user explicitly opts to include them.
- **Scale**: The mirror holds on the order of thousands of datasets and very large individual resources (hundreds of thousands to millions of rows); the explorer must summarize/sample rather than attempt to load entire large resources into the UI or a single chat answer.
