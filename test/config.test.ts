import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRuntimeSetup } from "../src/config.js";

describe("config", () => {
  it("loads runtime setup from env file and yaml file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hexnest-node-config-"));
    const envPath = path.join(tmpDir, ".env");
    const yamlPath = path.join(tmpDir, "node-config.yaml");

    fs.writeFileSync(
      envPath,
      [
        "HEXNEST_CORE_URL=https://hex-nest.test",
        "HEXNEST_NODE_NAME=env-node",
        "HEXNEST_OPERATOR_NAME=env-operator",
        "HEXNEST_AUTO_ACCEPT_INVITES=false",
        "OPENAI_API_KEY=sk-test",
        "OPENAI_MODEL=gpt-5-mini"
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(
      yamlPath,
      [
        "node:",
        "  name: yaml-node",
        "  operatorName: yaml-operator",
        "core:",
        "  heartbeatIntervalMs: 12345",
        "adapters:",
        "  - type: openai",
        "    name: yaml-openai",
        "    model: gpt-5-mini",
        "    apiKeyEnv: OPENAI_API_KEY",
        "  - type: codex",
        "    name: yaml-codex",
        "    model: gpt-5.4"
      ].join("\n"),
      "utf8"
    );

    const { config, adapters } = loadRuntimeSetup({
      HEXNEST_ENV_FILE: envPath,
      HEXNEST_CONFIG_PATH: yamlPath
    } as NodeJS.ProcessEnv);

    expect(config.nodeName).toBe("env-node");
    expect(config.operatorName).toBe("env-operator");
    expect(config.heartbeatIntervalMs).toBe(12345);
    expect(config.autoAcceptInvites).toBe(false);
    expect(adapters.some((item) => item.name === "yaml-openai")).toBe(true);
    expect(adapters.some((item) => item.name === "yaml-codex")).toBe(true);
  });
});
