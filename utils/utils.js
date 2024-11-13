const db = require('../utils/database.js');

const utils = [];
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
utils.log = async function(text, type = 0) {
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
}

utils.timestamp = function() {
	return Math.floor(new Date().getTime() / 1000);
}

utils.newUpdate = function(timestamp = null) {
	if(timestamp == null) timestamp = utils.timestamp();
	const query = db.prepare("INSERT INTO updates (timestamp) VALUES (:timestamp)", {
		':timestamp': timestamp
	});
	query.run();
	query.finalize();
	return timestamp;
}

utils.getUpdates = function(lastUpdateTimestamp) {
	const query = db.prepare("SELECT * FROM updates WHERE timestamp > :timestamp ORDER BY timestamp DESC", {
		':timestamp': lastUpdateTimestamp
	})
	var updates = query.all();
	query.finalize();
	return updates;
}

module.exports = utils;