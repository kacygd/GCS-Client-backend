const { Database } = require("bun:sqlite");
const { resolve } = require("path");
const utils = require('../utils/utils.js');

const db = new Database(resolve(import.meta.dir + "/../database.db"), { create: true });
try {
	db.exec(`CREATE TABLE IF NOT EXISTS updates (
		updateID INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
		state INTEGER NOT NULL DEFAULT 0,
		hasPatches INTEGER NOT NULL DEFAULT 0,
		timestamp int(11) NOT NULL DEFAULT 0)`);
	db.exec(`CREATE TABLE IF NOT EXISTS logs (
		logID INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
		type INTEGER NOT NULL DEFAULT 0,
		value1 varchar(255) NOT NULL DEFAULT '',
		value2 varchar(255) NOT NULL DEFAULT '',
		IP varchar(255) NOT NULL DEFAULT '',
		timestamp int(11) NOT NULL DEFAULT 0)`);
} catch(e) {
	utils.error(e);
}

module.exports = db;