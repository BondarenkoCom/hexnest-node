import fs from 'fs';

const path = 'frontend/src/pages/AgentsPage.tsx';
let code = fs.readFileSync(path, 'utf-8');

// 1. Rename `exportToCore` to `toggleCoreExport`
code = code.replace(
  'const exportToCore = async (name: string) => {',
  'const toggleCoreExport = async (name: string, isExported: boolean) => {'
);
code = code.replace(
  '        const res = await fetch(`/api/models/${encodeURIComponent(name)}/export`, {\n          method: \'POST\'\n        });\n        const json: ApiResponse<any> = await res.json();\n        if (json.success) {\n          addNotification(`Successfully registered ${name} in Core network!`, \'success\');\n        } else {',
  '        const res = await fetch(`/api/models/${encodeURIComponent(name)}/export`, {\n          method: isExported ? \'DELETE\' : \'POST\'\n        });\n        const json: ApiResponse<any> = await res.json();\n        if (json.success) {\n          addNotification(isExported ? `Successfully unregistered ${name} from Core network.` : `Successfully registered ${name} in Core network!`, \'success\');\n          await fetchAgents();\n        } else {'
);

code = code.replace(
  'addNotification(json.error || \'Failed to export agent\', \'error\');',
  'addNotification(json.error || (isExported ? \'Failed to unexport agent\' : \'Failed to export agent\'), \'error\');'
);

code = code.replace(
  'addNotification(\'Failed to export agent: \' + err.message, \'error\');',
  'addNotification((isExported ? \'Failed to unexport agent: \' : \'Failed to export agent: \') + err.message, \'error\');'
);

// 2. Change the button to be smart about isExported
code = code.replace(
  '<button \n                  onClick={() => exportToCore(m.name)}\n                  className="px-3 py-1.5 bg-cyan/10 border border-cyan/30 text-cyan rounded-lg text-xs font-bold hover:bg-cyan/20 transition-colors"\n                  title="Make this agent available for others to invite"\n                >\n                  <Globe className="w-3 h-3 inline-block mr-1" /> Core\n                </button>',
  `<button 
                  onClick={() => toggleCoreExport(m.name, m.isExported || false)}
                  className={\`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors \${m.isExported ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/30' : 'bg-cyan/10 border-cyan/30 text-cyan hover:bg-cyan/20'}\`}
                  title={m.isExported ? "Unlink from Core directory so others cannot invite it" : "Make this agent available for others to invite in Core"}
                >
                  <Globe className="w-3 h-3 inline-block mr-1" /> {m.isExported ? 'Unlink' : 'Core'}
                </button>`
);

fs.writeFileSync(path, code);
console.log('patched frontend UX');
