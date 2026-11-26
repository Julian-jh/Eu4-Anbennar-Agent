# Data workspace

Open the frontend's `index.html` and choose **Data**. The five sidebar entries stay visible as you move between a source, a dataset and its run history.

## 1. Navigation

```text
Data                                 top navigation
├─ Sources                            sidebar
│  └─ Source → Connection | Asset preview
├─ Datasets                           sidebar
│  ├─ Folder rail → Create dataset | Manage layers | Folder tree
│  ├─ Catalog → Current folder and dataset list
│  └─ Dataset → Overview | Data preview | Documents or Fields | Retrieval | Schedule | Lineage
├─ Jobs                               sidebar
│  └─ Job history | Dataset schedules
├─ Taxonomy                           sidebar
│  └─ Business domains → Subject areas, Asset assignments
└─ Archive                            sidebar
   └─ Archived datasets → Restore
```

The first three pages have tabs. Taxonomy presents the hierarchy and its assignments on one page. Restore is a row action in Archive.

## 2. Submenu responsibilities

| Submenu | Purpose | Managed objects | Primary actions |
|---|---|---|---|
| Sources | Establish where data comes from and check connectivity. | Database, file, folder and URL connections, exposed assets and sync health | Connect, test, sync and preview. |
| Datasets | Prepare warehouse records and build searchable collections. | Raw and detail layers, upstream assets, storage, transformations, schedules and indexes | Create a layer or dataset, materialize and export rows, explore lineage, schedule jobs, build retrieval and archive. |
| Jobs | Investigate operations across sources and datasets. | Run history, failure details, retry attempts and schedule inventory | Filter by job type or status, inspect results, retry a failure or edit a dataset schedule within Jobs. |
| Taxonomy | Classify assets under a common business vocabulary. | Domains, their child subject areas and source or dataset assignments | Define a domain, maintain its subjects and classify assets. Moving a subject moves its assigned assets with it. |
| Archive | Find older collections and return them to active use. | Archived datasets, retained documents, configuration and storage references | Search the archive and restore a dataset. |

## 3. Try the lifecycle

1. Open **Sources → Anbennar mission notes → Connection**. Test the connection, sync the inventory and review its linked dataset names. Select **Datasets** from the sidebar and open **Mission reference** to see the source asset and storage destination. To try a different pairing, choose the **Create dataset** icon in the folder rail.
2. On **Overview**, refresh the existing dataset or ingest a newly created raw dataset. Select the **Schedule** tab to choose an operation and recurrence. **Jobs → Dataset schedules** lists upcoming runs and offers **Schedule a job**. For a failure example, filter **Job history** by **Failed** and retry the sample mission refresh. The result identifies the new attempt. Open that attempt from the history list.
3. For **Mission reference**, choose indexed documents under **Documents**. In **Retrieval**, configure parsing, chunking, embeddings and index type, then build and try a search. Changing the document selection makes the index **Rebuild required**. For **Reign detail**, use **Retrieval** to choose filter and return fields. Try `country_tag = FRA`, `start_date ≤ 1444-11-11`, and `end_date > 1444-11-11` to retrieve Charles VII and the source row. **Fields** shows the current table configuration.
4. Open **Taxonomy**. **Governance & succession** is the broad domain. **Monarchs and reigns** is a subject within it. The **Reign register** source and **Monarchs and reigns** dataset are assigned to that subject. A corpus identifies which world supplied the material. A subject identifies what it describes.
5. On a dataset's **Overview**, choose **Archive dataset**. Its data, source link, storage choice, configuration, classifications and history are retained. Its schedule stops. Archiving disables structured queries and withdraws document indexes. **Archive → Restore** makes retained table rows available for queries again. Restore and rebuild a document index to resume RAG. Re-enable schedules separately.

The demo stores changes in the browser. The named storage locations represent logical destinations. Connection checks, imports and index builds operate on local sample records. Document searches match text in the last published index. Structured queries apply all configured conditions to current materialized rows and return the selected columns and source locator. Model and index selections demonstrate configuration and rebuild behavior. The local scheduler checks while the page is open and runs one catch-up job on reopening when a schedule is overdue.

## Warehouse records and lineage

Open **Data preview** on a dataset to inspect its stored contents. It requests up to 15 records or documents per page. Choose a page below the results to fetch it. Open a row for its complete values or a document for its text and source locator. **Download records** exports the entire active dataset. The bundled **Mission reference** sample has 18 entries, so page 2 starts at entry 16. In an existing workspace, **Overview → Refresh now** imports the updated sample.

**Datasets → Folders** organizes the catalog into nested directories. Choose a parent to browse its active datasets and those in its subfolders. Search and layer filters apply within that scope. The catalog shows 25 results per page. Open **⋯** on **All datasets** to create a top-level folder. Each folder’s **⋯** menu lets you rename it, create a subfolder, move the branch or remove an empty folder. Archived datasets count as folder contents.

On a dataset's **Overview**, the **Folder** property shows its path. Choose **Move to folder**, expand the destination tree, select a folder and confirm. **Unfiled** clears the assignment. Select rows across catalog pages and use **Move selected** for the same workflow in bulk. Both operations keep the current view. Folder moves preserve dataset IDs, layers and lineage. Archived datasets retain their folder when restored.

Use **Archive selected** to retain the selected datasets for restoration, or **Delete selected** to remove their stored data and configuration permanently. The confirmation lists the selected names and count across catalog pages. Deletion checks downstream dependencies, including archived datasets. Past jobs retain the names of deleted datasets in their history.

**ODS** stores the selected source asset’s fields and row values. **DWD** reads an active raw dataset. Its definition records the grain of each detail row and can specify a field for deduplication. Materialization trims surrounding whitespace in text fields and keeps a locator for each retained input row. Documents excluded from a RAG index still participate in warehouse transformations. The catalog supports custom layers with raw or detail behavior. The demo materializes datasets locally in browser storage.

Select **Reign detail** from the dataset list and open **Lineage**. Its path is **Reign register / public.reigns → Monarchs and reigns (ODS) → Reign detail (DWD)**. The detail table supports direct structured lookup. **Mission reference** shows a document index as a downstream node. Select a node to inspect its input, storage or retrieval state. Archiving a raw input retains its materialized outputs, and subsequent detail refreshes fail until that input is available again.

For a scheduling demonstration, select **Every minute**, then save and enable the schedule. The dataset shows the upcoming run and latest scheduled job result. Use the **Jobs** submenu to inspect run details. Daily and weekly plans support a wall-clock time in UTC, Dubai or Shanghai. The scheduler processes due raw datasets before their detail datasets in the same batch. A daily or weekly job missed while the browser was closed runs once when the workspace reopens.

## RAG ownership

The Data workspace owns per-dataset document inclusion, parsing, chunking, embedding profiles, indexes, retrieval defaults and index health. The semantic model owns domain names and aliases, entity relationships and rules for choosing the appropriate corpus or version for a question. The assistant can bind a published model and apply its own query-time retrieval policy. Changing a term such as “ruler” to recognize an additional alias does not require re-embedding a dataset.
