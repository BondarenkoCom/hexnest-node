import fs from 'fs';

const path = 'src/web/api/models.ts';
let code = fs.readFileSync(path, 'utf-8');

// Update toModelInfo
code = code.replace(
  '    active: boolean;\n    runtimeOnly?: boolean;\n  }): ModelInfo {',
  '    active: boolean;\n    isExported?: boolean;\n    runtimeOnly?: boolean;\n  }): ModelInfo {'
);

code = code.replace(
  '      responseMode: model.responseMode,\n      active: model.active',
  '      responseMode: model.responseMode,\n      active: model.active,\n      isExported: model.isExported || false'
);

// Add to export route
code = code.replace(
  '          supportedRoles: model.roles || ["expert", "critic"]\n        });\n\n        res.json({',
  '          supportedRoles: model.roles || ["expert", "critic"]\n        });\n\n        context.db.updateModelConfig(model.name, { isExported: true });\n\n        res.json({'
);

// Add to delete route
code = code.replace(
  '        await client.deleteAgentDirectory(model.name, endpointUrl);\n\n        res.json({',
  '        await client.deleteAgentDirectory(model.name, endpointUrl);\n\n        context.db.updateModelConfig(model.name, { isExported: false });\n\n        res.json({'
);

fs.writeFileSync(path, code);
console.log('patched models.ts');