# Notebook Convertor: Bidirectional Jupyter-Curio Conversion

## Problem Statement

### The Challenge

Data scientists and urban analysts face a common workflow friction:

1. **Jupyter Notebooks** are great for:
   - Exploratory data analysis
   - Interactive development
   - Quick prototyping
   - Sharing analysis with colleagues

2. **Curio Workflows** are great for:
   - Visual workflow organization
   - Provenance tracking
   - Collaborative design
   - Interactive parameter adjustment
   - Non-linear branching (what-if analysis)

3. **The Problem**: These two environments are siloed
   - Work in Jupyter, then manually recreate in Curio
   - Work in Curio, but can't easily share/run in Jupyter
   - No automatic dependency detection
   - Loss of context in conversion

### The Solution

**Notebook Convertor** provides **bidirectional conversion** between Jupyter notebooks and Curio workflows:

```
Jupyter Notebook ←→ Curio Workflow
   .ipynb         ←→  JSON Spec
```

This enables:
- ✅ Rapid prototyping in Jupyter
- ✅ Import into Curio for collaborative refinement
- ✅ Export from Curio for sharing/archival
- ✅ Automatic dependency detection (AST-based)
- ✅ Full provenance tracking
- ✅ Reusable workflow templates

---

## Architecture Overview

### How It Works

```
Input Notebook
      ↓
┌─────────────────────────────────────┐
│  Cell Analysis Phase                │
│  - Parse notebook cells             │
│  - Extract __trill_node__ metadata  │
│  - Analyze variable dependencies    │
│  - Detect visualization specs       │
└─────────────────────────────────────┘
      ↓
┌─────────────────────────────────────┐
│  Graph Construction Phase           │
│  - Build dependency graph           │
│  - Infer edges from variables       │
│  - Create node connections          │
│  - Topological sorting              │
└─────────────────────────────────────┘
      ↓
┌─────────────────────────────────────┐
│  Conversion Phase                   │
│  - Create TrillSpec nodes           │
│  - Generate TrillSpec edges         │
│  - Add metadata                     │
│  - Validate structure               │
└─────────────────────────────────────┘
      ↓
Output: Curio Workflow (JSON)
```

### Key Components

**NotebookConvertor.ts** (Main converter class)
- `notebookToTrill()`: Jupyter → Curio
- `trillToNotebook()`: Curio → Jupyter
- Node type inference
- Metadata extraction

**Supporting Modules**:
- `grammarDetection.ts`: Detect Vega-Lite/UTK specs
- `importEdges.ts`: Build dependency graph
- `codegen.ts`: Generate notebook code from nodes
- `parsing.ts`: Parse and extract code elements
- `types.ts`: TypeScript interfaces
- `graph.ts`: Graph operations (topological sort, etc.)

---

## Data Instructions

### Supported Data Sources

The notebook convertor works with data from various sources:

#### 1. Example Jupyter Notebooks

Available in `docs/examples/notebooks/`:

```
docs/examples/notebooks/
├── example10-original-notebook-W.ipynb    # Green Roofs example
├── example3-original-notebook-NW.ipynb    # Multi-node workflow
├── example5-original-notebook-W.ipynb     # Weather analysis
├── example7-original-notebook-W.ipynb     # Speed camera analysis
├── example8-original-notebook-W.ipynb     # Traffic violations
├── example9-original-notebook-W.ipynb     # Energy efficiency
└── screenshots/                           # Visual examples
    ├── conversion-process.png
    ├── metadata-structure.png
    ├── workflow-output.png
    └── ...
```

#### 2. Sample Datasets

Reference datasets available in `data/datasets/`:

```
data/datasets/
├── Milan_22.07.2022_Weather_File_UMEP_CSV.csv  # Weather data
├── R03_21-11_WGS84_P_SocioDemographics_MILANO_Selected.shp*  # Demographics
├── Census2020_BlockGroups.shp*                  # Census blocks
└── CitySurfaces_weights/                        # ML model weights
```

#### 3. Expected Data Format

**CSV Files**:
```
filename,temperature,humidity,date
sensor1,25.5,45,2024-01-01
sensor2,26.0,42,2024-01-01
```

**Shapefiles** (requires .shp, .shx, .dbf, .prj):
```
import geopandas as gpd
gdf = gpd.read_file('data.shp')
```

**GeoJSON**:
```
import json
with open('data.geojson') as f:
    geojson_data = json.load(f)
```

#### 4. Loading Data in Templates

```python
def _curio_node():
    """Load data from docs/examples/data/"""
    import pandas as pd
    import os
    
    # Reference relative to Curio root directory
    data_path = 'docs/examples/data/Green_Roofs.csv'
    
    if os.path.exists(data_path):
        data_df = pd.read_csv(data_path)
    else:
        # Fallback
        data_df = pd.DataFrame()
    
    return data_df
```

---

## Usage Steps

### Step 1: Choose Your Approach

#### Option A: Start with Jupyter Notebook

**When to use**: If you have existing analysis in Jupyter

1. **Structure your notebook** using templates from [IPYNB_USAGE.md](../IPYNB_USAGE.md)
   - Use the provided templates for each node type
   - Add `__trill_node__` and `__trill_connections__` metadata
   - Wrap code in `_curio_node()` function

2. **Example**: Basic data analysis notebook

```python
# Cell 1: Load data
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "DATA_LOADING",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {"inputs": [], "outputs": []}

def _curio_node():
    import pandas as pd
    data_df = pd.read_csv('docs/examples/data/Green_Roofs.csv')
    return data_df

_curio_output = _curio_node()
```

3. **Import to Curio**:
   - Go to Curio Projects page
   - Click "Import Notebook"
   - Select your .ipynb file
   - Workflow automatically created!

#### Option B: Start with Curio Workflow

**When to use**: If building visual workflows in Curio interface

1. **Design your workflow** in Curio UI
2. **Execute and validate**
3. **Export as notebook**:
   - Menu → "Export as notebook"
   - Browser downloads .ipynb file
   - Can now share or modify in Jupyter

### Step 2: Follow Node Type Templates

See [IPYNB_USAGE.md - Node Templates](../IPYNB_USAGE.md#node-templates) for:

| Node Type | Template | Example |
|-----------|----------|---------|
| DATA_LOADING | Load CSV/API | `pd.read_csv()` |
| DATA_CLEANING | Remove duplicates, handle NaN | `.dropna()` |
| DATA_TRANSFORMATION | Reshape data | `.pivot_table()` |
| COMPUTATION_ANALYSIS | Calculate metrics | `.groupby().agg()` |
| DATA_SUMMARY | Aggregate results | `.describe()` |
| VIS_VEGA | Create charts | Vega-Lite JSON |
| VIS_TABLE | Display table | Return DataFrame |
| VIS_TEXT | Display text | Return string |
| And 8 more... | See templates | See IPYNB_USAGE.md |

### Step 3: Use Naming Conventions

From [IPYNB_USAGE.md - Naming Conventions](../IPYNB_USAGE.md#naming-conventions):

```python
# Good variable naming for automatic detection
data_weather = pd.read_csv('file.csv')      # data_*
cleaned_weather = data_weather.dropna()     # cleaned_*
result_stats = cleaned_weather.describe()   # result_*
summary_avg = result_stats.mean()           # summary_*
```

### Step 4: Verify Conversion

#### For Notebook → Curio:

```python
from utk_curio.frontend.urban_workflows.src.NotebookConvertor import TrillNotebookConverter
import json

# Load and convert
with open('your_notebook.ipynb') as f:
    notebook = json.load(f)

converter = TrillNotebookConverter()
result = converter.notebookToTrill(notebook)

# Check for warnings
if result.get('warnings'):
    print("Warnings:", result['warnings'])

# Examine converted workflow
spec = result['trillSpec']
print(f"Nodes: {len(spec['dataflow']['nodes'])}")
print(f"Edges: {len(spec['dataflow']['edges'])}")
```

#### For Curio → Notebook:

```python
# Export from Curio UI
# Menu → "Export as notebook" → Downloads .ipynb

# Verify in Jupyter
jupyter notebook exported_workflow.ipynb
```

### Step 5: Test and Iterate

1. **Import into Curio** and execute nodes
2. **Check for execution errors** in node outputs
3. **Adjust dependencies** if needed
4. **Re-export** to update notebook

---

## Complete Working Examples

### Example 1: Simple Data Analysis

**File**: `docs/examples/notebooks/example10-original-notebook-W.ipynb`

**Structure**:
```
Load CSV → Clean Data → Summarize → Visualize
```

**Data**: Green Roofs dataset  
**Output**: Summary statistics and charts

**Screenshots**: [docs/examples/notebooks/screenshots/](../examples/notebooks/screenshots/)

### Example 2: Multi-Stage Processing

**File**: `docs/examples/notebooks/example3-original-notebook-NW.ipynb`

**Structure**:
```
Load Weather → Transform → Compute Metrics → Merge with Demographics → Visualize
```

**Data**: Milan weather + socio-demographic data  
**Output**: Interactive map and time series

### Example 3: What-If Analysis

**File**: `docs/examples/notebooks/example5-original-notebook-W.ipynb`

**Structure**:
```
Load Data → Branch → Scenario A Analysis ⟶ Comparison
           ⟶ Scenario B Analysis ⟶
```

**Data**: Energy efficiency scenarios  
**Output**: Comparison visualizations

---

## Visual References

See screenshots for visual examples of:

1. **Metadata Structure** - How `__trill_node__` appears in notebooks
2. **Conversion Process** - Step-by-step transformation
3. **Workflow Output** - How converted workflows look in Curio
4. **Node Templates** - Example template structure

**Location**: [docs/examples/notebooks/screenshots/](../examples/notebooks/screenshots/)

To view:
```bash
# Open in image viewer
open docs/examples/notebooks/screenshots/
```

---

## Conversion Details

### Node Type Inference

When `type` is not explicitly specified, Curio infers from code patterns:

```python
# Automatically detected as DATA_LOADING
import pandas as pd
df = pd.read_csv('file.csv')

# Automatically detected as VIS_UTK
markers = ["grammar =", "utk_spec =", "utk_grammar ="]
```

### Metadata Preservation

**Metadata that's preserved**:
- ✅ Node content (code)
- ✅ Node types
- ✅ Variable dependencies
- ✅ Connection information
- ✅ Node positions (auto-layouted)

**Metadata that's recreated**:
- 🔄 Execution state (resets on import)
- 🔄 Cell outputs (not stored in Curio)
- 🔄 Notebook styling (Curio has own styling)

### Dependency Detection

Uses AST (Abstract Syntax Tree) analysis:

```python
# Cell 1: Define variable
df = pd.read_csv('data.csv')

# Cell 2: Uses variable - automatically wired!
filtered = df[df['value'] > 10]
```

Result: Automatic edge from Cell 1 → Cell 2

---

## API Reference

### TrillNotebookConverter Class

```typescript
class TrillNotebookConverter {
  // Convert Jupyter → Curio
  notebookToTrill(notebook: Notebook): {
    trillSpec: TrillSpec;
    warnings?: string[];
  }

  // Convert Curio → Jupyter
  trillToNotebook(trillJson: TrillSpec): Notebook
}
```

### Usage Example

```typescript
import { TrillNotebookConverter } from './NotebookConvertor';

const converter = new TrillNotebookConverter();

// Import notebook to workflow
const result = converter.notebookToTrill(notebookJson);
if (result.warnings) {
  console.warn(result.warnings);
}
const workflow = result.trillSpec;

// Export workflow to notebook
const notebook = converter.trillToNotebook(workflow);
```

---

## Troubleshooting

### Issue: "No Trill metadata detected"

**Cause**: Notebook cells don't have `__trill_node__` metadata

**Solution**: 
1. Add metadata to each cell (see templates in [IPYNB_USAGE.md](../IPYNB_USAGE.md))
2. Ensure UUID format for node IDs
3. Use explicit `__trill_connections__` dictionary

**Example**:
```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "DATA_LOADING",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {"inputs": [], "outputs": []}
```


## Best Practices

### 1. Start Simple
- Begin with single-node workflows
- Verify import/export works
- Then add complexity

### 2. Use Templates
- Copy templates from [IPYNB_USAGE.md](../IPYNB_USAGE.md)
- Follow naming conventions strictly
- Include all metadata fields

### 3. Test Both Directions
```
notebook.ipynb → Curio import → export → notebook2.ipynb → compare
```

### 4. Version Control
```bash
# Track both formats
git add notebook.ipynb
git add workflow.json
git add IPYNB_USAGE.md
```

### 5. Document Dependencies
```python
def _curio_node():
    # Inputs from upstream nodes
    # input: data_weather (from DATA_LOADING)
    # input: const_threshold (from CONSTANTS)
    
    # Your code here
    
    # Output for downstream nodes
    return result
```

---

## References

### Templates & Guides
- **Templates**: [IPYNB_USAGE.md](../IPYNB_USAGE.md) - 13 ready-to-use node templates
- **Naming Conventions**: [IPYNB_USAGE.md#naming-conventions](../IPYNB_USAGE.md#naming-conventions)
- **Best Practices**: [IPYNB_USAGE.md#best-practices](../IPYNB_USAGE.md#best-practices)

### Examples
- **Notebook Examples**: [docs/examples/notebooks/](../examples/notebooks/)
  - `example10-original-notebook-W.ipynb`
  - `example3-original-notebook-NW.ipynb`
  - `example5-original-notebook-W.ipynb`

- **Screenshots**: [docs/examples/notebooks/screenshots/](../examples/notebooks/screenshots/)
  - Conversion workflow visualization
  - Metadata structure examples
  - Output examples

### External Resources
- **Vega-Lite**: https://vega.github.io/vega-lite/
- **UTK (Urban Toolkit)**: https://urbantk.org
- **Jupyter Notebook Format**: https://nbformat.readthedocs.io/
- **Python AST**: https://docs.python.org/3/library/ast.html

### Related Documentation
- [Curio Main Documentation](../documentation.md)
- [Curio Architecture](../ARCHITECTURE.md)
- [Contributing Guide](../CONTRIBUTIONS.md)

---

## Summary

| Operation | Input | Output | Time | Link |
|-----------|-------|--------|------|------|
| Import to Curio | .ipynb | Workflow JSON | ~1s | See Step 1 |
| Export from Curio | Workflow JSON | .ipynb | ~1s | See Step 1 |
| Auto-detect nodes | Notebook code | Node types | ~100ms | Auto inference |
| Extract dependencies | Cell code | Edges/wiring | ~100ms | AST analysis |
| Full round-trip | .ipynb | .ipynb | ~2s | See Step 4 |

---

## Contributors

- Jaideep Nutalapati
- Vamsi Dath Meka

---