import { mkdirSync, readFileSync } from "node:fs";
import { createApp } from "./app.js";
import { chatCompletionsModel, modelSettingsFrom } from "./assistant/model.js";
import { loadSeedIfEmpty, openDatabase, readSeed } from "./db.js";

try {
  process.loadEnvFile(".env");
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

const sessionSecret = process.env.SESSION_SECRET?.trim();
if (!sessionSecret || sessionSecret.startsWith("replace-with") || sessionSecret.length < 16) {
  console.error("SESSION_SECRET must be set to a random string of 16 or more characters; the supplier desk keys session ids with it.");
  process.exit(1);
}

mkdirSync("data", { recursive: true });
const db = openDatabase("data/desk.sqlite");
if (loadSeedIfEmpty(db, readSeed(readFileSync("data/seed.json", "utf8")))) {
  console.log("Loaded data/seed.json into data/desk.sqlite.");
}

const settings = modelSettingsFrom(process.env);
const app = createApp({
  db,
  sessionSecret,
  model: settings ? chatCompletionsModel(settings) : null,
  now: () => new Date(),
  cookieSecure: process.env.COOKIE_SECURE?.trim().toLowerCase() === "true",
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST?.trim() || "127.0.0.1";
app.listen(port, host, (error?: Error) => {
  if (error) {
    console.error(`Could not listen on ${host}:${port}: ${error.message}`);
    process.exit(1);
  }
  console.log(`Supplier desk listening on ${host}:${port}${settings ? "" : " (assistant closed: model settings unset)"}.`);
});
