import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveFromRuntimeBase(targetPath: string, baseEnv: NodeJS.ProcessEnv): string {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }
  return path.resolve(resolveRuntimeBaseDir(baseEnv), targetPath);
}

function findUpwards(startDir: string, targetName: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, targetName);
    if (fs.existsSync(candidate)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function resolvePackageRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return findUpwards(moduleDir, "package.json") || process.cwd();
}

export function resolveRuntimeBaseDir(baseEnv: NodeJS.ProcessEnv = process.env): string {
  const explicitBaseDir = String(baseEnv.HEXNEST_APP_DATA_DIR || "").trim();
  if (!explicitBaseDir) {
    // Keep runtime files stable even when the app is launched from a parent folder.
    return resolvePackageRoot();
  }
  return path.isAbsolute(explicitBaseDir) ? explicitBaseDir : path.resolve(process.cwd(), explicitBaseDir);
}

export function resolveRuntimePath(targetPath: string, baseEnv: NodeJS.ProcessEnv = process.env): string {
  return resolveFromRuntimeBase(targetPath, baseEnv);
}

export function resolveDefaultEnvFile(baseEnv: NodeJS.ProcessEnv = process.env): string | null {
  const explicitEnvFile = String(baseEnv.HEXNEST_ENV_FILE || "").trim();
  if (explicitEnvFile) {
    return resolveFromRuntimeBase(explicitEnvFile, baseEnv);
  }

  const cwdEnvFile = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(cwdEnvFile)) {
    return cwdEnvFile;
  }

  const packageEnvFile = path.resolve(resolvePackageRoot(), ".env");
  if (fs.existsSync(packageEnvFile)) {
    return packageEnvFile;
  }

  return null;
}

export function resolveDefaultYamlConfigPath(baseEnv: NodeJS.ProcessEnv = process.env): string | null {
  const explicitConfigPath = String(baseEnv.HEXNEST_CONFIG_PATH || "").trim();
  if (explicitConfigPath) {
    return resolveFromRuntimeBase(explicitConfigPath, baseEnv);
  }

  const cwdConfig = path.resolve(process.cwd(), "node-config.yaml");
  if (fs.existsSync(cwdConfig)) {
    return cwdConfig;
  }

  const packageConfig = path.resolve(resolvePackageRoot(), "node-config.yaml");
  if (fs.existsSync(packageConfig)) {
    return packageConfig;
  }

  return null;
}

export function resolvePublicDir(baseEnv: NodeJS.ProcessEnv = process.env): string {
  const explicitPublicDir = String(baseEnv.HEXNEST_PUBLIC_DIR || "").trim();
  if (explicitPublicDir) {
    return resolveFromRuntimeBase(explicitPublicDir, baseEnv);
  }

  const packageRoot = resolvePackageRoot();

  // Prefer frontend/dist if it exists (for the new Vite-based UI)
  const vitePublicDir = path.resolve(packageRoot, "frontend", "dist");
  if (fs.existsSync(vitePublicDir)) {
    return vitePublicDir;
  }

  const packagePublicDir = path.resolve(packageRoot, "public");
  if (fs.existsSync(packagePublicDir)) {
    return packagePublicDir;
  }

  return path.resolve(process.cwd(), "public");
}