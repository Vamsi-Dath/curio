import { NodeLifecycleHook } from '../../registry/types';
import { useVega } from '../../hook/useVega';
import { useToastContext } from '../../providers/ToastProvider';

export const useVegaLifecycle: NodeLifecycleHook = (data, nodeState) => {
  const { showToast } = useToastContext();
  const { handleCompileGrammar } = useVega({ data, code: nodeState.code });

  const applyGrammar = async (spec: string) => {
    try {
      await handleCompileGrammar(spec);
      nodeState.setOutput({ code: 'success', content: '', outputType: '' });
    } catch (error: any) {
      nodeState.setOutput({ code: 'error', content: error.message, outputType: '' });
      showToast(error.message, 'error');
    }
  };

  return { applyGrammar };
}
