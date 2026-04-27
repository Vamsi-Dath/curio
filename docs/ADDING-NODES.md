# Adding a New Node to Curio

This guide walks through every step needed to add a new dataflow node to Curio. The `DATA_SUMMARY` node is used as a concrete worked example throughout.

## Table of Contents

- [Architecture overview](#architecture-overview)
- [Step 1 – Declare the node type](#step-1--declare-the-node-type)
- [Step 2 – Create a lifecycle hook](#step-2--create-a-lifecycle-hook)
- [Step 3 – Export the lifecycle hook](#step-3--export-the-lifecycle-hook)
- [Step 4 – Register a node descriptor](#step-4--register-a-node-descriptor)
- [Step 5 – Register the node on the backend](#step-5--register-the-node-on-the-backend)
- [Step 6 – Add a Python template](#step-6--add-a-python-template)
- [Checklist](#checklist)

---

## Architecture overview

Every node in Curio is defined by two collaborating objects:

| Object | File | Purpose |
|--------|------|---------|
| `NodeDescriptor` | `src/registry/descriptors.ts` | Static metadata: label, icon, ports, editor type |
| `NodeAdapter` (part of descriptor) | same file | Runtime wiring: handles, editor config, lifecycle hook |

A single React component, `UniversalNode.tsx`, renders **all** node types by reading the descriptor at render time. You never write a new React component for a new node type.

Data execution happens in the sandbox. For Python nodes the frontend sends code to `POST /processPythonCode`; the sandbox wraps it in `python_wrapper.txt` and executes it in-process. For JavaScript nodes the frontend sends code to `POST /processJavaScriptCode`; the sandbox spawns a `node` subprocess per request.

```
Frontend (UniversalNode)
    │  descriptor lookup
    ▼
NodeDescriptor ──► NodeAdapter ──► useLifecycle hook
                                        │
                                        ▼
                              NodeEditor (code / grammar / widgets)
                                        │
                          ┌─────────────┴──────────────┐
                          │  POST /processPythonCode    │  POST /processJavaScriptCode
                          ▼  (Python nodes)             ▼  (JavaScript nodes)
                   Flask backend ──► Sandbox /exec   Sandbox /execJs → node subprocess
                                        │
                                        ▼
                              outputCallback ──► downstream nodes
```

---

## Step 1 – Declare the node type

Add the new identifier to the `NodeType` enum in
[`src/constants.ts`](../utk_curio/frontend/urban-workflows/src/constants.ts).

```ts
// src/constants.ts
export enum NodeType {
  // ... existing entries ...
  DATA_SUMMARY = "DATA_SUMMARY",   // ← add this
}
```

The string value must be **identical** to the key (screaming-snake-case). It is used as a map key across the frontend registry, the backend registry, template folder names, and the provenance database.

---

## Step 2 – Create a lifecycle hook

A lifecycle hook is a React custom hook with the signature:

```ts
type NodeLifecycleHook = (data: NodeLifecycleData, nodeState: UseNodeStateReturn) => LifecycleResult;
```

Create a new file in
[`src/adapters/node/`](../utk_curio/frontend/urban-workflows/src/adapters/node/).

**`src/adapters/node/dataSummaryLifecycle.tsx`**
```tsx
import React from 'react';
import { NodeLifecycleHook } from '../../registry/types';
import OutputContent from '../../components/editing/OutputContent';

export const useDataSummaryLifecycle: NodeLifecycleHook = (_data, nodeState) => {
  const contentComponent = React.useMemo(
    () => <OutputContent output={nodeState.output} />,
    [nodeState.output],
  );

  return { contentComponent };
};
```

`LifecycleResult` fields you can return (all optional):

| Field | Type | Effect |
|-------|------|--------|
| `contentComponent` | `React.ReactNode` | Custom content rendered inside the node body |
| `defaultValueOverride` | `string` | Pre-populates the code editor on first use |
| `applyGrammar` | `(spec: string) => Promise<void>` | Called when the grammar editor is applied (grammar nodes only) |
| `dynamicHandles` | `HandleDef[]` | Extra handles generated at runtime |
| `sendCodeOverride` | `any` | Replaces the default "run code" action |
| `setOutputCallbackOverride` | `any` | Intercepts the output set call (e.g. to fetch and render richer content) |
| `outputOverride` | `ICodeData` | Overrides the output state managed by `useNodeState` |
| `disablePlay` | `boolean` | Hides the play button |
| `showLoading` | `boolean` | Shows a loading spinner |

**Pre-populating the code editor.** Return `defaultValueOverride` with the default code string to load it automatically when the node is first dropped onto the canvas. To avoid overwriting code the user has already saved in a workflow, guard it with `data.defaultCode`:

```ts
const DEFAULT_CODE = `import pandas as pd\n\ndf = arg\n\nreturn df.describe()`;

const defaultValueOverride = data.defaultCode ? undefined : DEFAULT_CODE;

return { contentComponent, defaultValueOverride };
```

For a code-execution node like `DATA_SUMMARY`, returning only `contentComponent` is sufficient — the framework handles sending code and propagating the output downstream automatically.

---

## Step 3 – Export the lifecycle hook

Add the export to
[`src/adapters/node/index.ts`](../utk_curio/frontend/urban-workflows/src/adapters/node/index.ts)
so the descriptor file can import it by name.

```ts
// src/adapters/node/index.ts
export { useDataSummaryLifecycle } from './dataSummaryLifecycle';  // ← add this
```

---

## Step 4 – Register a node descriptor

Open [`src/registry/descriptors.ts`](../utk_curio/frontend/urban-workflows/src/registry/descriptors.ts)
and add:

1. **Import the icon** from `@fortawesome/free-solid-svg-icons`.
2. **Import the lifecycle hook** from `../adapters/node`.
3. **Call `registerNode()`** with a `NodeDescriptor` object.

```ts
// 1. Add to the icon import block
import { /* existing icons */, faRectangleList } from '@fortawesome/free-solid-svg-icons';

// 2. Add to the adapter import block
import {
  /* existing imports */,
  useDataSummaryLifecycle,
} from '../adapters/node';

// 3. Register the node (place it in the appropriate section)
registerNode({
  id: NodeType.DATA_SUMMARY,
  category: 'computation',
  label: 'Data Summary',
  icon: faRectangleList,
  inputPorts:  [{ types: TABULAR_DATA, cardinality: '1' }],
  outputPorts: [{ types: [SupportedType.JSON], cardinality: '1' }],
  editor: 'code',
  inPalette: true,
  paletteOrder: 10,
  description: 'Computes descriptive statistics and schema information for a DataFrame.',
  hasCode: true,
  hasWidgets: false,
  hasGrammar: false,
  adapter: {
    handles: standardInOut(),
    editor: { code: true, grammar: false, widgets: false },
    container: { handleType: 'in/out' },
    inputIconType: '1',
    outputIconType: '1',
    showTemplateModal: true,
    useLifecycle: useDataSummaryLifecycle,
  },
});
```

### Key descriptor fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | `NodeType` | Must match the enum value from Step 1 |
| `category` | `'data' \| 'computation' \| 'vis_grammar' \| 'vis_simple' \| 'flow'` | Groups nodes in the palette |
| `inputPorts` / `outputPorts` | `PortDef[]` | Each port has `types` (array of `SupportedType`) and `cardinality` (`'1'`, `'n'`, `'[1,n]'`, etc.) |
| `editor` | `'code' \| 'grammar' \| 'none'` | Determines which editor panel is shown |
| `inPalette` | `boolean` | Whether the node appears in the drag-and-drop palette |
| `paletteOrder` | `number` | Sort order within the palette |
| `adapter.handles` | `HandleDef[]` | Use helpers: `standardInOut()`, `outputOnly()`, `inputOnly()`, `withBidirectional(...)` |
| `adapter.editor.widgets` | `boolean` | **Must be `true` for any node that executes Python code.** `WidgetsEditor` is the component that resolves code markers and fires the execution chain — without it, the play button sets `output.code = "exec"` but `interpretCode` is never called and the spinner loops forever. Set `disableWidgets: true` alongside it to hide the empty panel if the node defines no markers. |
| `adapter.useLifecycle` | `NodeLifecycleHook` | The hook created in Step 2 |

### Port cardinality

| Value | Meaning |
|-------|---------|
| `'1'` | Exactly one connection |
| `'n'` | Any number of connections |
| `'[1,n]'` | One or more connections |
| `'[1,2]'` | One or two connections |
| `'2'` | Exactly two connections |

### Handle helpers

| Helper | Layout | Typical use |
|--------|--------|-------------|
| `standardInOut()` | Left target + right source | Most data/computation nodes |
| `outputOnly()` | Right source only | Source nodes (e.g. `DATA_LOADING`) |
| `inputOnly()` | Left target only | Sink nodes (e.g. `DATA_EXPORT`) |
| `withBidirectional(base)` | `base` + top source | Visualization nodes that send interactions back |

---

## Step 5 – Register the node on the backend

Open [`utk_curio/backend/app/api/routes.py`](../utk_curio/backend/app/api/routes.py)
and add an entry to `_node_type_registry`. This dictionary tells the backend which data types the node accepts and produces, enabling provenance tracking and template discovery to work correctly even before the frontend has connected.

```python
# utk_curio/backend/app/api/routes.py
_node_type_registry: dict = {
    # ... existing entries ...
    "DATA_SUMMARY": {"inputTypes": ["DATAFRAME", "GEODATAFRAME"], "outputTypes": ["JSON"]},
}
```

The keys in `inputTypes` and `outputTypes` must match the string values of `SupportedType` in `constants.ts` (`"DATAFRAME"`, `"GEODATAFRAME"`, `"VALUE"`, `"LIST"`, `"JSON"`, `"RASTER"`).

---

## Step 6 – Add a Python template

Templates are Python files stored under `templates/<node_type_lower>/`. The folder name is the node type in lowercase (e.g. `DATA_SUMMARY` → `templates/data_summary/`).

**`templates/data_summary/Summary.py`**
```python
import pandas as pd

df = arg  # Getting DataFrame from previous node

summary = {
    "shape": {"rows": int(df.shape[0]), "columns": int(df.shape[1])},
    "dtypes": df.dtypes.astype(str).to_dict(),
    "missing": df.isnull().sum().to_dict(),
    "describe": df.describe(include="all").fillna("").to_dict(),
}

return summary
```

Two conventions to follow:

- **`arg`** is the injected variable name for the node's input, provided by `python_wrapper.txt`.
- **`return`** the output value directly — do not call `print()`. The sandbox captures the return value and serialises it to a memory-mapped file that the frontend reads.

The template will appear automatically in the "Load Template" modal when a user opens a `DATA_SUMMARY` node (because `showTemplateModal: true` is set in the descriptor).

---

---

## JavaScript nodes

JavaScript nodes (`JS_COMPUTATION`) follow the same registry-based pattern but differ from Python nodes in a few ways.

### What's the same

- Add `NodeType.JS_COMPUTATION` to the enum — Steps 1–4 are identical.
- Use `useCodeNodeLifecycle` as the lifecycle hook (no new lifecycle needed).
- `UniversalNode.tsx` renders JS nodes exactly like Python nodes.

### What's different

| Aspect | Python nodes | JavaScript nodes |
|--------|-------------|-----------------|
| Backend endpoint | `POST /processPythonCode` | `POST /processJavaScriptCode` |
| Sandbox endpoint | `POST /exec` (in-process `exec()`) | `POST /execJs` (Node.js subprocess) |
| Code wrapper | `python_wrapper.txt` | Inline async function in temp `.js` file |
| Monaco language | `python` | `javascript` (set automatically for `JS_COMPUTATION`) |
| Descriptor icon | `@fortawesome/free-solid-svg-icons` | `@fortawesome/free-brands-svg-icons` (`faJs`) |
| `hasWidgets` | typically `true` | `false` (widget markers not supported in JS yet) |
| Template files | `.py` files under `templates/<type>/` | Not yet supported |

### Descriptor example

```ts
import { faJs } from '@fortawesome/free-brands-svg-icons';

registerNode({
  id: NodeType.JS_COMPUTATION,
  category: 'computation',
  label: 'JS Computation',
  icon: faJs,
  inputPorts: [{ types: ALL_TYPES, cardinality: '[0,1]' }],
  outputPorts: [{ types: ALL_TYPES, cardinality: '[0,1]' }],
  editor: 'code',
  inPalette: true,
  paletteOrder: 11,
  description: '...',
  hasCode: true,
  hasWidgets: false,   // ← must be false for JS nodes
  hasGrammar: false,
  adapter: {
    handles: standardInOut(),
    editor: { code: true, grammar: false, widgets: false },
    container: { handleType: 'in/out' },
    useLifecycle: useCodeNodeLifecycle,
  },
});
```

### User code conventions

- `arg` receives the input value from the upstream node (or `null` if none).
- Use `return` to pass the output downstream — there is no `print()` equivalent.
- `console.log(...)` output is captured and shown in the node's output panel.
- `require()` is not available — no npm module imports.

---

## Checklist

Use this checklist when adding any new node:

- [ ] `NodeType.<NAME>` added to the enum in `src/constants.ts`
- [ ] `use<Name>Lifecycle` hook created in `src/adapters/node/<name>Lifecycle.tsx`
- [ ] Hook exported from `src/adapters/node/index.ts`
- [ ] Icon imported and `registerNode()` called in `src/registry/descriptors.ts`
- [ ] Entry added to `_node_type_registry` in `utk_curio/backend/app/api/routes.py`
- [ ] *(Python nodes only)* Template file(s) added under `templates/<node_type_lower>/`
- [ ] *(JS nodes only)* Icon from `@fortawesome/free-brands-svg-icons`; `hasWidgets: false` in descriptor
