const { Database } = require("bun:sqlite");
const { resolve } = require("path");
const utils = require('../utils/utils.js');

const db = new Database(resolve(import.meta.dir + "/../database.db"), { create: true });
try {
	db.exec(`CREATE TABLE IF NOT EXISTS updates (
		updateID INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
		timestamp int(11) NOT NULL DEFAULT 0)`);
} catch(e) {
	utils.error(e);
}

module.exports = db;