import { writeFileSync } from "node:fs";
import { generateSeed, seedJson } from "./seed/generate.js";

writeFileSync("data/seed.json", seedJson(generateSeed()));
console.log("Wrote data/seed.json.");
