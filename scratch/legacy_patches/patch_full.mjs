import fs from 'fs';

const path = 'frontend/src/pages/AgentsPage.tsx';
let code = fs.readFileSync(path, 'utf-8');

// 1. `const { refresh: refreshNode } = useNode();` -> `const { refresh: refreshNode, addNotification } = useNode();`
code = code.replace(
  'const { refresh: refreshNode } = useNode();',
  'const { refresh: refreshNode, addNotification } = useNode();'
);

// 2. Add toggleCoreExport exactly where exportToCore was:
code = code.replace(
  `  const updateResponseMode = async (name: string, responseMode: ModelConfig['responseMode']) => {`,
  `  const toggleCoreExport = async (name: string, isExported: boolean) => {
    setUpdatingAgentMode(name);
    try {
      const res = await fetch(\`/api/models/\${encodeURIComponent(name)}/export\`, {
        method: isExported ? 'DELETE' : 'POST'
      });
      const json: ApiResponse<any> = await res.json();
      if (json.success) {
        addNotification(isExported ? \`Successfully unregistered \${name} from Core.\` : \`Successfully registered \${name} in Core network!\`, 'success');
        await fetchAgents();
      } else {
        addNotification(json.error || (isExported ? 'Failed to unexport agent' : 'Failed to export agent'), 'error');
      }
    } catch (err: any) {
      console.error('Export agent error:', err);
      addNotification((isExported ? 'Failed to unexport agent: ' : 'Failed to export agent: ') + err.message, 'error');
    } finally {
      setUpdatingAgentMode(null);
    }
  };

  const updateResponseMode = async (name: string, responseMode: ModelConfig['responseMode']) => {`
);

// 3. Delete exportToCore completely. Wait, I reset the file to HEAD so `exportToCore` isn't there yet from my recent edits! But the user said "я бачу одну статичну кнопку core...". Ah, it was added manually in the PR! 
// Let's check `AgentsPage.tsx` content to see if `exportToCore` exists.