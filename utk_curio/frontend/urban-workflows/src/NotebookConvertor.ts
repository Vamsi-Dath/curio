import { v4 as uuid } from "uuid";
import { isUtkSpec, isVegaLiteSpec, tryParseJsonObject } from "./adapters/grammarDetection";
import { NodeType } from "./constants";

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

export interface NotebookCell {
  cell_type: "code" | "markdown" | string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface Notebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

interface TrillNode {
  id: string;
  type: string;
  x: number;
  y: number;
  content?: string;
  in?: string;
  out?: string;
}

interface TrillEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
}

interface TrillDataflow {
  nodes: TrillNode[];
  edges: TrillEdge[];
  name: string;
  task: string;
  timestamp: number;
  provenance_id: string;
}

export interface TrillSpec {
  dataflow: TrillDataflow;
}

interface InputConnection {
  source: string;
  sourceHandle: string;
  bidirectional: boolean;
}

interface OutputConnection {
  target: string;
  targetHandle: string;
  bidirectional: boolean;
}

interface GraphNodeInfo {
  node: TrillNode;
  dependencies: Set<string>;
  dependents: Set<string>;
  inputs: Record<string, InputConnection[]>;
  outputs: Record<string, OutputConnection[]>;
}

interface TrillMeta {
  id?: string;
  type?: string;
  in?: string;
  out?: string;
}

interface NotebookTrillConnection {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  bidirectional?: boolean;
  type?: string;
}

interface NotebookTrillMetadata {
  id?: string;
  type?: string;
  in?: string;
  out?: string;
  inputs?: NotebookTrillConnection[];
  outputs?: NotebookTrillConnection[];
}

export class TrillNotebookConverter {
  private executionGraph: Record<string, GraphNodeInfo> = {};

  public trillToNotebook(trillJson: TrillSpec): Notebook {
    const nodes = trillJson.dataflow?.nodes ?? [];
    const edges = trillJson.dataflow?.edges ?? [];

    this.buildExecutionGraph(nodes, edges);

    const executionOrder = this.topologicalSort();
    const cells: NotebookCell[] = [];

    for (const nodeId of executionOrder) {
      const node = this.executionGraph[nodeId]?.node;
      if (!node) {
        continue;
      }

      const cell = this.generateCellForNode(node);
      if (cell) {
        cells.push(cell);
      }
    }

    return {
      cells,
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3",
        },
        language_info: {
          name: "python",
        },
      },
      nbformat: 4,
      nbformat_minor: 4,
    };
  }

  public notebookToTrill(notebook: Partial<Notebook> | Record<string, unknown>): TrillSpec {
    const rawCells = Array.isArray((notebook as { cells?: unknown[] }).cells)
      ? ((notebook as { cells: unknown[] }).cells ?? [])
      : [];

    const nodes: TrillNode[] = [];
    const edges: TrillEdge[] = [];
    const nodeInputs: Record<string, string[]> = {};
    const producedByVar: Record<string, string> = {};
    const explicitEdges = new Map<string, TrillEdge>();
    let sawExplicitConnections = false;

    let previousNodeId: string | null = null;
    const position = { x: 100, y: 100 };
    const importedWorkflowId = uuid();

    rawCells.forEach((rawCell) => {
      const cell = rawCell as Record<string, unknown>;
      if (cell.cell_type !== "code") {
        return;
      }

      // Ignore runtime notebook artifacts (outputs/errors/execution state) on import.
      void cell.outputs;
      void cell.execution_count;

      const source = cell.source;
      const code = Array.isArray(source) ? source.join("") : String(source ?? "");

      const notebookMeta = this.extractNotebookTrillMetadata(cell);
      const trillMeta = this.extractTrillVariable(code);

      const nodeId =
        notebookMeta?.id ?? trillMeta?.id ?? `notebook_cell_${uuid()}`;
      const inferredNodeType = this.inferNodeType(code);
      const nodeType =
        notebookMeta?.type ?? trillMeta?.type ?? inferredNodeType;
      const nodeIn =
        notebookMeta?.in ?? trillMeta?.in ?? "DEFAULT";
      const nodeOut =
        notebookMeta?.out ?? trillMeta?.out ?? "DEFAULT";

      const codeWithoutMeta = this.removeTrillVariable(code);
      const inputVars = this.extractInputVariables(codeWithoutMeta);
      const producedVars = this.extractProducedVariables(codeWithoutMeta);

      const cleanCodeBody = this.unwrapCurioNodeExecution(codeWithoutMeta);
      const cleanCode =
        nodeType === NodeType.VIS_VEGA
          ? this.normalizeVegaSpecForCurio(this.extractVegaLiteSpecCode(cleanCodeBody))
          : cleanCodeBody;

      const node: TrillNode = {
        id: nodeId,
        type: nodeType,
        x: position.x,
        y: position.y,
        content: cleanCode.trim(),
        in: nodeIn,
        out: nodeOut,
      };

      nodes.push(node);
      nodeInputs[nodeId] = inputVars;
      for (const producedVar of producedVars) {
        producedByVar[producedVar] = nodeId;
      }

      previousNodeId = nodeId;
      position.y += 150;
    });

    for (const rawCell of rawCells) {
      const cell = rawCell as Record<string, unknown>;
      if (cell.cell_type !== "code") {
        continue;
      }

      const notebookMeta = this.extractNotebookTrillMetadata(cell);
      if (!notebookMeta) {
        continue;
      }

      const nodeId = notebookMeta.id;
      if (!nodeId) {
        continue;
      }

      const serializedConnections = [
        ...(notebookMeta.outputs ?? []),
        ...(notebookMeta.inputs ?? []),
      ];

      if (serializedConnections.length > 0) {
        sawExplicitConnections = true;
      }

      for (const connection of serializedConnections) {
        const edge = this.normalizeNotebookConnection(connection);
        if (!edge) {
          continue;
        }

        const key = this.edgeKey(edge);
        if (!explicitEdges.has(key)) {
          explicitEdges.set(key, edge);
        }
      }
    }

    if (sawExplicitConnections) {
      edges.push(...explicitEdges.values());
    }

    const targetInputCount: Record<string, number> = {};
    if (!sawExplicitConnections) {
      const edgeKeys = new Set<string>();

      for (const node of nodes) {
        const inputs = nodeInputs[node.id] ?? [];
        for (const inputVar of inputs) {
          const sourceNodeId = producedByVar[inputVar];
          if (!sourceNodeId || sourceNodeId === node.id) {
            continue;
          }

          const edgeKey = `${sourceNodeId}->${node.id}::${inputVar}`;
          if (edgeKeys.has(edgeKey)) {
            continue;
          }
          edgeKeys.add(edgeKey);

          let targetHandle = "in";
          if (node.type === NodeType.MERGE_FLOW) {
            const count = targetInputCount[node.id] ?? 0;
            targetHandle = `in_${count}`;
            targetInputCount[node.id] = count + 1;
          }

          edges.push({
            id: `edge_${uuid()}`,
            source: sourceNodeId,
            sourceHandle: "out",
            target: node.id,
            targetHandle,
          });
        }
      }
    }

    if (edges.length === 0) {
      let linearPreviousId: string | null = null;
      for (const node of nodes) {
        if (linearPreviousId) {
          edges.push({
            id: `edge_${uuid()}`,
            source: linearPreviousId,
            sourceHandle: "out",
            target: node.id,
            targetHandle: "in",
          });
        }
        linearPreviousId = node.id;
      }
    }

    return {
      dataflow: {
        nodes,
        edges,
        name: "Imported Notebook",
        task: "",
        timestamp: Date.now(),
        provenance_id: importedWorkflowId,
      },
    };
  }

  private buildExecutionGraph(nodes: TrillNode[], edges: TrillEdge[]): void {
    this.executionGraph = {};

    for (const node of nodes) {
      this.executionGraph[node.id] = {
        node,
        dependencies: new Set<string>(),
        dependents: new Set<string>(),
        inputs: {},
        outputs: {},
      };
    }

    for (const edge of edges) {
      const source = edge.source;
      const target = edge.target;

      if (!this.executionGraph[source] || !this.executionGraph[target]) {
        continue;
      }

      const sourceInfo = this.executionGraph[source];
      const targetInfo = this.executionGraph[target];
      const bidirectional = this.isBidirectionalEdge(edge);

      if (!bidirectional) {
        targetInfo.dependencies.add(source);
        sourceInfo.dependents.add(target);
      }

      const targetHandle = edge.targetHandle ?? (bidirectional ? "in/out" : "in");
      const sourceHandle = edge.sourceHandle ?? (bidirectional ? "in/out" : "out");

      if (!targetInfo.inputs[targetHandle]) {
        targetInfo.inputs[targetHandle] = [];
      }

      targetInfo.inputs[targetHandle].push({
        source,
        sourceHandle,
        bidirectional,
      });

      if (!sourceInfo.outputs[sourceHandle]) {
        sourceInfo.outputs[sourceHandle] = [];
      }

      sourceInfo.outputs[sourceHandle].push({
        target,
        targetHandle,
        bidirectional,
      });
    }
  }

  private topologicalSort(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[] = [];

    const visit = (nodeId: string): void => {
      if (visiting.has(nodeId)) {
        throw new Error("Circular dependency detected");
      }

      if (visited.has(nodeId)) {
        return;
      }

      visiting.add(nodeId);

      for (const dep of this.executionGraph[nodeId].dependencies) {
        visit(dep);
      }

      visiting.delete(nodeId);
      visited.add(nodeId);
      result.push(nodeId);
    };

    for (const nodeId of Object.keys(this.executionGraph)) {
      visit(nodeId);
    }

    return result;
  }

  private generateCellForNode(node: TrillNode): NotebookCell | null {
    const nodeType = node.type;
    const nodeId = node.id;
    const nodeInfo = this.executionGraph[nodeId];

    if (!nodeInfo) {
      return null;
    }

    let code = "";

    if (nodeType === NodeType.DATA_LOADING) {
      code = this.generateDataLoadingCode(node);
    } else if (nodeType === NodeType.MERGE_FLOW) {
      code = this.generateMergeFlowCode(node, nodeInfo);
    } else if (nodeType === NodeType.DATA_POOL) {
      code = this.generateDataPoolCode(node, nodeInfo);
    } else if (nodeType === NodeType.DATA_SUMMARY) {
      code = this.generateDataSummaryCode(node, nodeInfo);
    } else if (nodeType === NodeType.VIS_VEGA) {
      code = this.generateVegaVisualizationCode(node, nodeInfo);
    } else if (nodeType === NodeType.VIS_UTK) {
      code = this.generateUtkVisualizationCode(node, nodeInfo);
    } else {
      code = this.generateComputationCode(node, nodeInfo);
    }

    const nodeMeta = `__trill_node__ = {\n    "id": "${nodeId}",\n    "type": "${nodeType}",\n    "in": "${node.in ?? "DEFAULT"}",\n    "out": "${node.out ?? "DEFAULT"}"\n}\n\n`;
    const notebookMeta = this.buildNotebookTrillMetadata(nodeId, nodeType, node);

    return {
      cell_type: "code",
      source: nodeMeta + code,
      metadata: {
        id: nodeId,
        language: "python",
        nodeId,
        nodeType,
        in: node.in ?? "DEFAULT",
        out: node.out ?? "DEFAULT",
        trill: notebookMeta,
      },
    };
  }

  private wrapNodeExecution(body: string, outputVars: string[], displayVar?: string): string {
    const uniqueOutputVars = Array.from(new Set(outputVars));
    const primaryOutput = uniqueOutputVars[0] ?? "result";

    const successAssignments = [
      `${primaryOutput} = _curio_output`,
      ...uniqueOutputVars.slice(1).map((outputVar) => `${outputVar} = ${primaryOutput}`),
    ].join("\n    ");

    const fallbackAssignments = uniqueOutputVars
      .map((outputVar) => `${outputVar} = None`)
      .join("\n    ");

    const displayBlock = displayVar
      ? `\nfrom IPython.display import display\ndisplay(${displayVar})\n`
      : "";

    return `def _curio_node():\n\n${this.indent(body, 4)}\n\n_curio_output = _curio_node()\n\ntry:\n    ${successAssignments}\nexcept NameError:\n    ${fallbackAssignments}\n${displayBlock}`;
  }

  private generateDataLoadingCode(node: TrillNode): string {
    const code = node.content ?? "";
    const outputs = this.getOutputVariables(node.id);
    return this.wrapNodeExecution(code, outputs);
  }

  private generateComputationCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const code = node.content ?? "";
    const inputs = this.getInputVariables(nodeInfo);
    const outputs = this.getOutputVariables(node.id);

    const inputLines = inputs.map((value, index) => `input_${index} = ${value}`).join("\n");

    let argBlock = "";
    if (inputs.length === 1) {
      argBlock = "arg = input_0\n";
    } else if (inputs.length > 1) {
      argBlock = `arg = [${inputs.map((_, index) => `input_${index}`).join(", ")}]\n`;
    }

    const body = `${inputLines}\n${argBlock}\n${code}\n`;
    return this.wrapNodeExecution(body, outputs);
  }

  private generateMergeFlowCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = this.getInputVariables(nodeInfo);
    const outputs = this.getOutputVariables(node.id);

    const joinedInputs = inputs.join(",\n");
    const indentedInputs = this.indent(joinedInputs, 4);

    const body = `\ninputs = [\n${indentedInputs}\n]\n\nmerged_inputs = [i for i in inputs if i is not None]\n\nreturn merged_inputs\n`;
    return this.wrapNodeExecution(body, outputs);
  }

  private generateDataPoolCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = this.getInputVariables(nodeInfo);
    const outputs = this.getOutputVariables(node.id);
    const source = inputs.length > 0 ? inputs[0] : "None";

    const body = `\nreturn ${source}\n`;
    return this.wrapNodeExecution(body, outputs);
  }

  private generateDataSummaryCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const code = node.content ?? "";
    const inputs = this.getInputVariables(nodeInfo);
    const outputs = this.getOutputVariables(node.id);

    const inputLines = inputs.map((value, index) => `input_${index} = ${value}`).join("\n");

    let argBlock = "";
    if (inputs.length === 1) {
      argBlock = "arg = input_0\n";
    } else if (inputs.length > 1) {
      argBlock = `arg = [${inputs.map((_, index) => `input_${index}`).join(", ")}]\n`;
    }

    const body = `${inputLines}\n${argBlock}\n${code}\n`;
    const primaryOutput = outputs[0] ?? "_curio_output";
    return this.wrapNodeExecution(body, outputs, primaryOutput);
  }

  private generateVegaVisualizationCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const code = this.normalizeVegaSpecForNotebook(node.content ?? "");
    const inputs = this.getInputVariables(nodeInfo);

    const inputVar = inputs.length > 0 ? inputs[0] : "None";
    const outputs = this.getOutputVariables(node.id);

    const body = `\ninput_data = ${inputVar}\n\nspec = ${code.trim()}\n\nvalues = input_data\nif hasattr(input_data, "to_dict"):\n    values = input_data.to_dict(orient="records")\n\nif isinstance(spec, dict):\n    spec["data"] = {"values": values}\n\nfrom IPython.display import display\ndisplay({"application/vnd.vegalite.v5+json": spec, "text/plain": spec}, raw=True)\n\nreturn input_data\n`;
    return this.wrapNodeExecution(body, outputs);
  }

  private generateUtkVisualizationCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = this.getInputVariables(nodeInfo);
    const outputs = this.getOutputVariables(node.id);
    const containerId = `utk-container-${node.id.substring(0, 8)}`;

    // Build input data handling
    const inputLines = inputs.map((value, index) => `input_${index} = ${value}`).join("\n");
    let dataVar = "None";
    if (inputs.length === 1) {
      dataVar = "input_0";
    } else if (inputs.length > 1) {
      dataVar = `[${inputs.map((_, index) => `input_${index}`).join(", ")}]`;
    }

    // Generate the enhanced UTK notebook code
    const utkCode = this.generateUtkNotebookCode(node, containerId, dataVar);
    const body = `${inputLines}\n\n${utkCode}`;
    return this.wrapNodeExecution(body, outputs, containerId);
  }

  private generateUtkNotebookCode(node: TrillNode, containerId: string, dataVar: string): string {
    // Set up UTK with serverless mode and notebook environment
    const utkSetup = `
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
grammar_content = """${node.content ?? "{}"}""".strip()
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
        window._utk_interpreter_${node.id.substring(0, 8)} = interpreter;
    }} catch(e) {{
        console.error('UTK initialization error:', e);
        container.innerHTML = '<div style="color: red; padding: 20px;">Error initializing UTK visualization</div>';
    }}
}});
"""
display(Javascript(js_initialization))
`;

    return utkSetup;
  }

  private inferNodeType(code: string): NodeType {
    const codeWithoutMeta = this.removeTrillVariable(code);

    const parsedFullSpec = tryParseJsonObject(codeWithoutMeta.trim());
    if (parsedFullSpec) {
      if (isUtkSpec(parsedFullSpec)) {
        return NodeType.VIS_UTK;
      }

      if (isVegaLiteSpec(parsedFullSpec)) {
        return NodeType.VIS_VEGA;
      }
    }

    const parsedVegaSpec = tryParseJsonObject(this.extractVegaLiteSpecCode(codeWithoutMeta));
    if (parsedVegaSpec && isVegaLiteSpec(parsedVegaSpec)) {
      return NodeType.VIS_VEGA;
    }

    const utkPattern = /(^|\n)\s*(?:from\s+utk\s+import\s+|import\s+utk\b)|\butk\s*\./;

    if (utkPattern.test(codeWithoutMeta)) {
      return NodeType.VIS_UTK;
    }

    const vegaPattern = /application\/vnd\.vegalite\.v5\+json|\$schema\s*:\s*["']https:\/\/vega\.github\.io\/schema\/vega-lite\//;
    if (vegaPattern.test(codeWithoutMeta)) {
      return NodeType.VIS_VEGA;
    }

    return NodeType.COMPUTATION_ANALYSIS;
  }

  private ensureUtkImport(code: string): string {
    const utkPattern = /(^|\n)\s*(?:from\s+utk\s+import\s+|import\s+utk\b)|\butk\s*\./;
    if (utkPattern.test(code)) {
      return code;
    }

    const trimmedCode = code.trim();
    if (!trimmedCode) {
      return "import utk";
    }

    return `import utk\n\n${trimmedCode}`;
  }

  private normalizeVegaSpecForNotebook(specCode: string): string {
    return this.replaceKeywordsOutsideStrings(specCode, {
      true: "True",
      false: "False",
      null: "None",
    });
  }

  private normalizeVegaSpecForCurio(specCode: string): string {
    return this.replaceKeywordsOutsideStrings(specCode, {
      True: "true",
      False: "false",
      None: "null",
    });
  }

  private replaceKeywordsOutsideStrings(text: string, replacements: Record<string, string>): string {
    const keys = Object.keys(replacements).sort((a, b) => b.length - a.length);
    let result = "";
    let index = 0;
    let inString = false;
    let quoteChar = "";

    const isIdentifierChar = (char: string | undefined): boolean => {
      if (!char) {
        return false;
      }

      const code = char.charCodeAt(0);
      return (
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        char === "_"
      );
    };

    while (index < text.length) {
      const char = text[index];

      if (inString) {
        result += char;

        if (char === "\\") {
          index += 1;
          if (index < text.length) {
            result += text[index];
          }
        } else if (char === quoteChar) {
          inString = false;
          quoteChar = "";
        }

        index += 1;
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        quoteChar = char;
        result += char;
        index += 1;
        continue;
      }

      let replaced = false;

      for (const key of keys) {
        if (!text.startsWith(key, index)) {
          continue;
        }

        const prev = index > 0 ? text[index - 1] : undefined;
        const next = index + key.length < text.length ? text[index + key.length] : undefined;

        if (isIdentifierChar(prev) || isIdentifierChar(next)) {
          continue;
        }

        result += replacements[key];
        index += key.length;
        replaced = true;
        break;
      }

      if (!replaced) {
        result += char;
        index += 1;
      }
    }

    return result;
  }

  private indent(text: string, spaces: number): string {
    const prefix = " ".repeat(spaces);
    return text
      .split("\n")
      .map((line) => (line.trim().length > 0 ? `${prefix}${line}` : line))
      .join("\n");
  }

  private getOutputVariable(nodeId: string, sourceHandle: string = "out"): string {
    const nodeType = this.executionGraph[nodeId].node.type;
    const safeId = this.sanitizeId(nodeId);

    let baseOutput = "";

    if (nodeType === NodeType.DATA_LOADING) {
      baseOutput = `data_${safeId}`;
    } else if (nodeType === NodeType.MERGE_FLOW) {
      baseOutput = `merged_${safeId}`;
    } else if (nodeType === NodeType.DATA_POOL) {
      baseOutput = `pool_${safeId}`;
    } else {
      baseOutput = `result_${safeId}`;
    }

    if (!sourceHandle || sourceHandle === "out") {
      return baseOutput;
    }

    return `${baseOutput}_${this.sanitizeId(sourceHandle)}`;
  }

  private getOutputVariables(nodeId: string): string[] {
    const outputHandles = new Set<string>(["out"]);
    const nodeInfo = this.executionGraph[nodeId];

    for (const outputHandle of Object.keys(nodeInfo.outputs)) {
      outputHandles.add(outputHandle);
    }

    return Array.from(outputHandles).map((handle) => this.getOutputVariable(nodeId, handle));
  }

  private getInputVariables(nodeInfo: GraphNodeInfo): string[] {
    const variables: string[] = [];

    for (const connections of Object.values(nodeInfo.inputs)) {
      for (const inputInfo of connections) {
        if (!inputInfo.bidirectional) {
          variables.push(this.getOutputVariable(inputInfo.source, inputInfo.sourceHandle));
        }
      }
    }

    return variables;
  }

  private sanitizeId(nodeId: string): string {
    return nodeId.replace(/[^a-zA-Z0-9]/g, "_");
  }

  private extractTrillVariable(code: string): TrillMeta | null {
    const pattern = /__trill_node__\s*=\s*(\{[\s\S]*?\})/;
    const match = code.match(pattern);

    if (!match || !match[1]) {
      return null;
    }

    try {
      // Accept Python-style single quotes in older notebook exports.
      const normalized = match[1].replace(/'/g, '"');
      const parsed = JSON.parse(normalized) as TrillMeta;
      return parsed;
    } catch {
      return null;
    }
  }

  private extractNotebookTrillMetadata(cell: Record<string, unknown>): NotebookTrillMetadata | null {
    const metadata = cell.metadata as Record<string, unknown> | undefined;
    if (!metadata) {
      return null;
    }

    const trill = metadata.trill as Record<string, unknown> | undefined;
    const source = trill ?? metadata;

    const parseConnections = (value: unknown): NotebookTrillConnection[] => {
      if (!Array.isArray(value)) {
        return [];
      }

      return value
        .map((entry) => entry as Record<string, unknown>)
        .filter((entry): entry is Record<string, unknown> => !!entry)
        .map((entry) => ({
          id: typeof entry.id === "string" ? entry.id : undefined,
          source: typeof entry.source === "string" ? entry.source : "",
          target: typeof entry.target === "string" ? entry.target : "",
          sourceHandle: typeof entry.sourceHandle === "string" ? entry.sourceHandle : undefined,
          targetHandle: typeof entry.targetHandle === "string" ? entry.targetHandle : undefined,
          bidirectional: typeof entry.bidirectional === "boolean" ? entry.bidirectional : undefined,
          type: typeof entry.type === "string" ? entry.type : undefined,
        }))
        .filter((entry) => !!entry.source && !!entry.target);
    };

    const nodeId =
      typeof source.nodeId === "string"
        ? source.nodeId
        : typeof source.id === "string"
          ? source.id
          : undefined;

    const nodeType =
      typeof source.nodeType === "string"
        ? source.nodeType
        : typeof source.type === "string"
          ? source.type
          : undefined;

    const nodeIn =
      typeof source.in === "string"
        ? source.in
        : undefined;

    const nodeOut =
      typeof source.out === "string"
        ? source.out
        : undefined;

    const inputs = parseConnections(source.inputs);
    const outputs = parseConnections(source.outputs);

    if (!nodeId && !nodeType && inputs.length === 0 && outputs.length === 0) {
      return null;
    }

    return {
      id: nodeId,
      type: nodeType,
      in: nodeIn,
      out: nodeOut,
      inputs,
      outputs,
    };
  }

  private buildNotebookTrillMetadata(nodeId: string, nodeType: string, node: TrillNode): NotebookTrillMetadata {
    const nodeInfo = this.executionGraph[nodeId];
    const inputs: NotebookTrillConnection[] = [];
    const outputs: NotebookTrillConnection[] = [];

    for (const [targetHandle, connections] of Object.entries(nodeInfo.inputs)) {
      for (const connection of connections) {
        inputs.push({
          source: connection.source,
          target: nodeId,
          sourceHandle: connection.sourceHandle,
          targetHandle,
          bidirectional: connection.bidirectional,
          type: connection.bidirectional ? "Interaction" : undefined,
        });
      }
    }

    for (const [sourceHandle, connections] of Object.entries(nodeInfo.outputs)) {
      for (const connection of connections) {
        outputs.push({
          source: nodeId,
          target: connection.target,
          sourceHandle,
          targetHandle: connection.targetHandle,
          bidirectional: connection.bidirectional,
          type: connection.bidirectional ? "Interaction" : undefined,
        });
      }
    }

    return {
      id: nodeId,
      type: nodeType,
      in: node.in ?? "DEFAULT",
      out: node.out ?? "DEFAULT",
      inputs,
      outputs,
    };
  }

  private normalizeNotebookConnection(connection: NotebookTrillConnection): TrillEdge | null {
    if (!connection.source || !connection.target) {
      return null;
    }

    const bidirectional =
      connection.bidirectional === true ||
      connection.type === "Interaction" ||
      connection.sourceHandle === "in/out" ||
      connection.targetHandle === "in/out";

    return {
      id: connection.id ?? `edge_${uuid()}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? (bidirectional ? "in/out" : "out"),
      targetHandle: connection.targetHandle ?? (bidirectional ? "in/out" : "in"),
      type: bidirectional ? "Interaction" : connection.type,
    };
  }

  private edgeKey(edge: TrillEdge): string {
    return [
      edge.source,
      edge.target,
      edge.sourceHandle ?? "",
      edge.targetHandle ?? "",
      edge.type ?? "",
    ].join("::");
  }

  private isBidirectionalEdge(edge: TrillEdge): boolean {
    return (
      edge.type === "Interaction" ||
      edge.sourceHandle === "in/out" ||
      edge.targetHandle === "in/out"
    );
  }

  private removeTrillVariable(code: string): string {
    const pattern = /__trill_node__\s*=\s*\{[\s\S]*?\}\n?/;
    return code.replace(pattern, "");
  }

  private unwrapCurioNodeExecution(code: string): string {
    const functionMarker = "def _curio_node():";
    const outputMarker = "_curio_output = _curio_node()";
    const tryMarker = "try:";
    const exceptMarker = "except NameError:";

    const functionStart = code.indexOf(functionMarker);
    const outputStart = code.indexOf(outputMarker);
    const tryStart = code.indexOf(tryMarker, outputStart >= 0 ? outputStart : 0);
    const exceptStart = code.indexOf(exceptMarker, tryStart >= 0 ? tryStart : 0);

    if (functionStart < 0 || outputStart < 0 || tryStart < 0 || exceptStart < 0) {
      return code;
    }

    const bodyStart = code.indexOf("\n\n", functionStart);
    const bodyEnd = code.lastIndexOf("\n\n", outputStart);

    if (bodyStart < 0 || bodyEnd < 0 || bodyEnd <= bodyStart) {
      return code;
    }

    const body = code.slice(bodyStart + 2, bodyEnd);
    const deindentedBody = this.deindent(body, 4).trimEnd();
    return this.stripGeneratedNodePrelude(deindentedBody).trim();
  }

  private stripGeneratedNodePrelude(code: string): string {
    const lines = code.split("\n");
    let index = 0;

    while (index < lines.length) {
      const line = lines[index].trim();

      if (line.startsWith("input_") && line.includes(" = ")) {
        index += 1;
        continue;
      }

      if (line.startsWith("arg = ")) {
        index += 1;
        continue;
      }

      break;
    }

    let end = lines.length;

    while (end > index) {
      const line = lines[end - 1].trim();

      if (line === "return input_data") {
        end -= 1;
        continue;
      }

      if (line === "") {
        end -= 1;
        continue;
      }

      break;
    }

    return lines.slice(index, end).join("\n").trimEnd();
  }

  private extractVegaLiteSpecCode(code: string): string {
    const specAssignMarker = "spec =";
    const specAssignStart = code.indexOf(specAssignMarker);

    if (specAssignStart < 0) {
      return code;
    }

    const objectStart = code.indexOf("{", specAssignStart);
    if (objectStart < 0) {
      return code;
    }

    let depth = 0;
    let objectEnd = -1;

    for (let index = objectStart; index < code.length; index += 1) {
      const char = code[index];

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          objectEnd = index;
          break;
        }
      }
    }

    if (objectEnd < 0) {
      return code;
    }

    return code.slice(objectStart, objectEnd + 1).trim();
  }

  private extractInputVariables(code: string): string[] {
    const variables: string[] = [];
    const lines = code.split("\n");

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (line.startsWith("input_") && line.includes(" = ")) {
        const rhs = line.slice(line.indexOf("=") + 1).trim();
        if (this.isSimpleVariableName(rhs)) {
          variables.push(rhs);
        }
      }

      if (line.startsWith("input_data = ")) {
        const rhs = line.slice("input_data = ".length).trim();
        if (this.isSimpleVariableName(rhs)) {
          variables.push(rhs);
        }
      }
    }

    return Array.from(new Set(variables));
  }

  private extractProducedVariables(code: string): string[] {
    const variables: string[] = [];
    const lines = code.split("\n");
    let primaryVar = "";

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (line.endsWith("= _curio_output")) {
        const lhs = line.slice(0, line.indexOf("=")).trim();
        if (this.isSimpleVariableName(lhs)) {
          primaryVar = lhs;
          variables.push(lhs);
        }
        continue;
      }

      if (primaryVar && line.endsWith(`= ${primaryVar}`)) {
        const lhs = line.slice(0, line.indexOf("=")).trim();
        if (this.isSimpleVariableName(lhs)) {
          variables.push(lhs);
        }
      }
    }

    return Array.from(new Set(variables));
  }

  private isSimpleVariableName(value: string): boolean {
    if (!value) {
      return false;
    }

    const first = value.charCodeAt(0);
    const startsWithLetterOrUnderscore =
      value[0] === "_" ||
      (first >= 65 && first <= 90) ||
      (first >= 97 && first <= 122);

    if (!startsWithLetterOrUnderscore) {
      return false;
    }

    for (let i = 1; i < value.length; i += 1) {
      const char = value[i];
      const code = value.charCodeAt(i);
      const isAlphaNum =
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57);
      if (!(isAlphaNum || char === "_")) {
        return false;
      }
    }

    return true;
  }

  private deindent(text: string, spaces: number): string {
    const prefix = " ".repeat(spaces);
    return text
      .split("\n")
      .map((line) => (line.startsWith(prefix) ? line.slice(spaces) : line))
      .join("\n");
  }

  public serializeNotebook(notebook: Notebook): string {
    return JSON.stringify(notebook, null, 2);
  }

  public serializeTrill(trillJson: TrillSpec): string {
    return JSON.stringify(trillJson, null, 2);
  }
}
