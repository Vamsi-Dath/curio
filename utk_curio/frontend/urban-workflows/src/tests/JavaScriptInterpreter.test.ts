import { JavaScriptInterpreter } from '../JavaScriptInterpreter';
import { NodeType } from '../constants';

process.env.BACKEND_URL = 'http://localhost:5002';

jest.mock('../utils/authApi', () => ({
    getToken: () => null,
}));

jest.mock('../utils/formatters', () => ({
    formatDate: () => '2024-01-01T00:00:00',
    mapTypes: (t: any) => t,
}));

global.fetch = jest.fn();

const mockNodeExecProv = jest.fn();

describe('JavaScriptInterpreter', () => {
    let interpreter: JavaScriptInterpreter;

    beforeEach(() => {
        interpreter = new JavaScriptInterpreter();
        jest.clearAllMocks();
    });

    test('calls /processJavaScriptCode endpoint (not /processPythonCode)', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                stdout: [],
                stderr: '',
                input: { dataType: '' },
                output: { path: 'abc123', dataType: 'int' },
            }),
        });

        const callback = jest.fn();

        interpreter.interpretCode(
            'return 1;',
            'return 1;',
            '',
            [],
            callback,
            NodeType.JS_COMPUTATION,
            'node-1',
            'workflow-1',
            mockNodeExecProv,
        );

        await new Promise(setImmediate);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url] = (global.fetch as jest.Mock).mock.calls[0];
        expect(url).toContain('/processJavaScriptCode');
        expect(url).not.toContain('/processPythonCode');
    });

    test('calls callback with response JSON on success', async () => {
        const fakeResponse = {
            stdout: ['hello'],
            stderr: '',
            input: { dataType: 'str' },
            output: { path: 'xyz', dataType: 'int' },
        };

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => fakeResponse,
        });

        const callback = jest.fn();

        interpreter.interpretCode(
            'return 1;', 'return 1;', '', [], callback,
            NodeType.JS_COMPUTATION, 'node-1', 'wf', mockNodeExecProv,
        );

        await new Promise(setImmediate);

        expect(callback).toHaveBeenCalledWith(fakeResponse);
    });

    test('calls callback with error object on network failure', async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

        const callback = jest.fn();

        interpreter.interpretCode(
            'return 1;', 'return 1;', '', [], callback,
            NodeType.JS_COMPUTATION, 'node-1', 'wf', mockNodeExecProv,
        );

        await new Promise(setImmediate);

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({
            stderr: expect.stringContaining('Network error'),
            output: expect.objectContaining({ path: '' }),
        }));
    });

    test('sends code without Python 4-space indentation', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                stdout: [], stderr: '',
                input: { dataType: '' },
                output: { path: 'x', dataType: 'int' },
            }),
        });

        const userCode = 'return 1;';
        interpreter.interpretCode(
            userCode, userCode, '', [], jest.fn(),
            NodeType.JS_COMPUTATION, 'node-1', 'wf', mockNodeExecProv,
        );

        await new Promise(setImmediate);

        const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(body.code).toBe(userCode);
        expect(body.code).not.toMatch(/^    /);
    });
});
