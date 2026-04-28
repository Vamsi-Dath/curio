# Jupyter Notebook and Curio Interoperability Usage Guide

## Converting Notebooks to Curio Workflows

This guide explains how to structure Jupyter notebooks for seamless conversion to Curio workflows and vice versa. It covers all supported node types, naming conventions, and provides ready-to-use templates.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Node Types](#node-types)
3. [Metadata Structure](#metadata-structure)
4. [Naming Conventions](#naming-conventions)
5. [Node Templates](#node-templates)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

### The Minimum Viable Cell Template

Every cell that will be converted to a Curio node needs:

```python
__trill_node__ = {
    "id": "unique-cell-id",
    "type": "COMPUTATION_ANALYSIS",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [],
    "outputs": []
}

def _curio_node():
    # YOUR CODE HERE
    result = process_data()
    return result

_curio_output = _curio_node()
```

**Key Points:**
- `__trill_node__`: Metadata identifying the node
- `__trill_connections__`: Connection information
- `_curio_node()`: Function containing your actual code
- `_curio_output`: Captures the return value

---

## Node Types

Curio supports 16 node types, each with specific purposes:

| Node Type | Purpose | Input | Output |
|-----------|---------|-------|--------|
| **DATA_LOADING** | Load/generate data from files or APIs | None | DataFrame, GeoDataFrame, or Raster |
| **DATA_CLEANING** | Clean and preprocess data | DataFrame/GeoDataFrame | DataFrame/GeoDataFrame |
| **DATA_TRANSFORMATION** | Transform and reshape data | DataFrame/GeoDataFrame | DataFrame/GeoDataFrame |
| **COMPUTATION_ANALYSIS** | Perform calculations and analysis | Any | Any |
| **DATA_SUMMARY** | Aggregate and summarize data | DataFrame/GeoDataFrame | DataFrame/Series |
| **DATA_EXPORT** | Save/export data to files | DataFrame/GeoDataFrame | File path |
| **DATA_POOL** | Combine multiple data sources | Multiple | DataFrame/GeoDataFrame |
| **MERGE_FLOW** | Merge data from multiple branches | Multiple | DataFrame/GeoDataFrame |
| **FLOW_SWITCH** | Conditional branching based on logic | Any | Any |
| **CONSTANTS** | Define constant values | None | Value/JSON |
| **VIS_VEGA** | Create Vega-Lite visualizations | DataFrame/GeoDataFrame | Vega-Lite spec |
| **VIS_UTK** | Create UTK geospatial visualizations | GeoDataFrame | UTK spec |
| **VIS_TABLE** | Display data as interactive table | DataFrame/GeoDataFrame | Table HTML |
| **VIS_TEXT** | Display formatted text output | Any | Text |
| **VIS_IMAGE** | Display images | Image data/path | Image |
| **COMMENTS** | Add documentation cells | None | Comment text |

---

## Metadata Structure

### `__trill_node__` Dictionary

Required metadata that identifies each node:

```python
__trill_node__ = {
    "id": "82537c44-8195-4cd3-a5fa-8a049d53d96e",  # Unique identifier
    "type": "COMPUTATION_ANALYSIS",                  # Node type
    "in": "DEFAULT",                                 # Input port label
    "out": "DEFAULT"                                 # Output port label
}
```

**Fields:**
- `id` (String): Unique UUID for the node. **Use UUID format** (e.g., from `uuid.uuid4()`)
- `type` (String): One of the 16 node types listed above
- `in` (String): Input connection label (usually "DEFAULT")
- `out` (String): Output connection label (usually "DEFAULT")

### `__trill_connections__` Dictionary

Metadata defining connections to other nodes:

```python
__trill_connections__ = {
    "inputs": [
        {
            "source": "source-node-id",
            "target": "current-node-id",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        }
    ],
    "outputs": [
        {
            "source": "current-node-id",
            "target": "target-node-id",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        }
    ]
}
```

**Fields:**
- `inputs`: List of incoming connections
- `outputs`: List of outgoing connections
- `source`/`target`: Node IDs
- `sourceHandle`/`targetHandle`: Connection port labels
- `bidirectional`: Boolean for bidirectional connections

---

## Naming Conventions

Curio uses specific naming patterns to automatically detect and wire data dependencies:

### Variable Naming Patterns

| Pattern | Usage | Example | Meaning |
|---------|-------|---------|---------|
| `data_*` | Data loading output | `data_weather_df` | Output from DATA_LOADING node |
| `result_*` | Computation output | `result_aggregated` | Output from COMPUTATION_ANALYSIS |
| `cleaned_*` | Cleaned data | `cleaned_weather` | Output from DATA_CLEANING node |
| `summary_*` | Summarized data | `summary_stats` | Output from DATA_SUMMARY node |
| `pool_*` | Pooled data | `pool_combined` | Output from DATA_POOL node |
| `vis_*` | Visualization spec | `vis_chart` | Output from VIS_VEGA/VIS_UTK |
| `const_*` | Constants | `const_threshold` | Output from CONSTANTS node |

### Node ID Naming

Use UUID format for consistency:

```python
import uuid

node_id = str(uuid.uuid4())  # e.g., "82537c44-8195-4cd3-a5fa-8a049d53d96e"
```

### Variable Reference Comments

Document dependencies with comments:

```python
def _curio_node():
    # input: data_weather_df (from DATA_LOADING)
    # input: result_aggregated (from COMPUTATION_ANALYSIS)
    
    filtered = data_weather_df[data_weather_df['temp'] > result_aggregated['avg_temp']]
    return filtered
```

---

## Node Templates

### Template 1: DATA_LOADING

For loading data from files or APIs.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "DATA_LOADING",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [],
    "outputs": []
}

def _curio_node():
    """Load data from file or API"""
    import pandas as pd
    
    # Load your data here
    data_df = pd.read_csv('path/to/your/file.csv')
    
    # Optional: Basic validation
    print(f"Loaded {len(data_df)} rows, {len(data_df.columns)} columns")
    
    return data_df

_curio_output = _curio_node()
```

### Template 2: DATA_CLEANING

For cleaning and preprocessing data.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "type": "DATA_CLEANING",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [
        {
            "source": "550e8400-e29b-41d4-a716-446655440000",
            "target": "550e8400-e29b-41d4-a716-446655440001",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        }
    ],
    "outputs": []
}

def _curio_node():
    """Clean and preprocess data"""
    # input: data_df (from DATA_LOADING)
    
    cleaned_df = data_df.copy()
    
    # Remove duplicates
    cleaned_df = cleaned_df.drop_duplicates()
    
    # Handle missing values
    cleaned_df = cleaned_df.fillna(method='ffill')
    
    # Remove rows with critical missing values
    cleaned_df = cleaned_df.dropna(subset=['critical_column'])
    
    print(f"After cleaning: {len(cleaned_df)} rows")
    
    return cleaned_df

_curio_output = _curio_node()
```

### Template 3: DATA_TRANSFORMATION

For reshaping and transforming data.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "type": "DATA_TRANSFORMATION",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [
        {
            "source": "550e8400-e29b-41d4-a716-446655440001",
            "target": "550e8400-e29b-41d4-a716-446655440002",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        }
    ],
    "outputs": []
}

def _curio_node():
    """Transform data structure"""
    # input: cleaned_df (from DATA_CLEANING)
    
    # Example transformations
    transformed_df = cleaned_df.copy()
    
    # Reshape: pivot table
    transformed_df = transformed_df.pivot_table(
        index='category',
        columns='date',
        values='value',
        aggfunc='mean'
    )
    
    # Or melt long format
    # transformed_df = pd.melt(transformed_df, id_vars=['id'], value_name='value')
    
    return transformed_df

_curio_output = _curio_node()
```

### Template 4: COMPUTATION_ANALYSIS

For calculations and analysis.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440003",
    "type": "COMPUTATION_ANALYSIS",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [
        {
            "source": "550e8400-e29b-41d4-a716-446655440002",
            "target": "550e8400-e29b-41d4-a716-446655440003",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        }
    ],
    "outputs": []
}

def _curio_node():
    """Perform analysis and computations"""
    # input: transformed_df (from DATA_TRANSFORMATION)
    import numpy as np
    
    # Compute derived metrics
    result_analysis = {
        'mean': transformed_df.mean(),
        'std': transformed_df.std(),
        'correlation': transformed_df.corr(),
        'percentile_95': transformed_df.quantile(0.95)
    }
    
    # Or return DataFrame
    result_df = transformed_df.copy()
    result_df['z_score'] = (result_df - result_df.mean()) / result_df.std()
    
    return result_df

_curio_output = _curio_node()
```

### Template 5: DATA_SUMMARY

For aggregation and summarization.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440004",
    "type": "DATA_SUMMARY",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [
        {
            "source": "550e8400-e29b-41d4-a716-446655440003",
            "target": "550e8400-e29b-41d4-a716-446655440004",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        }
    ],
    "outputs": []
}

def _curio_node():
    """Summarize and aggregate data"""
    # input: result_df (from COMPUTATION_ANALYSIS)
    
    # Group and aggregate
    summary_data = result_df.groupby('category').agg({
        'value': ['mean', 'sum', 'count'],
        'z_score': ['min', 'max']
    }).round(2)
    
    # Flatten column names
    summary_data.columns = ['_'.join(col).strip() for col in summary_data.columns.values]
    
    return summary_data

_curio_output = _curio_node()
```

### Template 6: DATA_POOL

For combining multiple data sources.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440005",
    "type": "DATA_POOL",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [
        {
            "source": "550e8400-e29b-41d4-a716-446655440001",
            "target": "550e8400-e29b-41d4-a716-446655440005",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        },
        {
            "source": "550e8400-e29b-41d4-a716-446655440002",
            "target": "550e8400-e29b-41d4-a716-446655440005",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        }
    ],
    "outputs": []
}

def _curio_node():
    """Combine multiple data sources"""
    # input: cleaned_df (from DATA_CLEANING)
    # input: transformed_df (from DATA_TRANSFORMATION)
    import pandas as pd
    
    # Concatenate
    pool_data = pd.concat([cleaned_df, transformed_df], axis=0, ignore_index=True)
    
    # Or merge/join
    # pool_data = pd.merge(cleaned_df, transformed_df, on='key_column', how='inner')
    
    return pool_data

_curio_output = _curio_node()
```

### Template 7: VIS_VEGA

For Vega-Lite visualizations.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440006",
    "type": "VIS_VEGA",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [
        {
            "source": "550e8400-e29b-41d4-a716-446655440004",
            "target": "550e8400-e29b-41d4-a716-446655440006",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        }
    ],
    "outputs": []
}

def _curio_node():
    """Create Vega-Lite visualization"""
    # input: summary_data (from DATA_SUMMARY)
    
    vis_spec = {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "description": "A visualization of aggregated data",
        "data": {"values": summary_data.to_dict(orient='records')},
        "mark": "bar",
        "encoding": {
            "x": {"field": "category", "type": "nominal", "title": "Category"},
            "y": {"field": "value_mean", "type": "quantitative", "title": "Mean Value"},
            "color": {"field": "category", "type": "nominal"}
        }
    }
    
    return vis_spec

_curio_output = _curio_node()
```

### Template 8: VIS_TABLE

For table visualizations.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440007",
    "type": "VIS_TABLE",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [
        {
            "source": "550e8400-e29b-41d4-a716-446655440004",
            "target": "550e8400-e29b-41d4-a716-446655440007",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        }
    ],
    "outputs": []
}

def _curio_node():
    """Display data as interactive table"""
    # input: summary_data (from DATA_SUMMARY)
    
    # Table visualization automatically handles DataFrame display
    # Curio will render it as an interactive table in the notebook
    
    return summary_data

_curio_output = _curio_node()
```

### Template 9: CONSTANTS

For defining constant values.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440008",
    "type": "CONSTANTS",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [],
    "outputs": []
}

def _curio_node():
    """Define constants"""
    
    const_values = {
        "threshold": 25.5,
        "categories": ["A", "B", "C"],
        "config": {
            "date_format": "%Y-%m-%d",
            "timezone": "UTC"
        }
    }
    
    return const_values

_curio_output = _curio_node()
```

### Template 10: FLOW_SWITCH

For conditional branching.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440009",
    "type": "FLOW_SWITCH",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [
        {
            "source": "550e8400-e29b-41d4-a716-446655440003",
            "target": "550e8400-e29b-41d4-a716-446655440009",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        }
    ],
    "outputs": []
}

def _curio_node():
    """Route data based on conditions"""
    # input: result_df (from COMPUTATION_ANALYSIS)
    
    if result_df['value'].mean() > 50:
        output = result_df[result_df['value'] > 50]
        condition_met = "high_values"
    else:
        output = result_df[result_df['value'] <= 50]
        condition_met = "low_values"
    
    return {
        "data": output,
        "condition": condition_met
    }

_curio_output = _curio_node()
```

### Template 11: DATA_EXPORT

For exporting/saving data.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440010",
    "type": "DATA_EXPORT",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [
        {
            "source": "550e8400-e29b-41d4-a716-446655440004",
            "target": "550e8400-e29b-41d4-a716-446655440010",
            "sourceHandle": "out",
            "targetHandle": "in",
            "bidirectional": False
        }
    ],
    "outputs": []
}

def _curio_node():
    """Export data to file"""
    # input: summary_data (from DATA_SUMMARY)
    import os
    
    # Create output directory
    output_dir = "output"
    os.makedirs(output_dir, exist_ok=True)
    
    # Export to CSV
    export_path = os.path.join(output_dir, "summary_results.csv")
    summary_data.to_csv(export_path)
    
    print(f"Data exported to: {export_path}")
    
    return export_path

_curio_output = _curio_node()
```

### Template 12: MERGE_FLOW

For merging multiple data branches.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440011",
    "type": "MERGE_FLOW",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [
        {
            "source": "550e8400-e29b-41d4-a716-446655440003",
            "target": "550e8400-e29b-41d4-a716-446655440011",
            "sourceHandle": "out",
            "targetHandle": "in_0",
            "bidirectional": False
        },
        {
            "source": "550e8400-e29b-41d4-a716-446655440004",
            "target": "550e8400-e29b-41d4-a716-446655440011",
            "sourceHandle": "out",
            "targetHandle": "in_1",
            "bidirectional": False
        }
    ],
    "outputs": []
}

def _curio_node():
    """Merge multiple data streams"""
    # input: result_df (from COMPUTATION_ANALYSIS)
    # input: summary_data (from DATA_SUMMARY)
    import pandas as pd
    
    # Merge by common index or column
    merged = pd.merge(
        result_df.reset_index(),
        summary_data.reset_index(),
        on='category',
        how='outer'
    )
    
    return merged

_curio_output = _curio_node()
```

### Template 13: COMMENTS

For adding documentation.

```python
__trill_node__ = {
    "id": "550e8400-e29b-41d4-a716-446655440012",
    "type": "COMMENTS",
    "in": "DEFAULT",
    "out": "DEFAULT"
}

__trill_connections__ = {
    "inputs": [],
    "outputs": []
}

def _curio_node():
    """Add documentation"""
    
    comment_text = """
    # Analysis Pipeline Documentation
    
    ## Overview
    This pipeline performs weather data analysis across multiple stages:
    
    1. **Data Loading**: Import raw weather data from CSV
    2. **Data Cleaning**: Remove duplicates and handle missing values
    3. **Transformation**: Pivot and reshape data for analysis
    4. **Computation**: Calculate statistical metrics
    5. **Summary**: Aggregate by category
    6. **Visualization**: Create interactive charts
    
    ## Key Metrics
    - Mean temperature: {mean_temp}°C
    - Std deviation: {std_temp}°C
    - Date range: {start_date} to {end_date}
    """
    
    return comment_text

_curio_output = _curio_node()
```

---

## Best Practices

### 1. Always Use UUID for Node IDs

```python
import uuid

node_id = str(uuid.uuid4())  # Correct
# node_id = "custom_name"    # Avoid - not a UUID
```

### 2. Structure Return Values Consistently

```python
# Good: Always return a single clear output
def _curio_node():
    result = process(data)
    return result  # Single return

# Avoid: Multiple returns or complex unpacking
def _curio_node():
    result1, result2 = process(data)  # Can be ambiguous
    return result1
```

### 3. Use Explicit Variable Names

```python
# Good
data_weather = pd.read_csv('weather.csv')
cleaned_weather = data_weather.dropna()
result_stats = cleaned_weather.describe()

# Avoid
df = pd.read_csv('weather.csv')
df = df.dropna()
r = df.describe()
```

### 4. Document Dependencies with Comments

```python
def _curio_node():
    # input: data_df (from DATA_LOADING node)
    # input: const_threshold (from CONSTANTS node)
    
    filtered = data_df[data_df['value'] > const_threshold]
    return filtered
```

### 5. Keep Cells Focused

```python
# Good: Single responsibility
def _curio_node():
    # Just clean the data
    df_clean = df.drop_duplicates()
    df_clean = df_clean.fillna(method='ffill')
    return df_clean

# Avoid: Multiple concerns
def _curio_node():
    # Multiple transformations mixed together
    df_clean = df.drop_duplicates()
    df_clean = df_clean.fillna(method='ffill')
    summary = df_clean.describe()
    visualization = create_chart(summary)
    save_file(visualization)
    return df_clean
```

### 6. Test in Jupyter Before Converting

1. Write and test your code in a regular Jupyter notebook
2. Once working, add the metadata and wrapping
3. Export and import to verify conversion works

---

## Troubleshooting

### Issue: "Node not recognized in import"

**Problem**: Metadata is missing or malformed

**Solution**: Ensure both `__trill_node__` and `__trill_connections__` are present:

```python
# Must have both dictionaries
__trill_node__ = { ... }
__trill_connections__ = { ... }
```

### Issue: "Dependencies not automatically detected"

**Problem**: Variable dependencies not wired

**Solution**: 
- Use clear naming conventions: `data_*`, `result_*`
- Add input comments: `# input: variable_name`
- Explicitly define connections in `__trill_connections__`

### Issue: "Visualization not rendered"

**Problem**: VIS_VEGA spec not converted correctly

**Solution**:
- Ensure the function returns a valid Vega-Lite spec dictionary
- Must include `$schema` key
- Check Vega-Lite v5 documentation for valid encoding

### Issue: "Error wrapping code in `_curio_node()`"

**Problem**: Code structure incompatible with function wrapping

**Solution**:
- Avoid module-level statements (imports should be inside the function)
- Don't reference global state
- Ensure all dependencies are passed as parameters or defined locally

---

## Complete Example Notebook Structure

See [docs/examples/notebooks](../examples/notebooks/) for complete working examples:

- `example10-original-notebook-W.ipynb` - DATA_LOADING example
- `example3-original-notebook-NW.ipynb` - Multi-node workflow
- `example5-original-notebook-W.ipynb` - Complete pipeline

Screenshots available in [docs/examples/notebooks/screenshots](../examples/notebooks/screenshots/)

---

## Additional Resources

- [NotebookConvertor API](../../utk_curio/frontend/urban-workflows/src/notebook-convertor/README.md)
- [Vega-Lite Specification](https://vega.github.io/vega-lite/)
- [UTK Documentation](https://urbantk.org)
- [Curio Main Documentation](../documentation.md)

---

**Last Updated**: April 28, 2026  
**Version**: 1.0  
**Status**: Complete
