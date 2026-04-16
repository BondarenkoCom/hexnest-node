import fs from 'fs';

const path = 'frontend/src/pages/AgentsPage.tsx';
let code = fs.readFileSync(path, 'utf-8');

const spot1 = '<button \n                  onClick={() => deleteAgent(m.name)}';
const spot2 = '<button \r\n                  onClick={() => deleteAgent(m.name)}';

const newStr = `<button 
                  onClick={() => toggleCoreExport(m.name, m.isExported || false)}
                  className={\`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors \${m.isExported ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/30' : 'bg-cyan/10 border-cyan/30 text-cyan hover:bg-cyan/20'}\`}
                  title={m.isExported ? "Unlink from Core directory so others cannot invite it" : "Make this agent available for others to invite in Core"}
                >
                  <Globe className="w-3 h-3 inline-block mr-1" /> {m.isExported ? 'Unlink' : 'Core'}
                </button>

                `;

if (code.includes(spot1)) {
  code = code.replace(spot1, newStr + spot1);
} else if (code.includes(spot2)) {
  code = code.replace(spot2, newStr + spot2);
} else {
  // try without newlines
  const spot3 = 'onClick={() => deleteAgent(m.name)}';
  code = code.replace(spot3, `onClick={() => toggleCoreExport(m.name, m.isExported || false)} className={\`px-3 py-1.5 bg-cyan/10 text-cyan\`}> <Globe/> Core </button> <button ${spot3}`);
}

fs.writeFileSync(path, code);
