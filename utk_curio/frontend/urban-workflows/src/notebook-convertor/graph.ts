import { v4 as uuid } from "uuid";
import { GraphNodeInfo, NotebookTrillConnection, NotebookTrillConnectionsMetadata, TrillEdge, TrillNode } from "./types";

/**
 * Build an execution graph from nodes and edges.
 * Execution graph tracks dependencies, dependents, and input/output connections for each node.
 */
export function buildExecutionGraph(
  nodes: TrillNode[],
  edges: TrillEdge[],
): Record<string, GraphNodeInfo> {
  const graph: Record<string, GraphNodeInfo> = {};

  for (const node of nodes) {
    graph[node.id] = {
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

    if (!graph[source] || !graph[target]) {
      continue;
    }

    const sourceInfo = graph[source];
    const targetInfo = graph[target];
    const bidirectional = isBidirectionalEdge(edge);

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

  return graph;
}

/**
 * Perform topological sort on execution graph to determine execution order.
 */
export function topologicalSort(executionGraph: Record<string, GraphNodeInfo>): string[] {
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

    for (const dep of executionGraph[nodeId].dependencies) {
      visit(dep);
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
    result.push(nodeId);
  };

  for (const nodeId of Object.keys(executionGraph)) {
    visit(nodeId);
  }

  return result;
}

/**
 * Generate output variable name for a node based on its type and handle.
 */
export function getOutputVariable(
  nodeId: string,
  nodeType: string,
  sourceHandle: string = "out",
): string {
  const safeId = sanitizeId(nodeId);

  let baseOutput = "";

  // Check for specific node types
  if (nodeType === "DATA_LOADING") {
    baseOutput = `data_${safeId}`;
  } else if (nodeType === "MERGE_FLOW") {
    baseOutput = `merged_${safeId}`;
  } else if (nodeType === "DATA_POOL") {
    baseOutput = `pool_${safeId}`;
  } else {
    baseOutput = `result_${safeId}`;
  }

  if (!sourceHandle || sourceHandle === "out") {
    return baseOutput;
  }

  return `${baseOutput}_${sanitizeId(sourceHandle)}`;
}

/**
 * Get all output variables for a node.
 */
export function getOutputVariables(
  nodeId: string,
  nodeType: string,
  executionGraph: Record<string, GraphNodeInfo>,
): string[] {
  const outputHandles = new Set<string>(["out"]);
  const nodeInfo = executionGraph[nodeId];

  for (const outputHandle of Object.keys(nodeInfo.outputs)) {
    outputHandles.add(outputHandle);
  }

  return Array.from(outputHandles).map((handle) =>
    getOutputVariable(nodeId, nodeType, handle),
  );
}

/**
 * Get input variables for a node from its incoming connections.
 */
export function getInputVariables(
  nodeInfo: GraphNodeInfo,
  executionGraph: Record<string, GraphNodeInfo>,
): string[] {
  const variables: string[] = [];

  for (const connections of Object.values(nodeInfo.inputs)) {
    for (const inputInfo of connections) {
      if (!inputInfo.bidirectional) {
        const sourceNodeType = executionGraph[inputInfo.source].node.type;
        variables.push(
          getOutputVariable(inputInfo.source, sourceNodeType, inputInfo.sourceHandle),
        );
      }
    }
  }

  return variables;
}

/**
 * Sanitize node IDs by replacing non-alphanumeric characters.
 */
export function sanitizeId(nodeId: string): string {
  return nodeId.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Check if an edge is bidirectional.
 */
export function isBidirectionalEdge(edge: TrillEdge): boolean {
  return (
    edge.type === "Interaction" ||
    edge.sourceHandle === "in/out" ||
    edge.targetHandle === "in/out"
  );
}

/**
 * Generate a unique key for an edge for deduplication.
 */
export function edgeKey(edge: TrillEdge): string {
  return [
    edge.source,
    edge.target,
    edge.sourceHandle ?? "",
    edge.targetHandle ?? "",
    edge.type ?? "",
  ].join("::");
}

/**
 * Normalize notebook connection to TrillEdge format.
 */
export function normalizeNotebookConnection(connection: NotebookTrillConnection): TrillEdge | null {
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

/**
 * Build notebook-format connections metadata for a node.
 * This metadata is serialized into the notebook cell for export.
 */
export function buildNotebookTrillConnectionsMetadata(
  nodeId: string,
  executionGraph: Record<string, GraphNodeInfo>,
): NotebookTrillConnectionsMetadata {
  const nodeInfo = executionGraph[nodeId];
  const inputs: NotebookTrillConnection[] = [];
  const outputs: NotebookTrillConnection[] = [];

  for (const [targetHandle, connections] of Object.entries(nodeInfo.inputs)) {
    for (const connection of connections) {
      inputs.push({
        source: connection.source,
        target: nodeId,
        sourceHandle: connection.sourceHandle,
        targetHandle,
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
        type: connection.bidirectional ? "Interaction" : undefined,
      });
    }
  }

  return {
    inputs,
    outputs,
  };
}
