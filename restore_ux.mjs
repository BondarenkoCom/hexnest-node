import fs from 'fs';

const path = 'frontend/src/pages/AgentsPage.tsx';
let code = fs.readFileSync(path, 'utf-8');

// 1. Add toggleCoreExport inside AgentsPage component
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

// 2. Insert the UI button for Core
code = code.replace(
  /<button \n\s*onClick=\{\(\) => deleteAgent\(m\.name\)\}/,
  `<button 
                  onClick={() => toggleCoreExport(m.name, m.isExported || false)}
                  className={\`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors \${m.isExported ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/30' : 'bg-cyan/10 border-cyan/30 text-cyan hover:bg-cyan/20'}\`}
                  title={m.isExported ? "Unlink from Core directory so others cannot invite it" : "Make this agent available for others to invite in Core"}
                >
                  <Globe className="w-3 h-3 inline-block mr-1" /> {m.isExported ? 'Unlink' : 'Core'}
                </button>

                <button 
                  onClick={() => deleteAgent(m.name)}`
);

// 3. Make sure Globe is imported
code = code.replace(
  `import { Plus, Trash2, Play, Pause, Star, X, Info } from 'lucide-react';`,
  `import { Plus, Trash2, Play, Pause, Star, X, Info, Globe } from 'lucide-react';`
);

// 4. Update the refreshNode hook usage (since I reverted alerts patch too)
code = code.replace(
  `const { refresh: refreshNode } = useNode();`,
  `const { refresh: refreshNode, addNotification } = useNode();`
);

// 5. Replace previous basic alerts to not lose the previous prompt's work
code = code.replace(/alert\((.*?)\);/g, `addNotification($1, 'error');`);
code = code.replace(/alert\`Successfully registered \$\{name\} in Core network!\`;/g, `addNotification(\`Successfully registered \${name} in Core network!\`, 'success');`);

fs.writeFileSync(path, code);
console.log('restored user work and implemented core toggle block');