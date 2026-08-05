import * as fs from "fs";
import * as path from "path";
import { CompetitiveEngineState } from "@/types";

const DATA_DIR = "data";
const ENGINE_FILE = `${DATA_DIR}/competitive-engine.json`;

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (e) {
    console.error("[competitive-store] mkdir error:", e);
  }
}

export function loadEngineState(): CompetitiveEngineState | null {
  ensureDataDir();
  try {
    if (fs.existsSync(ENGINE_FILE)) {
      const raw = fs.readFileSync(ENGINE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.employees)) {
        return parsed as CompetitiveEngineState;
      }
    }
  } catch (e) {
    console.error("[competitive-store] load error:", e);
  }
  return null;
}

export function saveEngineState(state: CompetitiveEngineState): void {
  ensureDataDir();
  try {
    fs.writeFileSync(ENGINE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("[competitive-store] save error:", e);
  }
}
