import React, { useCallback, useEffect, useRef } from 'react';
import { NodeLifecycleHook } from '../../registry/types';

const DEFAULT_CODE = `// 'arg' is the data from the upstream node.
// 'div' is the container element rendered inside this node.
// 'AutkChart' is imported from autk-plot automatically.
//
// AutkChart types: 'scatterplot' | 'barchart' | 'linechart' |
//                  'heatmatrix' | 'parallel-coordinates' | 'table'
//
// 'arg' should be a GeoJSON FeatureCollection, or an array of layers
// from autk-db — in which case pick one:
//   const collection = Array.isArray(arg) ? arg[0].geojson : arg;

const collection = Array.isArray(arg) ? arg[0]?.geojson : arg;

new AutkChart(div, {
    type: 'scatterplot',
    collection,
    attributes: { axis: ['x', 'y'] },
    labels: { title: 'Chart' },
});`;

export const useAutkPlotLifecycle: NodeLifecycleHook = (data, nodeState) => {
    const divRef = useRef<HTMLDivElement>(null);

    const runCode = useCallback(
        async (code: string) => {
            if (!divRef.current) return;
            const div = divRef.current;

            // Clear previous chart before re-rendering.
            div.innerHTML = '';

            let arg: any = data.input;

            // Resolve artifact reference if the input is a path object.
            if (arg && typeof arg === 'object' && arg.path) {
                try {
                    const res = await fetch(arg.path);
                    arg = await res.json();
                } catch {
                    nodeState.setOutput({ code: 'error', content: 'Failed to fetch chart data.' });
                    return;
                }
            }
            arg = arg?.content ?? arg ?? [];

            nodeState.setOutput({ code: 'exec', content: '' });
            try {
                const { AutkChart } = await import('autk-plot');
                const fn = new Function(
                    'arg', 'div', 'AutkChart',
                    `return (async () => { ${code} })();`
                );
                await fn(arg, div, AutkChart);
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
        <div style={{ width: '100%', minHeight: 400, overflow: 'auto' }}>
            <div ref={divRef} />
        </div>
    );

    return {
        contentComponent,
        defaultValueOverride: DEFAULT_CODE,
        sendCodeOverride: runCode,
    };
};
