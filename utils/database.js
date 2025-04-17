import { Database } from "bun:sqlite";
import { join } from "path";
import { readFileSync } from "node:fs";

const db = new Database(join(__dirname, "..", "data", "database.db"), { create: true });
try {
	db.exec(readFileSync(join(__dirname, "..", "data", "database.sql"), "utf8"));
	db.exec("PRAGMA journal_mode = WAL;");
} catch(e) {
	console.error(e);
}

export { db };