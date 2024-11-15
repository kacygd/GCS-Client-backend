import { Database } from "bun:sqlite";
import { join } from "path";
import { readFileSync } from "node:fs";

import { utils } from '../utils/utils.js';

const db = new Database(join(__dirname, "..", "data", "database.db"), { create: true });
try {
	db.exec(readFileSync(join(__dirname, "..", "data", "database.sql"), "utf8"));
	db.exec("PRAGMA journal_mode = WAL;");
} catch(e) {
	utils.error(e);
}

export { db };