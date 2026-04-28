function buildInputPrelude(inputs: string[]): { inputLines: string; argBlock: string } {
  const inputLines = inputs.map((value, index) => `input_${index} = ${value}`).join("\n");

  let argBlock = "";
  if (inputs.length === 1) {
    argBlock = "arg = input_0\n";
  } else if (inputs.length > 1) {
    argBlock = `arg = [${inputs.map((_, index) => `input_${index}`).join(", ")}]\n`;
  }

  return { inputLines, argBlock };
}

function indentNonEmptyLines(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `${prefix}${line}` : line))
    .join("\n");
}

export function buildComputationBody(inputs: string[], code: string): string {
  const { inputLines, argBlock } = buildInputPrelude(inputs);
  return `${inputLines}\n${argBlock}\n${code}\n`;
}

export function buildMergeFlowBody(inputs: string[]): string {
  const joinedInputs = inputs.join(",\n");
  const indentedInputs = indentNonEmptyLines(joinedInputs, 4);
  return `\ninputs = [\n${indentedInputs}\n]\n\nmerged_inputs = [i for i in inputs if i is not None]\n\nreturn merged_inputs\n`;
}

export function buildDataPoolBody(source: string): string {
  return `\nreturn ${source}\n`;
}

export function buildVegaVisualizationBody(inputVar: string, normalizedSpecCode: string): string {
  return `\ninput_data = ${inputVar}\n\nspec = ${normalizedSpecCode.trim()}\n\nvalues = input_data\nif hasattr(input_data, "to_dict"):\n    values = input_data.to_dict(orient="records")\n\nif isinstance(spec, dict):\n    spec["data"] = {"values": values}\n\nfrom IPython.display import display\ndisplay({"application/vnd.vegalite.v5+json": spec, "text/plain": spec}, raw=True)\n\nreturn input_data\n`;
}

export function buildTableVisualizationBody(inputVar: string): string {
  return `\ninput_data = ${inputVar}\nfrom IPython.display import display\ndisplay(input_data)\n\nreturn input_data\n`;
}

export function buildTextVisualizationBody(inputVar: string): string {
  return `\ninput_data = ${inputVar}\nfrom IPython.display import display\ndisplay(str(input_data))\n\nreturn input_data\n`;
}

export function buildImageVisualizationBody(inputVar: string): string {
  return `\ninput_data = ${inputVar}\nfrom IPython.display import display, Image\ntry:\n    display(Image(input_data))\nexcept Exception:\n    display(input_data)\n\nreturn input_data\n`;
}

export function buildConstantsBody(code: string): string {
  return `\n${code}\n`;
}

export function buildCommentBody(content: string): string {
  if (!content) return "\n";
  return content
    .split("\n")
    .map((line) => `# ${line}`)
    .join("\n") + "\n";
}

export function buildUtkVisualizationBody(inputs: string[], utkCode: string): string {
  const inputLines = inputs.map((value, index) => `input_${index} = ${value}`).join("\n");
  return `${inputLines}\n\n${utkCode}`;
}

export function getUtkDataVar(inputs: string[]): string {
  if (inputs.length === 1) {
    return "input_0";
  }

  if (inputs.length > 1) {
    return `[${inputs.map((_, index) => `input_${index}`).join(", ")}]`;
  }

  return "None";
}

export function buildUtkNotebookCode(nodeContent: string, containerId: string, dataVar: string, nodeId: string): string {
  const nodeIdShort = nodeId.substring(0, 8);

  return `
# Configure UTK for serverless/notebook environment
import utk
import json
from IPython.display import HTML, Javascript, display

utk.Environment.serverless = True

# Create grammar structure
grammar = {
    "components": [{
        "id": "notebook_map",
        "json": {
            "camera": {
                "wEye": [0, 0, 1000],
                "wLookAt": [0, 0, 0],
                "wUp": [0, 1, 0]
            },
            "grid": {"width": 12, "height": 4},
            "knots": [],
            "map_style": [],
            "widgets": [{
                "type": "TOGGLE_KNOT"
            }]
        },
        "position": {"x": 0, "y": 0, "width": 12, "height": 4}
    }],
    "grid": {"width": 12, "height": 4},
    "knots": []
}

# If content has grammar, parse and merge it
grammar_content = """${nodeContent || "{}"}""".strip()
if grammar_content and grammar_content != "{}":
    try:
        parsed_grammar = json.loads(grammar_content)
        # Merge parsed grammar with our structure
        if "components" in parsed_grammar:
            grammar["components"][0]["json"].update(parsed_grammar.get("json", {}))
        if "knots" in parsed_grammar:
            grammar["knots"] = parsed_grammar["knots"]
    except json.JSONDecodeError:
        pass

# Load geospatial data if available
geospatial_data = None
if ${dataVar} is not None:
    data_input = ${dataVar}
    # Handle multi-input case
    if isinstance(data_input, list):
        data_input = data_input[0] if data_input else None
    
    if data_input is not None:
        # Check if it's a geodataframe
        try:
            import geopandas as gpd
            if isinstance(data_input, gpd.GeoDataFrame):
                # Convert to GeoJSON
                geojson_data = json.loads(data_input.to_json())
                geospatial_data = utk.physical_from_geojson(geojson_data)
                
                # Add layers to grammar
                if geospatial_data and "components" in grammar:
                    if "layers" not in grammar["components"][0]["json"]:
                        grammar["components"][0]["json"]["layers"] = []
                    # Add layer for the geospatial data
                    grammar["components"][0]["json"]["layers"].append({
                        "type": "geospatial",
                        "data": geospatial_data.to_dict() if hasattr(geospatial_data, 'to_dict') else geospatial_data
                    })
        except Exception as e:
            pass

# Create HTML container
html_container = f'<div id="${containerId}" style="width: 100%; height: 600px; border: 1px solid #ccc;"></div>'
display(HTML(html_container))

# Initialize UTK in browser
js_initialization = f"""
require(['utk'], function(utk) {{
    utk.Environment.serverless = true;
    const container = document.getElementById('${containerId}');
    const grammar = {json.dumps(grammar)};
    
    try {{
        const interpreter = new utk.GrammarInterpreter('notebook', grammar, container);
        // Store reference for potential interactions
        window._utk_interpreter_${nodeIdShort} = interpreter;
    }} catch(e) {{
        console.error('UTK initialization error:', e);
        container.innerHTML = '<div style="color: red; padding: 20px;">Error initializing UTK visualization</div>';
    }}
}});
"""
display(Javascript(js_initialization))
`;
}
