# AI Center admin workbench

This is the product design for the visual administration frontend of the EU4 & Anbennar Agent. Its first user is an administrator connecting a source. Its first end-to-end workflow ends when a business user can ask a published assistant a question and an authorized operator can trace the answer to its source. The chat box and API clients consume the same assistant release.

## Navigation

The header’s **Appearance** control applies to all five work areas, forms, dialogs and diagrams. Dark mode uses black, white and neutral gray. **System** follows the operating system. **Light** and **Dark** persist a browser preference across visits. The [frontend design requirements](../前端设计要求.md) govern navigation, catalog layout and appearance.

The workspace header contains five navigation icons. On hover or keyboard focus, the icon rolls up and its name rises into the same button. The motion reverses on exit and is disabled when the user prefers reduced motion. Open **Data → Sources** on first entry. Data uses a lifecycle sidebar. The other areas use a navigation row below the header. Mark the current destination visually and expose it to assistive technology. The [Data workspace design](../data-menu/README.md) defines the sidebar and asset-level workflows.

| Top row | Destinations, in display order | Work covered |
|---|---|---|
| Data | Sources · Datasets · Jobs · Taxonomy · Archive | Connect and sync sources, prepare datasets for retrieval, monitor jobs, classify assets and restore archived collections. |
| Semantic layer | Model overview · Field mappings · Validation | Inspect entities and relationships, map source fields and test their meaning against sample records. |
| AI Center | Assistant configuration · Test & release · Runs · Performance · Evaluations | Configure an assistant, test and publish it, trace a request, inspect service metrics and compare answer quality. |
| External APIs | Connected services · Published APIs | Configure outbound service calls and manage the assistant endpoints available to client applications. |
| Workspace settings | Workspace defaults · Roles & permissions | Set project defaults and inspect or change effective access to a resource. |

Switch peer menus through their shared navigation and peer tabs through their tab bar. Resource tabs keep the selected resource, so **Connection** and **Asset preview** show the same source. Choose a record from its collection and return to that collection to open a sibling. In a detail view, show related tables and retry attempts as names or identifiers. Inspecting a lineage node updates its metadata in place. Include area, destination and resource identity in a shareable URL, restore the selection on Back, and check the current user's permissions when opening the link.

On narrow screens, wrap each navigation row independently. Keep the primary row above the secondary row, preserve reading and keyboard order, and keep labels readable. Show the active corpus (EU4, Anbennar or Real History), resource version and publication state beside the resource when they affect an action.

## Source connections

The list shows **source name, corpus, connection type and latest sync**. Its primary action is **Add source**. Opening a source shows connection settings, test history, linked datasets and inventory previews. In this frontend demo, tests validate the configuration against sample inventory. Live authentication and discovery require a connector running on a server with access to the source.

| Step in Add source | Administrator action | Feedback |
|---|---|---|
| Connect | Choose Database, File, Managed folder or URL. For PostgreSQL, MySQL or SQL Server, configure host, port, database and username. SQLite takes a file path. | Show validation errors and label simulated tests. Password input is cleared when testing or closing the form. |
| Discover | Register the database catalog. For a managed directory choose its root, optional subdirectory, extensions, recursion and parser. | Show inventory and sample content. The managed directory's metadata-only mode lists matching files. |
| Preview | Inspect the selected asset and sample content. | Database previews show fields and sample rows. Document previews retain references to pages or sections. |
| Save and use | Save the connection in **Sources**. In **Datasets → Import tables**, choose one or more database tables, their raw layer, folder and storage. Create a **DWD** dataset to consume materialized raw records. | **Schedule** sets recurring jobs. **Lineage** shows dependencies and document indexes. **Retrieval** configures RAG for documents, or filter fields and return columns for a structured table. |

Support empty sources, unreadable files, partial imports, expired credentials, and schema changes. Retain the last successful import when a later refresh fails. If a selected column disappears, identify affected mappings and assistants. For a live database, show the query time and surface the current schema error; cached previews must carry their capture time.

## Semantic model and assistant configuration

Use a three-part mapping editor. On the left, browse physical assets and fields. In the middle, define entities, aliases, relationships, and date rules. On the right, test a question against sample records and inspect the matched rows and citations. Record what a missing end date means for each source. An unrecorded historical date needs an “unknown” state; treating it as an ongoing reign can silently produce a wrong answer centuries later.

For example, a historical dataset might expose `countries`, `rulers`, and `reigns`. Map their IDs to **Country** and **Ruler**, and map each reign to **Ruler ruled Country during a period**. Preserve date precision and source references. Testing “Who ruled France on 11 November 1444?” should show the resolved country, applicable period, matched ruler, and supporting source. Restrict Real History to country and monarch names with the dates and evidence needed to identify them. EU4 and Anbennar can additionally define missions, events, conditions, effects, and their relationships.

The assistant editor binds a model, instructions, permitted semantic models, tools, skills, and optional sub-agents or workflows. Configure tool permissions, timeouts, and a per-run budget. The test console shows which configuration and access scope a test used. **Publish** creates a release that pins configuration and dependency versions. Show the diff and affected consumers before publishing. Rolling back selects an earlier release. For live sources, pins identify configuration versions; actual query evidence needs its own timestamp or retained snapshot.

## AI progress, performance, and quality

| Operator's question | Screen behavior |
|---|---|
| Where is this run now? | Show queued, running, waiting, completed, failed, or cancelled; current step, elapsed time, tool calls, retries, and last activity. Show completed/total steps when the workflow has a known total. Link a failed step to its tool and error. |
| How is the service performing? | Filter by assistant release, model, environment, and time window. Show request count, completion and error rates, median and p95 duration, token usage, and estimated cost when pricing is configured. Drill into matching runs. |
| Are answers getting better? | Compare a candidate release and the published release on the same versioned test set. Show expected versus actual answer, evidence correctness, access-scope checks, newly passing cases, and regressions. Include case counts and dataset version. |

A run detail links the user question, release, semantic mapping, source evidence, and final answer under one run ID. A reviewer can turn a reported mistake into a verified test case. For example, a case can check whether the assistant selected the reigning monarch instead of an heir by examining which source field was mapped.

## External APIs and workspace administration

**Outbound integrations** define the external service, allowed operations, authentication reference, request and response mappings, timeout, and retry policy. Test an operation with sample input before making it selectable as an assistant tool. A scheduled API import also appears under Data sources and references the same connection.

**Published APIs** expose selected assistant releases to client applications. Manage client identities, scopes, quotas, key rotation and revocation, and usage by client. Link an API request to its run. Show secret references and masked identifiers in the editor.

**Workspace defaults** cover display language and time zone, default model connection, run budget, trace retention, and who can publish. Show the inherited value in each editor and identify any resource-specific override. Put membership and role assignments beside the defaults so an administrator can see who is allowed to change them.

**Roles** are editable permission bundles. Start with the following defaults, allow one person to hold more than one role, and show effective access before saving a grant.

| Suggested role | Default scope and actions |
|---|---|
| Workspace administrator | Manage members, roles, grants, API clients, and project defaults. |
| Data steward | Connect, preview, and refresh assigned sources; edit and publish assigned semantic models. |
| Assistant designer | Configure and test assigned assistants; request or receive a separate release permission. |
| Operator or reviewer | Inspect permitted traces and metrics, verify feedback, and compare evaluations. |
| Chat user | Invoke assigned published assistants and see answers and citations allowed by their data grants. |

Separate permissions for viewing source metadata, previewing data, reading trace content, editing configuration, publishing, and managing credentials. Enforce access in backend operations as well as the UI. An assistant query uses the intersection of the caller's grants, the release's allowed resources, and the source's own restrictions. API clients follow the same rule. Record who changed a configuration, the version, and when.

## Delivery order and acceptance

1. **Sources and access.** Establish workspace identity and basic grants. Deliver the source list and one complete database connection flow. A steward can select tables, preview permitted rows, save the configuration, reopen it, and trace a preview to its source. Add File, Folder, and URL through the same flow.
2. **Meaning and publication.** Deliver field mapping, relationships, assistant binding, test, and publish. A user can ask the monarch question through the chat box and receive a cited answer. The published version remains stable while a designer edits its successor.
3. **Operations.** Deliver live runs, traces, performance metrics, evaluation sets, and release comparison. An operator can find an incorrect answer, identify its mapping, and demonstrate the correction against both the failed case and existing cases.
4. **Integrations and administration.** Expand API management, configurable roles, project defaults, and audit search. Verify that restricting a resource produces the same access outcome in the preview, chat box, and published API.
