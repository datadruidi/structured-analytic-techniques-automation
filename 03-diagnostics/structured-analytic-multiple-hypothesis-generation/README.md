# Multiple Hypothesis Generation

This module has two main views, switched by the top buttons: **Hypothesis Generation** and **Hypothesis Ranking**.

- **Hypothesis Generation** — Build a tree from source items by choosing **Who?**, **What?**, or **Why?** for each. The left panel lists items from a source file; the right shows columns (Who → What → Why → Permutations) with drag-to-reorder and editable cards.
- **Hypothesis Ranking** — Rank and assign hypotheses into five slots (H1–H5). The left panel lists items from **Hypotheses.txt** (reorder by drag); the right shows five hypothesis cards. Drag items from the left into a card’s title area, edit descriptions, and use **Save Hypothesis for ACH** to export to the Structured Analysis of Competing Hypotheses module.

## Screenshots

**Hypothesis Generation** — Source list, tree workspace (Who / What / Why / Permutations), and Generate flow.

![Hypothesis Generation UI](assets/img/hypothesis-generation-ui.png)

**Hypothesis Ranking** — Left list (Hypotheses.txt) and right-side H1–H5 cards with drag-and-drop and Save for ACH.

![Hypothesis Ranking UI](assets/img/hypothesis-ranking-ui.png)

## Running the app

- **Via hub:** From the repo root run `node start-all.js`, then open the hub at **http://localhost:3000** and click the link to this app. The app runs on **http://localhost:8083** (port per `HUB-PAGE-INSTRUCTIONS.md`).
- **Standalone:** Run `node server.js` in this folder, then open **http://localhost:8083**. Do not open `index.html` via `file://` or the source file will not load.

## Data files

| File | Purpose |
|------|--------|
| **input/Multiple_Hypothesis_Generation.txt** | Source list for the **Hypothesis Generation** view. The **Update** button reads this file. Each line (after stripping a leading `- `) is shown in the left panel as a row with a **Generate** button. Updated when you add items or when the Circleboarding app writes “Save for Hypothesis Generation”. |
| **Hypotheses.txt** | Source list for the **Hypothesis Ranking** view. Lines appear in the left panel; you reorder by drag and assign items to H1–H5 cards. The server overwrites this file when you remove items or reorder. |

## Hypothesis Generation workflow

1. **Source list (left):** Items from **input/Multiple_Hypothesis_Generation.txt** (and any you add with **Add +**) appear as rows with a **Generate** button. Use **Update** to re-read the file.
2. **Generate:** Click **Generate** on an item → popup asks **Who?**, **What?**, **Why?** (What and Why unlock after you have at least one Who or What). Choose one → the item becomes a card in that column.
3. **Tree:** Columns are Who → What → Why → **Permutations**. Cards can be dragged to reorder within a column; card text is editable. Use **Clear** to reset the tree and **Update** to propagate What/Why to new Who branches.
4. **Save:** Use **Save hypothesis** on a permutation row to append that line to **Hypotheses.txt** and to write that title into **hypothesis.json** for ACH (first permutation → H1, second → H2, … up to H5). Add descriptions later in Hypothesis Ranking.

## Hypothesis Ranking workflow

1. **Left list:** Loaded from **Hypotheses.txt**. Drag to reorder; use the edit (pencil) to change text or color, or the trash to delete (updates the file).
2. **Right cards (H1–H5):** Drag items from the left into a card’s **Title** drop zone. Optionally fill **Description** and use **Save Hypothesis for ACH** to write that hypothesis to the Structured Analysis of Competing Hypotheses module (`hypothesis.json`).
3. Cards can be collapsed/expanded with **Hide** / **Show**.

## Source of Multiple_Hypothesis_Generation.txt (optional)

1. Run the Circleboarding app from **02-exploration/structured-analytic-circleboarding** (`node server.js`, **http://localhost:8082**).
2. Add or drag items into the **So what?** section, then click **Save for Hypothesis Generation**.
3. The file is written here with a “So What?” header and `- item` lines.

## Port

This app’s server uses **port 8083** (see repo root `HUB-PAGE-INSTRUCTIONS.md`).

---

## Input / output (import vs export)

**Import (source files):**

1. **input/Multiple_Hypothesis_Generation.txt** — Plain text. Optional first line: `So What?`. Then one item per line; lines starting with `- ` have the hyphen stripped. Each line becomes a row in the Hypothesis Generation source list.
2. **Hypotheses.txt** — Plain text, one hypothesis per line. Lines appear in the Hypothesis Ranking left panel; order is preserved. The server overwrites this file when you reorder or remove items.

**Export:**

1. **Save hypothesis** (from a Permutation row) — Appends that line to **Hypotheses.txt** and writes that permutation’s title to **hypothesis.json** (H1–H5 by tree order; descriptions can be added in Hypothesis Ranking).
2. **Save Hypothesis for ACH** (from an H1–H5 card) — Writes that card’s title and description to **hypothesis.json** in `03-diagnostics/structured-analysis-of-competing-hypothesis/`. The file has `intelligence_requirement` and `H1`…`H5` (each `{ id, title, description }`). The **id** field is optional when reading (ACH infers it from the key).

**Example input/Multiple_Hypothesis_Generation.txt:**

```
So What?
- Local forces
- Force buildup
- Forward deploy
```

**Example Hypotheses.txt:**

```
Move forward to launch fast.
Negotiate under sustained pressure.
Maneuver to set conditions.
```

**Example hypothesis.json (for ACH):**

```json
{"intelligence_requirement":"Short-term trajectories","H1":{"id":"H1","title":"Rapid expansion","description":"Increases capacity in the short term."},"H2":{"id":"H2","title":"Quality focus","description":"Prioritizes efficiency over size."}}
```
