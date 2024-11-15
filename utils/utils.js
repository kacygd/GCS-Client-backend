import { access, constants, unlink } from 'node:fs';
import { resolve } from "path";
import * as Seven from 'node-7z';

import { db } from '../utils/database.js';

const utils = {
	/*
		utils.log(text, type)
		Log something
	
		text — text to log
		type — log type:
			0 — information (default)
			1 — warning
			2 — error
		
		Return: void
	*/
	log: async (text, type = 0) => {
		switch(type) {
			case 0:
				console.log(text);
				break;
			case 1:
				console.warn(text);
				break;
			case 2:
				console.error(text);
				break;
		}
	},
	timestamp: async () => {
		return Math.floor(new Date().getTime() / 1000);
	},
	newUpdate: async (timestamp = null) => {
		if(timestamp == null) timestamp = await utils.timestamp();
		const query = db.prepare("INSERT INTO updates (timestamp) VALUES (:timestamp)", {
			':timestamp': timestamp
		});
		const updateID = query.run().lastInsertRowid;
		query.finalize();
		return updateID;
	},
	getUpdates: async (lastUpdateTimestamp, order = "DESC") => {
		const query = db.prepare("SELECT * FROM updates WHERE timestamp > :timestamp AND state = 3 ORDER BY timestamp " + order, {
			':timestamp': lastUpdateTimestamp
		});
		var updates = query.all();
		query.finalize();
		return updates;
	},
	directoryExists: async (path) => {
		return new Promise(r => {
			try {
				access(path, constants.R_OK | constants.W_OK, err => {
					if(err) r(false);
					else r(true);
				});
			} catch (err) {
				r(false);
			}
		});
	},
	deletedFiles: async (oldFiles, newFiles) => {
		return oldFiles.filter(x => !newFiles.includes(x));
	},
	pathTo7zip: async () => {
		const platforms = {win32: 'windows', linux: 'linux'};
		const architectures = {x64: '64', arm64: '_arm64'};
		return resolve(import.meta.dir + "/../lib/7zip/" + platforms[process.platform] + architectures[process.arch] + "/7za" + (process.platform == 'win32' ? ".exe" : ".linux"));
	},
	createLatestVersionArchive: async (timestamp = false) => {
		return new Promise(async function(r) {
			await unlink(resolve("./files/latest.7z"), err => { if(err) utils.log(err, 2); });
			const pathTo7zip = await utils.pathTo7zip();
			const makeArchive = Seven.add(resolve("./files/latest.7z"), resolve("./files/last/*.*"), {
				recursive: true,
				$bin: pathTo7zip
			});
			makeArchive.on('data', async function(data) {
				utils.log("Added to archive: " + data.file);
				Bun.gc(true);
			});
			makeArchive.on('end', async function() {
				if(timestamp) {
					const makePatchesArchive = Seven.add(resolve("./patches/" + timestamp +  "/patches.7z"), resolve("./patches/" + timestamp +  "/*.*"), {
						recursive: true,
						$bin: pathTo7zip,
						$cherryPick: '!patches.7z'
					});
					makePatchesArchive.on('data', async function(data) {
						utils.log("Added to patches archive: " + data.file);
						Bun.gc(true);
					});
					makePatchesArchive.on('end', async function(data) {
						r(true);
					});
				} else {
					r(true);
				}
			});
		});
	},
	changeUpdateState: async (updateID, state, hasPatches) => {
		try {
			const query = db.prepare("UPDATE updates SET state = :state, hasPatches = :hasPatches WHERE updateID = :updateID", {
				':state': state, ':hasPatches': hasPatches, ':updateID': updateID
			});
			await query.run();
			query.finalize();
			return true;
		} catch(e) {
			utils.log(e, 2);
			return false;
		}
	},
	checkToken: async (token, IP) => {
		if(await utils.getFailedLogins(IP) > 10) return false;
		return new Promise(async function(r) {
			if(token != process.env.TOKEN) {
				utils.logAction(1, 0, "", IP);
				r(false);
			}
			else r(true);
		});
	},
	logAction: async (type = 0, value1 = "", value2 = "", IP = "") => {
		var timestamp = await utils.timestamp();
		const query = db.prepare("INSERT INTO logs (type, value1, value2, IP, timestamp) VALUES (:type, :value1, :value2, :IP, :timestamp)", {
			':type': type, ':value1': value1, ':value2': value2, ':IP': IP, ':timestamp': timestamp
		});
		const logID = query.run().lastInsertRowid;
		query.finalize();
		return logID;
	},
	getFailedLogins: async (IP) => {
		var timestamp = await utils.timestamp() - 604800;
		const query = db.prepare("SELECT * FROM logs WHERE type = 1 AND value1 = 0 AND IP = :IP AND timestamp > :timestamp", {
			':IP': IP, ':timestamp': timestamp
		});
		var logs = query.all();
		query.finalize();
		return logs.length;
	},
	getPatchUpdates: async (lastUpdateTimestamp) => {
		const query = db.prepare("SELECT * FROM updates WHERE timestamp > :timestamp AND state = 3 AND hasPatches = 1 ORDER BY timestamp ASC", {
			':timestamp': lastUpdateTimestamp
		});
		var updates = query.all();
		query.finalize();
		return updates;
	},
	getLastUpdateTimestamp: async () => {
		const query = db.prepare("SELECT timestamp FROM updates WHERE state = 3 ORDER BY timestamp DESC LIMIT 1");
		var lastUpdateTimestamp = query.get();
		query.finalize();
		return lastUpdateTimestamp;
	}
};

export { utils };