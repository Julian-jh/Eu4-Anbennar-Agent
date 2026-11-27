# Data workspace

Start the local workbench and open **Data → Sources**. The Sources page uses the PostgreSQL backend. The other Data menus use the browser's dataset workspace. See the [backend setup and permissions](../../ai-center-backend/README.md).

## 1. Navigation

```text
Data                                 top navigation
├─ Sources                            sidebar
│  └─ Source → Connection | Asset preview
├─ Storages                           sidebar
│  └─ Storage location → Configuration and linked datasets
├─ Datasets                           sidebar
│  ├─ Folder rail → Create dataset | Import tables | Manage layers | Folder tree
│  ├─ Import tables → Database inventory → Warehouse destination → Import results
│  ├─ Catalog → Current folder and dataset list
│  └─ Dataset → Overview | Data preview | Documents or Fields | Retrieval | Schedule | Lineage
├─ Jobs                               sidebar
│  └─ Job history | Dataset schedules
├─ Taxonomy                           sidebar
│  ├─ Domains → Domain definitions, totals and assigned assets
│  ├─ Subjects → Subject definitions, totals and tagged assets
│  └─ Matrix → Active dataset counts by domain and subject
└─ Archive                            sidebar
   └─ Archived datasets → Restore
```

Each dataset or source can have one optional **Domain** and any number of **Subjects**. In **Taxonomy**, use **Add datasets** on a domain to set its members’ primary domain, or on a subject to add that topic to their existing subjects. Each vocabulary has its own **Unassigned** folder. A dataset’s **Overview** edits the same domain and subject assignments independently.

**Matrix** shows domains as rows and subjects as columns. Each cell counts active datasets and displays **0** when none match. A dataset with several subjects counts once in each corresponding column. **No domain** and **No subjects** identify missing assignments. A dataset missing both counts where that row and column meet.

**Sources** manages real PostgreSQL connections. Test a draft with a one-time password, then explicitly save credentials for background operations. Run a catalog sync to discover tables and views. Row previews are masked by default. Viewing authorized original values requires the corresponding permission and approved columns.

## 2. Submenu responsibilities

| Submenu | Purpose | Managed objects | Primary actions |
|---|---|---|---|
| Sources | Establish where data comes from and check connectivity. | PostgreSQL connections, catalog snapshots and sync health | Connect, test, sync and preview. |
| Storages | Define where datasets are written. | Named storage locations and the active or archived datasets using them | Configure a destination by type, test its settings, inspect usage and remove an unused location. |
| Datasets | Prepare warehouse records and build searchable collections. | Raw and detail layers, upstream assets, storage, transformations, schedules and indexes | Create a layer or dataset, materialize and export rows, explore lineage, schedule jobs, build retrieval and archive. |
| Jobs | Investigate local dataset operations. | Dataset run history, failure details, retry attempts and schedule inventory | Filter by job type or status, inspect results, retry a failure or edit a dataset schedule. |
| Taxonomy | Classify assets by business area and topic. | Domain and subject definitions, asset assignments and usage counts | Define a domain or subject, classify assets singly or in bulk and compare active dataset counts in the matrix. |
| Archive | Find older collections and return them to active use. | Archived datasets, retained documents, configuration and storage references | Search the archive and restore a dataset. |

## 3. Try the lifecycle

1. Open **Sources** and sign in. An empty workspace has no connections. Add your PostgreSQL source, test its connection, save its credentials and sync the catalog. Open a published table to inspect its fields and permitted preview.
2. Open **Datasets → Reign detail** to try a local warehouse workflow. Refresh the detail dataset from **Overview** to materialize the retained upstream rows. Select the **Schedule** tab to choose an operation and recurrence. **Jobs → Dataset schedules** lists upcoming runs. Source sync status is available in **Sources**.
3. For **Mission reference**, choose indexed documents under **Documents**. In **Retrieval**, configure parsing, chunking, embeddings and index type, then build the index. Try a document search in **Data preview**. Changing the document selection makes the index **Rebuild required**. For **Reign detail**, use **Retrieval** to choose filter and return fields and add an equality index on `country_tag`. In **Data preview**, try `country_tag = FRA`, `start_date ≤ 1444-11-11`, and `end_date > 1444-11-11` to retrieve Charles VII and the source row.
4. Open **Taxonomy → Subjects** and choose **Add datasets** beside **Dynastic succession**. Select **Reign detail** and save. In a fresh workspace its **Overview** now shows the domain **Governance & succession** and two subjects, **Monarchs and reigns** and **Dynastic succession**. In **Matrix**, the dataset counts once in each of those subject columns on the **Governance & succession** row. Changing just its domain moves both counts to the new row.
5. On a dataset's **Overview**, choose **Archive dataset**. Its data, source link, storage choice, configuration, classifications and history are retained. Its schedule stops. Archiving disables structured queries and withdraws document indexes. **Archive → Restore** makes retained table rows available for queries again. Restore and rebuild a document index to resume RAG. Re-enable schedules separately.

The backend persists source configuration and catalog snapshots in PostgreSQL. Other menus keep their demo data in the browser. Existing datasets retain their materialized rows, recorded source names and lineage after local demo connections are removed. Document searches match text in the last published index. Structured queries apply all configured conditions to current materialized rows. The local dataset scheduler checks while the page is open and runs one catch-up job on reopening when a schedule is overdue.

## Warehouse records and lineage

The **Datasets → Import tables** screen currently belongs to the local demo. Importing tables from a backend-managed connection requires the Datasets integration. Existing ODS and DWD examples remain available for previews, lineage and exports.

In **Storages → Add storage**, choose a type. A local folder takes a path. S3 takes a bucket and an optional key prefix. For PostgreSQL, enter the host, port, database, schema and username in separate fields. The password field is temporary. **Test connection** validates the settings locally in this frontend demo. A successful test confirms the profile format. Server reachability, authentication and write access require a live backend.

The saved destination becomes available when creating, importing or editing datasets. Open a location to see which active and archived datasets reference it. You can rename a location while it is in use. Changing its address or deleting it requires moving those references first.

Open **Data preview** on a dataset to inspect its stored contents. It requests up to 15 records or documents per page. Choose a page below the results to fetch it. Open a row for its complete values or a document for its text and source locator. **Download records** exports the entire active dataset. The bundled **Mission reference** example has 18 entries, so page 2 starts at entry 16.

**Datasets → Folders** organizes the catalog into nested directories. Choose a parent to browse its active datasets and those in its subfolders. Search and layer filters apply within that scope. The catalog shows 25 results per page. Open **⋯** on **All datasets** to create a top-level folder. Each folder’s **⋯** menu lets you rename it, create a subfolder, move the branch or remove an empty folder. Archived datasets count as folder contents.

On a dataset's **Overview**, the **Folder** property shows its path. Choose **Move to folder**, expand the destination tree, select a folder and confirm. **Unfiled** clears the assignment. Select rows across catalog pages and use **Move selected** for the same workflow in bulk. Both operations keep the current view. Folder moves preserve dataset IDs, layers and lineage. Archived datasets retain their folder when restored.

Use **Archive selected** to retain the selected datasets for restoration, or **Delete selected** to remove their stored data and configuration permanently. The confirmation lists the selected names and count across catalog pages. Deletion checks downstream dependencies, including archived datasets. Past jobs retain the names of deleted datasets in their history.

**Run selected** runs an ingestion, refresh or index rebuild across the selection. Ingestion and refresh process selected upstream tables first. When rebuilding indexes in a mixed selection, structured tables are marked **Skipped**. The result shows each dataset's status and job ID. The batch ID can be searched in **Jobs**.

**Export selected** downloads one JSON file containing every selected dataset's records, source locators and warehouse metadata. Cross-page selections are included. The file contains dataset data and source identifiers. Connection settings are kept in Sources.

**ODS** stores the selected source asset’s fields and row values. **DWD** reads an active raw dataset. Its definition records the grain of each detail row and can specify a field for deduplication. Materialization trims surrounding whitespace in text fields and keeps a locator for each retained input row. Documents excluded from a RAG index still participate in warehouse transformations. The catalog supports custom layers with raw or detail behavior. The demo materializes datasets locally in browser storage.

Select **Reign detail** from the dataset list and open **Lineage**. Its path is **Reign register / public.reigns → Monarchs and reigns (ODS) → Reign detail (DWD)**. The detail table supports direct structured lookup. **Mission reference** shows a document index as a downstream node. Select a node to inspect its input, storage or retrieval state. Archiving a raw input retains its materialized outputs, and subsequent detail refreshes fail until that input is available again.

For a scheduling demonstration, select **Every minute**, then save and enable the schedule. The dataset shows the upcoming run and latest scheduled job result. Use the **Jobs** submenu to inspect run details. Daily and weekly plans support a wall-clock time in UTC, Dubai or Shanghai. The scheduler processes due raw datasets before their detail datasets in the same batch. A daily or weekly job missed while the browser was closed runs once when the workspace reopens.

## RAG ownership

The Data workspace owns per-dataset document inclusion, parsing, chunking, embedding profiles, indexes, retrieval defaults and index health. The semantic model owns domain names and aliases, entity relationships and rules for choosing the appropriate corpus or version for a question. The assistant can bind a published model and apply its own query-time retrieval policy. Changing a term such as “ruler” to recognize an additional alias does not require re-embedding a dataset.
