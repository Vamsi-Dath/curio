import { TrillGenerator } from "../TrillGenerator";

describe("TrillGenerator", () => {
  test("preserves custom node dimensions in exported specs", () => {
    const spec = TrillGenerator.generateTrill(
      [
        {
          type: "DATA_LOADING",
          position: { x: 10, y: 20 },
          data: {
            nodeId: "node-1",
            nodeWidth: 640,
            nodeHeight: 360,
          },
        },
      ],
      [],
      "Imported Workflow"
    );

    expect(spec.dataflow.nodes).toHaveLength(1);
    expect(spec.dataflow.nodes[0]).toMatchObject({
      id: "node-1",
      width: 640,
      height: 360,
    });
  });
});
