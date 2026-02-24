# Bowtie Analysis Tool (Structured Analytic Techniques)

This is a lightweight, browser-based **Bowtie Analysis** builder for structured analysis. It helps you map a **Top Event** (loss of control) and connect it to **Threats** (causes) on the left and **Consequences** (outcomes) on the right—then deepen the analysis with **Barriers**, **Escalation Factors**, and **Escalation Factor Barriers**.

![Bowtie Analysis UI](assets\img\bowtie-ui.png)

## What it does

- **Creates a nested Bowtie structure** around a fixed root **Top Event**.
- Lets you build both sides of the bowtie:
  - **Left side (prevention chain):** Threat → Preventive Barrier → Escalation Factor → Escalation Factor Barrier
  - **Right side (mitigation chain):** Consequence → Recovery Barrier → Escalation Factor → Escalation Factor Barrier
- Includes a **Hazard** node above the Top Event to describe the risky activity or context.
- Automatically **centers and reflows** children around their parent so the diagram stays readable as it grows.
- Draws connectors between nodes to show relationships.
- Provides **“?” info tooltips** for each lane/type (Hazard, Threat, Consequence, barriers, escalation factors).

## How to use

- **Add nodes:** click the **+** buttons on a node to add children on the appropriate side.
- **Edit text:** click into a node and type.
- **Delete nodes:** use the **−** button (deletes the node and its descendants).
- **Navigate:** pan by dragging the background; zoom with the mouse wheel.

## Import / Export

Use the **File** menu:
- **Download JSON** exports the current bowtie as a nested JSON file.
- **Import JSON** loads a previously exported JSON file and recreates the diagram.

## Data model (high level)

The diagram is stored as a nested tree:
- Root is the **Top Event** (`root`)
- Children branch left/right using `side: "left" | "right"`
- Deeper levels represent barriers and escalation structures

A separate `hazard` field stores the Hazard text shown above the Top Event.

## Run locally

Open the HTML file in a browser (no build step required):

- Double-click the `.html` file, or
- Serve the folder with any static server (optional)

```bash
# example (optional)
python -m http.server 8000