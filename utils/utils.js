import { access, constants, unlink, createWriteStream } from 'node:fs';
import { mkdir, rename, copyFile, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve } from "path";
import yauzl from "yauzl-promise";
import yazl from "yazl";
import CRC32 from "crc-32";
import { hdiffpatch } from './hdiffpatch.js';

import { db } from '../utils/database.js';

const utils = {
    log: async (text, type = 0) => {
        switch (type) {
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

    logNewUpdate: async (timestamp, updateType) => {
        const query = db.prepare("INSERT INTO updates (updateType, timestamp) VALUES (:updateType, :timestamp)", {
            ':timestamp': timestamp, ':updateType': updateType
        });
        const updateID = query.run().lastInsertRowid;
        query.finalize();
        return updateID;
    },

    getUpdates: async (lastUpdateTimestamp, updateType, order = "DESC") => {
        const query = db.prepare("SELECT * FROM updates WHERE timestamp > :timestamp AND updateType = :updateType AND state = 3 ORDER BY timestamp " + order, {
            ':timestamp': lastUpdateTimestamp, ':updateType': updateType
        });
        var updates = query.all();
        query.finalize();
        return updates;
    },

    directoryExists: async (path) => {
        return new Promise(r => {
            try {
                access(path, constants.R_OK | constants.W_OK, err => {
                    if (err) r(false);
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

    changeUpdateState: async (updateID, state, hasPatches) => {
        try {
            const query = db.prepare("UPDATE updates SET state = :state, hasPatches = :hasPatches WHERE updateID = :updateID", {
                ':state': state, ':hasPatches': hasPatches, ':updateID': updateID
            });
            await query.run();
            query.finalize();
            return true;
        } catch (e) {
            utils.log(e, 2);
            return false;
        }
    },

    checkToken: async (token, IP) => {
        return new Promise(async function (r) {
            if (await utils.getFailedLogins(IP) > 10) return r(false);

            if (token != process.env.TOKEN) {
                utils.logAction(1, 0, "", IP);
                r(false);
            } else r(true);
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

    getPatchUpdates: async (lastUpdateTimestamp, updateType) => {
        const query = db.prepare("SELECT * FROM updates WHERE timestamp > :timestamp AND updateType = :updateType AND state = 3 AND hasPatches = 1 ORDER BY timestamp ASC", {
            ':timestamp': lastUpdateTimestamp, ':updateType': updateType
        });
        var updates = query.all();
        query.finalize();
        return updates;
    },

    getLastUpdateTimestamp: async (updateType) => {
        const query = db.prepare("SELECT timestamp FROM updates WHERE state = 3 AND updateType = :updateType ORDER BY timestamp DESC LIMIT 1", {
            ':updateType': updateType
        });
        var lastUpdateTimestamp = query.get();
        query.finalize();
        return lastUpdateTimestamp;
    },

    checkUpdatesCreating: async (updateType) => {
        const timestamp = await utils.timestamp() - 300;
        const query = db.prepare("SELECT * FROM updates WHERE updateType = :updateType AND state != 3", {
            ':updateType': updateType
        });
        var logs = query.all();
        query.finalize();
        return logs.length > 0;
    },

    validatePerson: async (req, server, token) => {
        try {
            const IP = server.requestIP(req).address;
            const tokenCheck = await utils.checkToken(token, IP);
            return tokenCheck;
        } catch (e) {
            utils.log(e, 2);
            return false;
        }
    },

    createNewArchiveUpdate: async (updateFile, updateType, timestamp, updateVersion) => {
        return new Promise(async (res, rej) => {
            const zipFile = await yauzl.fromBuffer(updateFile).catch(e => rej(e));
            if (!zipFile) return; // Dont process update if file is bad
            res(true); // Tell server, that file is good

            const updateID = await utils.logNewUpdate(timestamp, updateType);

            const oldPath = `./files/${updateType}`;
            const newPath = `./files/TEMP/${updateType}/${timestamp}`;
            const patchesPath = `./patches/${updateType}/${timestamp}`;
            const patchedFiles = [];

            await utils.changeUpdateState(updateID, 0, 0);

            const newFiles = await utils.unzipArchive(zipFile, updateType, newPath);
            utils.log(`[${updateType}] Unzipping done!!! :3`);
            await zipFile.close();

            await utils.changeUpdateState(updateID, 1, 0);

            const oldPathExists = await utils.directoryExists(oldPath);
            if (!oldPathExists) {
                await rename(resolve(newPath), resolve(oldPath));
                await utils.saveFilesJSON(oldPath, newFiles);
                utils.log(`[${updateType}] Your first update lol nothing to patch! Done`);

                await utils.changeUpdateState(updateID, 3, 0);
                return; // That means this is first update, no patches
            }

            utils.log(`[${updateType}] Making patch files now. :trollface:`);
            await utils.changeUpdateState(updateID, 2, 1);

            for await (const file of newFiles) {
                const oldFilePath = resolve(oldPath, file);
                const newFilePath = resolve(newPath, file);
                const patchPath = resolve(patchesPath, file);

                let oldFileExists = false;
                try {
                    await stat(oldFilePath);
                    oldFileExists = true;
                } catch {
                    oldFileExists = false;
                }

                if (!oldFileExists) {
                    utils.log(`[${updateType}] Moving file ${file} as it is new file`);
                    await mkdir(resolve(patchPath, '../'), { recursive: true });
                    await copyFile(newFilePath, patchPath + ".m"); // This file is not presented in old updates -> new -> nothing to patch
                    patchedFiles.push(file + ".m");
                    continue;
                }

                const oldFileContent = await readFile(oldFilePath);
                const newFileContent = await readFile(newFilePath);

                const oldFileChecksum = CRC32.buf(oldFileContent);
                const newFileChecksum = CRC32.buf(newFileContent);
                if (oldFileChecksum == newFileChecksum) {
                    utils.log(`[${updateType}] Skipped making patch for ${file} as these files are same`);
                    continue; // Files are the same -> nothing to patch
                }

                utils.log(`[${updateType}] Making patch file for ${file}`);
                await hdiffpatch.diff(oldFilePath, newFilePath, patchPath + ".p");
                patchedFiles.push(file + ".p");
            }

            const oldFiles = await utils.loadJSON(resolve(`./files/${updateType}/files.json`));
            const deletedFiles = await utils.deletedFiles(oldFiles, newFiles);
            if (deletedFiles.length > 0) { // There are deleted files! Adding delete patch files
                for await (const file of deletedFiles) {
                    const patchPath = resolve(patchesPath, file);
                    utils.log(`[${updateType}] Deleting file ${file} as it is not presented in new archive`);
                    await mkdir(resolve(patchPath, '../'), { recursive: true });
                    await writeFile(patchPath + ".d", ":3");
                    patchedFiles.push(file + ".d");
                }
            }

            await utils.makeZip(patchedFiles, patchesPath);

            await rm(oldPath, { recursive: true, force: true });
            await rename(resolve(newPath), resolve(oldPath));
            await utils.saveFilesJSON(oldPath, newFiles);

            await utils.changeUpdateState(updateID, 3, 1);
            if (updateVersion) await writeFile(resolve(`./${updateType}-version`), updateVersion);

            utils.log(`[${updateType}] Everything is done!!!!! yaaay`);
        });
    },

    unzipArchive: async (zipFile, updateType, archivePath) => {
        const files = [];
        const createdDirectories = [];

        try {
            for await (const file of zipFile) {
                const fileName = `${archivePath}/${file.filename}`;

                if (file.filename.endsWith('/')) {
                    await mkdir(resolve(fileName), { recursive: true });
                } else {
                    if (!createdDirectories.includes(file.filename)) {
                        await mkdir(resolve(fileName, '../'), { recursive: true });
                        createdDirectories.push(file.filename);
                    }

                    files.push(file.filename);

                    const writeStream = await createWriteStream(resolve(fileName));
                    const readStream = await file.openReadStream();

                    await pipeline(readStream, writeStream).catch(err => utils.log(`[${updateType}] ${file.filename}, unzip error: ` + err.message, 2));
                    utils.log(`[${updateType}] ${file.filename}, processed`);
                }
            }
        } catch (e) {
            utils.log(e, 2);
        } finally {
            return files;
        }
    },

    saveFilesJSON: async (path, files) => {
        return await writeFile(resolve(`${path}/files.json`), JSON.stringify(files));
    },

    loadJSON: async (path) => {
        try {
            await stat(path); // Kiểm tra file tồn tại
            const JSONFileText = await readFile(path, 'utf8');
            return JSON.parse(JSONFileText);
        } catch (error) {
            utils.log(`Error loading JSON from ${path}: ${error.message}`, 2);
            return [];
        }
    },

    makeZip: async (files, patchesPath) => {
        return new Promise(async (r) => {
            const zipFile = new yazl.ZipFile();
            const writeStream = await createWriteStream(resolve(patchesPath, 'patches.zip'));

            for await (const file of files) {
                await zipFile.addFile(resolve(patchesPath, file), file);
            }

            await zipFile.end();
            zipFile.outputStream.pipe(writeStream).on("close", () => r(true));
        });
    },

    getUpdateFileType: async (updateType) => {
        switch (updateType) {
            case 'android':
                return 'file';
            case 'android-launcher':
                return 'file-version';
            case 'pc-launcher':
                return 'archive-version';
            default:
                return 'archive';
        }
    },

    createNewFileUpdate: async (updateFile, updateType, timestamp, updateVersion) => {
        return new Promise(async (r) => {
            utils.log(`[${updateType}] Saving new file...`);

            const updateID = await utils.logNewUpdate(timestamp, updateType);
            await utils.changeUpdateState(updateID, 0, 0);

            const filePath = `./files/${updateType}.file`;

            let oldFileExists = false;
            try {
                await stat(resolve(filePath));
                oldFileExists = true;
            } catch {
                oldFileExists = false;
            }

            await writeFile(resolve(filePath + "_new"), Buffer.from(updateFile));

            if (oldFileExists) await rm(resolve(filePath), { recursive: true, force: true });
            await rename(resolve(filePath + "_new"), resolve(filePath));

            utils.log(`[${updateType}] Done!`);
            await utils.changeUpdateState(updateID, 3, 0);
            if (updateVersion) await writeFile(resolve(`./${updateType}-version`), updateVersion);

            r(true);
        });
    },

    finishAllUpdates: async () => {
        try {
            const query = db.prepare("UPDATE updates SET state = 3");
            await query.run();
            query.finalize();
            return true;
        } catch (e) {
            utils.log(e, 2);
            return false;
        }
    }
};

export { utils };
