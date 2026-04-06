import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { HexNestClient } from "../protocol/HexNestClient.js";
import { loadConfig } from "../config.js";
import { DatabaseService } from "../db/database.js";

async function run(): Promise<void> {
  const rl = createInterface({ input, output });
  const database = new DatabaseService();
  try {
    await database.ensureReady();

    // Load existing .env
    const envPath = path.resolve(process.cwd(), ".env");
    let envContent = "";
    try {
      envContent = await readFile(envPath, "utf8");
    } catch {
      console.error("No .env file found. Run 'npm run setup' first.");
      process.exit(1);
    }

    const coreUrl = loadConfig(database).coreUrl;

    console.log("\n=== HexNest Node User Registration ===");
    const email = (await rl.question("Email: ")).trim();
    if (!email) {
      throw new Error("Email is required");
    }

    const name = (await rl.question("Full name: ")).trim();
    if (!name) {
      throw new Error("Name is required");
    }

    const password = (await rl.question("Password (min 8 characters): ")).trim();
    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    const confirm = (await rl.question("Confirm password: ")).trim();
    if (password !== confirm) {
      throw new Error("Passwords do not match");
    }

    console.log("\nRegistering...");
    const client = new HexNestClient(coreUrl);
    const response = await client.registerUser({ email, password, name });

    console.log(`✓ Registration successful! userId=${response.userId}`);

    // Update .env with token
    const lines = envContent.split("\n");
    let foundEmail = false,
      foundToken = false;
    const updated = lines
      .map((line) => {
        if (line.startsWith("HEXNEST_USER_EMAIL=")) {
          foundEmail = true;
          return `HEXNEST_USER_EMAIL=${email}`;
        }
        if (line.startsWith("HEXNEST_USER_TOKEN=")) {
          foundToken = true;
          return `HEXNEST_USER_TOKEN=${response.token}`;
        }
        return line;
      })
      .join("\n");

    if (!foundEmail || !foundToken) {
      console.log("\nNote: Please ensure these values are in your .env:");
      if (!foundEmail) console.log(`HEXNEST_USER_EMAIL=${email}`);
      if (!foundToken) console.log(`HEXNEST_USER_TOKEN=${response.token}`);
    }

    await writeFile(envPath, updated, "utf8");
    console.log(`✓ Updated .env with auth token`);
    console.log(`\nNext: Run 'npm run dev' to start the node with your authenticated user.`);
  } catch (error) {
    console.error("Registration failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    database.close();
    rl.close();
  }
}

run();
