import { v4 as uuid } from "uuid";
import { isUtkSpec, isVegaLiteSpec, tryParseJsonObject } from "./notebook-convertor/grammarDetection";
import { NodeType } from "./constants";
import {
  GraphNodeInfo,
  Notebook,
  NotebookCell,
  NotebookTrillConnection,
  NotebookTrillConnectionsMetadata,
  TrillEdge,
  TrillMeta,
  TrillNode,
  TrillSpec,
} from "./notebook-convertor/types";
import { extractAssignedObjectLiteral, removeAssignedObjectVariables } from "./notebook-convertor/metadata";
import { buildLinearFallbackEdges, collectExplicitEdgesFromCells, inferEdgesFromVariables } from "./notebook-convertor/importEdges";
import {
  buildComputationBody,
  buildDataPoolBody,
  buildMergeFlowBody,
  buildUtkNotebookCode,
  buildUtkVisualizationBody,
  buildVegaVisualizationBody,
  buildTableVisualizationBody,
  buildTextVisualizationBody,
  buildImageVisualizationBody,
  buildConstantsBody,
  buildCommentBody,
  getUtkDataVar,
} from "./notebook-convertor/codegen";
import {
  buildExecutionGraph,
  buildNotebookTrillConnectionsMetadata,
  edgeKey,
  getInputVariables,
  getOutputVariables,
  normalizeNotebookConnection,
  sanitizeId,
  topologicalSort,
} from "./notebook-convertor/graph";
import {
  deindentText,
  extractInputVariables,
  extractProducedVariables,
  extractVegaLiteSpecCode,
  replaceKeywordsOutsideStrings,
  stripGeneratedNodePrelude,
} from "./notebook-convertor/parsing";

export type {
  Notebook,
  NotebookCell,
  TrillSpec,
} from "./notebook-convertor/types";

export class TrillNotebookConverter {
  private executionGraph: Record<string, GraphNodeInfo> = {};

  public trillToNotebook(trillJson: TrillSpec): Notebook {
    const nodes = trillJson.dataflow?.nodes ?? [];
    const edges = trillJson.dataflow?.edges ?? [];

    this.executionGraph = buildExecutionGraph(nodes, edges);

    const executionOrder = topologicalSort(this.executionGraph);
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

  public notebookToTrill(notebook: Partial<Notebook> | Record<string, unknown>): { trillSpec: TrillSpec; warnings?: string[] } {
    const rawCells = Array.isArray((notebook as { cells?: unknown[] }).cells)
      ? ((notebook as { cells: unknown[] }).cells ?? [])
      : [];

    const nodes: TrillNode[] = [];
    const edges: TrillEdge[] = [];
    const nodeInputs: Record<string, string[]> = {};
    const producedByVar: Record<string, string> = {};
    const position = { x: 100, y: 100 };
    const importedWorkflowId = uuid();

    let foundTrillMeta = false;

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

      const trillMeta = this.extractTrillVariable(code);
      if (trillMeta) {
        foundTrillMeta = true;
      }

      const nodeId =
        trillMeta?.id ?? `notebook_cell_${uuid()}`;
      const inferredNodeType = this.inferNodeType(code);
      const nodeType =
        trillMeta?.type ?? inferredNodeType;
      const nodeIn =
        trillMeta?.in ?? "DEFAULT";
      const nodeOut =
        trillMeta?.out ?? "DEFAULT";

      const codeWithoutMeta = this.removeTrillVariable(code);
      const inputVars = extractInputVariables(codeWithoutMeta);
      const producedVars = extractProducedVariables(codeWithoutMeta);

      const cleanCodeBody = this.unwrapCurioNodeExecution(codeWithoutMeta);
      const cleanCode =
        nodeType === NodeType.VIS_VEGA
          ? this.normalizeVegaSpecForCurio(extractVegaLiteSpecCode(cleanCodeBody))
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
      position.y += 150;
    });

    const { sawExplicitConnections, explicitEdges } = collectExplicitEdgesFromCells(
      rawCells,
      (code) => this.extractTrillConnectionsVariable(code),
      (connection) => normalizeNotebookConnection(connection),
      (edge) => edgeKey(edge),
    );

    if (sawExplicitConnections) {
      edges.push(...explicitEdges);
    }

    if (!sawExplicitConnections) {
      edges.push(
        ...inferEdgesFromVariables(
          nodes,
          nodeInputs,
          producedByVar,
          (node) => node.type === NodeType.MERGE_FLOW,
          () => `edge_${uuid()}`,
        ),
      );
    }

    if (edges.length === 0) {
      edges.push(...buildLinearFallbackEdges(nodes, () => `edge_${uuid()}`));
    }

    const warnings: string[] = [];
    if (!foundTrillMeta && !sawExplicitConnections) {
      warnings.push(
        "No Trill metadata detected in notebook cells; import used inference which may be lossy. See docs/IPYNB-USAGE.md for a recommended cell template.",
      );
    }

    const spec: TrillSpec = {
      dataflow: {
        nodes,
        edges,
        name: "Imported Notebook",
        task: "",
        timestamp: Date.now(),
        provenance_id: importedWorkflowId,
      },
    };

    return { trillSpec: spec, warnings: warnings.length > 0 ? warnings : undefined };
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
    } else if (nodeType === NodeType.DATA_EXPORT) {
      code = this.generateDataExportCode(node, nodeInfo);
    } else if (nodeType === NodeType.MERGE_FLOW) {
      code = this.generateMergeFlowCode(node, nodeInfo);
    } else if (nodeType === NodeType.DATA_POOL) {
      code = this.generateDataPoolCode(node, nodeInfo);
    } else if (nodeType === NodeType.DATA_SUMMARY) {
      code = this.generateDataSummaryCode(node, nodeInfo);
    } else if (nodeType === NodeType.DATA_CLEANING) {
      code = this.generateDataCleaningCode(node, nodeInfo);
    } else if (nodeType === NodeType.DATA_TRANSFORMATION) {
      code = this.generateDataTransformationCode(node, nodeInfo);
    } else if (nodeType === NodeType.FLOW_SWITCH) {
      code = this.generateFlowSwitchCode(node, nodeInfo);
    } else if (nodeType === NodeType.VIS_VEGA) {
      code = this.generateVegaVisualizationCode(node, nodeInfo);
    } else if (nodeType === NodeType.VIS_UTK) {
      code = this.generateUtkVisualizationCode(node, nodeInfo);
    } else if (nodeType === NodeType.VIS_TABLE) {
      code = this.generateVisTableCode(node, nodeInfo);
    } else if (nodeType === NodeType.VIS_TEXT) {
      code = this.generateVisTextCode(node, nodeInfo);
    } else if (nodeType === NodeType.VIS_IMAGE) {
      code = this.generateVisImageCode(node, nodeInfo);
    } else if (nodeType === NodeType.CONSTANTS) {
      code = this.generateConstantsCode(node, nodeInfo);
    } else if (nodeType === NodeType.COMMENTS) {
      code = this.generateCommentsCode(node, nodeInfo);
    } else {
      code = this.generateComputationCode(node, nodeInfo);
    }

    const nodeMeta = `__trill_node__ = {\n    "id": "${nodeId}",\n    "type": "${nodeType}",\n    "in": "${node.in ?? "DEFAULT"}",\n    "out": "${node.out ?? "DEFAULT"}"\n}\n\n`;
    const notebookConnectionsMeta = buildNotebookTrillConnectionsMetadata(nodeId, this.executionGraph);
    const connectionsMeta = `__trill_connections__ = ${JSON.stringify(notebookConnectionsMeta, null, 2)}\n\n`;

    return {
      cell_type: "code",
      source: nodeMeta + connectionsMeta + code,
      metadata: {
        id: nodeId,
        language: "python",
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
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);
    return this.wrapNodeExecution(code, outputs);
  }

  private generateDataExportCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);
    const body = buildComputationBody(inputs, node.content ?? "");
    return this.wrapNodeExecution(body, outputs);
  }

  private generateDataCleaningCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);
    const body = buildComputationBody(inputs, node.content ?? "");
    return this.wrapNodeExecution(body, outputs);
  }

  private generateDataTransformationCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);
    const body = buildComputationBody(inputs, node.content ?? "");
    return this.wrapNodeExecution(body, outputs);
  }

  private generateFlowSwitchCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);
    const body = buildComputationBody(inputs, node.content ?? "");
    return this.wrapNodeExecution(body, outputs);
  }

  private generateComputationCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const code = node.content ?? "";
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);

    const body = buildComputationBody(inputs, code);
    return this.wrapNodeExecution(body, outputs);
  }

  private generateMergeFlowCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);

    const body = buildMergeFlowBody(inputs);
    return this.wrapNodeExecution(body, outputs);
  }

  private generateDataPoolCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);
    const source = inputs.length > 0 ? inputs[0] : "None";

    const body = buildDataPoolBody(source);
    return this.wrapNodeExecution(body, outputs);
  }

  private generateDataSummaryCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const code = node.content ?? "";
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);

    const body = buildComputationBody(inputs, code);
    const primaryOutput = outputs[0] ?? "_curio_output";
    return this.wrapNodeExecution(body, outputs, primaryOutput);
  }

  private generateVegaVisualizationCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const code = this.normalizeVegaSpecForNotebook(node.content ?? "");
    const inputs = getInputVariables(nodeInfo, this.executionGraph);

    const inputVar = inputs.length > 0 ? inputs[0] : "None";
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);

    const body = buildVegaVisualizationBody(inputVar, code);
    return this.wrapNodeExecution(body, outputs);
  }

  private generateUtkVisualizationCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);
    const containerId = `utk-container-${node.id.substring(0, 8)}`;

    const dataVar = getUtkDataVar(inputs);

    const utkCode = buildUtkNotebookCode(node.content ?? "{}", containerId, dataVar, node.id);
    const body = buildUtkVisualizationBody(inputs, utkCode);
    return this.wrapNodeExecution(body, outputs, containerId);
  }

  private generateVisTableCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);
    const inputVar = inputs.length > 0 ? inputs[0] : "None";
    const body = buildTableVisualizationBody(inputVar);
    return this.wrapNodeExecution(body, outputs);
  }

  private generateVisTextCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);
    const inputVar = inputs.length > 0 ? inputs[0] : "None";
    const body = buildTextVisualizationBody(inputVar);
    return this.wrapNodeExecution(body, outputs);
  }

  private generateVisImageCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    const inputs = getInputVariables(nodeInfo, this.executionGraph);
    const outputs = getOutputVariables(node.id, node.type, this.executionGraph);
    const inputVar = inputs.length > 0 ? inputs[0] : "None";
    const body = buildImageVisualizationBody(inputVar);
    return this.wrapNodeExecution(body, outputs);
  }

  private generateConstantsCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    // Constants should be emitted as top-level definitions so they persist in the notebook namespace.
    return buildConstantsBody(node.content ?? "");
  }

  private generateCommentsCode(node: TrillNode, nodeInfo: GraphNodeInfo): string {
    // Emit comments as commented code lines within the cell so they are preserved.
    return buildCommentBody(node.content ?? "");
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

    const parsedVegaSpec = tryParseJsonObject(extractVegaLiteSpecCode(codeWithoutMeta));
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


  private normalizeVegaSpecForNotebook(specCode: string): string {
    return replaceKeywordsOutsideStrings(specCode, {
      true: "True",
      false: "False",
      null: "None",
    });
  }

  private normalizeVegaSpecForCurio(specCode: string): string {
    return replaceKeywordsOutsideStrings(specCode, {
      True: "true",
      False: "false",
      None: "null",
    });
  }

  private indent(text: string, spaces: number): string {
    const prefix = " ".repeat(spaces);
    return text
      .split("\n")
      .map((line) => (line.trim().length > 0 ? `${prefix}${line}` : line))
      .join("\n");
  }

  private extractTrillVariable(code: string): TrillMeta | null {
    const assignedObject = extractAssignedObjectLiteral(code, "__trill_node__");
    if (!assignedObject) {
      return null;
    }

    try {
      // Accept Python-style single quotes in older notebook exports.
      const normalized = assignedObject.replace(/'/g, '"');
      const parsed = JSON.parse(normalized) as TrillMeta;
      return parsed;
    } catch {
      return null;
    }
  }

  private extractTrillConnectionsVariable(code: string): NotebookTrillConnectionsMetadata | null {
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

    const assignedObject = extractAssignedObjectLiteral(code, "__trill_connections__");
    if (!assignedObject) {
      return null;
    }

    let parsed: Record<string, unknown>;
    try {
      // Accept Python-style single quotes in older notebook exports.
      parsed = JSON.parse(assignedObject.replace(/'/g, '"')) as Record<string, unknown>;
    } catch {
      return null;
    }

    const inputs = parseConnections(parsed.inputs);
    const outputs = parseConnections(parsed.outputs);

    if (inputs.length === 0 && outputs.length === 0) {
      return null;
    }

    return {
      inputs,
      outputs,
    };
  }

  private removeTrillVariable(code: string): string {
    return removeAssignedObjectVariables(code, ["__trill_node__", "__trill_connections__"]);
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
    const deindentedBody = deindentText(body, 4).trimEnd();
    return stripGeneratedNodePrelude(deindentedBody).trim();
  }

  public serializeNotebook(notebook: Notebook): string {
    return JSON.stringify(notebook, null, 2);
  }

  public serializeTrill(trillJson: TrillSpec): string {
    return JSON.stringify(trillJson, null, 2);
  }
}
