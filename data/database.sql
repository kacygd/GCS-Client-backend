CREATE TABLE IF NOT EXISTS 'updates' (
	'updateID' INTEGER NOT NULL,
	'state' INTEGER NOT NULL DEFAULT 0,
	'hasPatches' INTEGER NOT NULL DEFAULT 0,
	'updateType' varchar(255) NOT NULL DEFAULT '',
	'timestamp' int(11) NOT NULL DEFAULT 0,
    PRIMARY KEY ('updateID' AUTOINCREMENT)
);

CREATE TABLE IF NOT EXISTS 'logs' (
	'logID' INTEGER NOT NULL ,
	'type' INTEGER NOT NULL DEFAULT 0,
	'value1' varchar(255) NOT NULL DEFAULT '',
	'value2' varchar(255) NOT NULL DEFAULT '',
	'IP' varchar(255) NOT NULL DEFAULT '',
	'timestamp' int(11) NOT NULL DEFAULT 0,
    PRIMARY KEY ('logID' AUTOINCREMENT)
);

ALTER TABLE updates ADD updateTypeNew varchar(255) NOT NULL DEFAULT '';
UPDATE updates SET updateTypeNew = updateType;
ALTER TABLE updates DROP updateType;
ALTER TABLE updates RENAME updateTypeNew TO updateType;

UPDATE updates SET updateType = "pc" WHERE updateType = 0;
UPDATE updates SET updateType = "pc-launcher" WHERE updateType = 1;
UPDATE updates SET updateType = "android" WHERE updateType = 2;
UPDATE updates SET updateType = "android-geode" WHERE updateType = 3;
UPDATE updates SET updateType = "android-launcher" WHERE updateType = 4;