import { NotebookTrillConnection, NotebookTrillConnectionsMetadata, TrillEdge, TrillNode } from "./types";

export function collectExplicitEdgesFromCells(
  rawCells: unknown[],
  extractConnections: (code: string) => NotebookTrillConnectionsMetadata | null,
  normalizeConnection: (connection: NotebookTrillConnection) => TrillEdge | null,
  edgeKey: (edge: TrillEdge) => string,
): { sawExplicitConnections: boolean; explicitEdges: TrillEdge[] } {
  let sawExplicitConnections = false;
  const explicitEdges = new Map<string, TrillEdge>();

  for (const rawCell of rawCells) {
    const cell = rawCell as Record<string, unknown>;
    if (cell.cell_type !== "code") {
      continue;
    }

    const source = cell.source;
    const code = Array.isArray(source) ? source.join("") : String(source ?? "");
    const notebookConnectionsMeta = extractConnections(code);
    if (!notebookConnectionsMeta) {
      continue;
    }

    const serializedConnections = [
      ...(notebookConnectionsMeta.outputs ?? []),
      ...(notebookConnectionsMeta.inputs ?? []),
    ];

    if (serializedConnections.length > 0) {
      sawExplicitConnections = true;
    }

    for (const connection of serializedConnections) {
      const edge = normalizeConnection(connection);
      if (!edge) {
        continue;
      }

      const key = edgeKey(edge);
      if (!explicitEdges.has(key)) {
        explicitEdges.set(key, edge);
      }
    }
  }

  return {
    sawExplicitConnections,
    explicitEdges: Array.from(explicitEdges.values()),
  };
}

export function inferEdgesFromVariables(
  nodes: TrillNode[],
  nodeInputs: Record<string, string[]>,
  producedByVar: Record<string, string>,
  isMergeFlow: (node: TrillNode) => boolean,
  createEdgeId: () => string,
): TrillEdge[] {
  const edges: TrillEdge[] = [];
  const targetInputCount: Record<string, number> = {};
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
      if (isMergeFlow(node)) {
        const count = targetInputCount[node.id] ?? 0;
        targetHandle = `in_${count}`;
        targetInputCount[node.id] = count + 1;
      }

      edges.push({
        id: createEdgeId(),
        source: sourceNodeId,
        sourceHandle: "out",
        target: node.id,
        targetHandle,
      });
    }
  }

  return edges;
}

export function buildLinearFallbackEdges(nodes: TrillNode[], createEdgeId: () => string): TrillEdge[] {
  const edges: TrillEdge[] = [];
  let linearPreviousId: string | null = null;

  for (const node of nodes) {
    if (linearPreviousId) {
      edges.push({
        id: createEdgeId(),
        source: linearPreviousId,
        sourceHandle: "out",
        target: node.id,
        targetHandle: "in",
      });
    }
    linearPreviousId = node.id;
  }

  return edges;
}
