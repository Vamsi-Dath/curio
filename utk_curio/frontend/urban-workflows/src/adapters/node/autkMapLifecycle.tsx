import React, { useCallback, useEffect, useRef } from 'react';
import { NodeLifecycleHook } from '../../registry/types';

const DEFAULT_CODE = `// 'arg' is the layer array from the upstream JS Computation node:
// [{ name: string, type: string, geojson: GeoJSON.FeatureCollection }, ...]
// 'canvas' is the canvas element rendered inside this node.
// 'AutkMap' is imported from autk-map automatically.
const map = new AutkMap(canvas);
await map.init();
for (const layer of arg) {
    map.loadCollection(layer.name, { collection: layer.geojson, type: layer.type });
}
map.draw();`;

export const useAutkMapLifecycle: NodeLifecycleHook = (data, nodeState) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const runCode = useCallback(
        async (code: string) => {
            if (!canvasRef.current) return;
            const canvas = canvasRef.current;

            let arg: any = data.input;

            // Resolve artifact reference if the input is a path object.
            if (arg && typeof arg === 'object' && arg.path) {
                try {
                    const res = await fetch(arg.path);
                    arg = await res.json();
                } catch {
                    nodeState.setOutput({ code: 'error', content: 'Failed to fetch layer data.' });
                    return;
                }
            }
            arg = arg?.content ?? arg ?? [];

            nodeState.setOutput({ code: 'exec', content: '' });
            try {
                const { AutkMap } = await import('autk-map');
                // Execute user code with canvas and AutkMap in scope.
                // new Function creates a normal function; we wrap it in an async
                // IIFE inside so top-level await works in the user's snippet.
                const fn = new Function(
                    'arg', 'canvas', 'AutkMap',
                    `return (async () => { ${code} })();`
                );
                await fn(arg, canvas, AutkMap);
                nodeState.setOutput({ code: 'success', content: '' });
            } catch (err: any) {
                nodeState.setOutput({ code: 'error', content: err.message ?? String(err) });
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [data.input]
    );

    // Auto-run when upstream data arrives.
    useEffect(() => {
        if (data.input) {
            runCode(nodeState.code || DEFAULT_CODE);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.input]);

    const contentComponent = (
        <div style={{ width: '100%', height: 400, overflow: 'hidden' }}>
            <canvas ref={canvasRef} width={600} height={400} />
        </div>
    );

    return {
        contentComponent,
        defaultValueOverride: DEFAULT_CODE,
        sendCodeOverride: runCode,
    };
};
