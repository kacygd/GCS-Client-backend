import { Elysia, t } from 'elysia';
import { utils } from './utils/utils.js';
import { hdiffpatch } from './utils/hdiffpatch.js';
const { resolve, dirname } = require("path");
import Seven from 'node-7z';
import fs from 'fs';
import * as md5File from 'md5-file';
import { cors } from '@elysiajs/cors';

const app = new Elysia({ serve: { maxRequestBodySize: 1024 * 1024 * 300 } });
app.use(cors());

app.get('/', async function({ server, request, cookie: { token } }) {
	const IP = server.requestIP(request).address;
	const tokenCheck = await utils.checkToken(token, IP);
	if(!tokenCheck) return Bun.file('pages/setToken.html');
	return Bun.file('pages/index.html');
});

app.post('/create', async function({ server, request, cookie: { token }, body: { file } }) {
	const IP = server.requestIP(request).address;
	const tokenCheck = await utils.checkToken(token, IP);
	if(!tokenCheck) return Bun.file('pages/setToken.html');
	const timestamp = await utils.timestamp();
	const pathTo7zip = await utils.pathTo7zip();
	await Bun.write(resolve("./files/" + timestamp + ".7z"), file);
	try {
		const updateID = await utils.newUpdate(timestamp);
		var extractedFiles = [];
		const oldExists = await utils.directoryExists(resolve("./files/last"));
		const folderToExtract = oldExists ? timestamp : "last";
		var hasPatches = 0;
		await utils.changeUpdateState(updateID, 0, hasPatches);
		const extractArchive = Seven.extractFull(resolve("./files/" + timestamp + ".7z"), resolve("./files/" + folderToExtract), {
			$progress: true,
			$bin: pathTo7zip
		});
		await utils.changeUpdateState(updateID, 1, hasPatches);
		extractArchive.on('data', async function (data) {
			utils.log("Extracted file: " + data.file);
			await Bun.sleep(2);
			if(data.file.indexOf('.') > -1) extractedFiles.push(data.file);
			Bun.gc(false);
		});
		extractArchive.on('end', async function () {
			await utils.changeUpdateState(updateID, 2, hasPatches);
			utils.log("Unzipping done!!! :3 ");
			await fs.unlink(resolve("./files/" + timestamp + ".7z"), err => { if(err) utils.log(err, 2); });
			var patchedFiles = [];
			if(oldExists) {
				utils.log("Making patch files now. :trollface:");
				hasPatches = 1;
				const oldFilesJSON = Bun.file(resolve("./files/files.json"));
				const oldFilesJSONExists = await oldFilesJSON.exists();
				if(oldFilesJSONExists) {
					const oldFilesText = await oldFilesJSON.text();
					var oldFiles = JSON.parse(oldFilesText);
				}
				var oldFilePath = '';
				var newFilePath = '';
				var patchFile = '';
				var i = 0;
				for(i = 0; i < extractedFiles.length; i++) {
					oldFilePath = resolve("./files/last/" + extractedFiles[i]);
					newFilePath = resolve("./files/" + timestamp + "/" + extractedFiles[i]);
					patchFile = resolve("./patches/" + timestamp + "/" + extractedFiles[i] + ".p");
					var oldFile = Bun.file(oldFilePath);
					var oldFileExists = await oldFile.exists();
					if(!oldFileExists) {
						utils.log("Moving file: " + extractedFiles[i] + " as it is new file");
						await fs.rename(newFilePath, oldFilePath, err => { if(err) utils.log(err, 2); }); 
						await fs.mkdir(dirname(patchFile), { recursive: true }, err => { if(err) utils.log(err, 2); });
						await Bun.write(resolve("./patches/" + timestamp + "/" + extractedFiles[i] + ".m"), ":3");
					} else {
						var originalFileChecksum = await md5File.sync(oldFilePath);
						var targetFileChecksum = await md5File.sync(newFilePath);
						if(originalFileChecksum == targetFileChecksum) {
							utils.log("Skipped making patch for: " + extractedFiles[i] + " as these files are same");
							Bun.gc(true);
						} else {
							fs.mkdir(dirname(patchFile), { recursive: true }, err => { if(err) utils.log(err, 2); });
							utils.log("Making patch file for: " + extractedFiles[i]);
							await hdiffpatch.diff(oldFilePath, newFilePath, patchFile);
							patchedFiles.push(extractedFiles[i]);
							Bun.gc(true);
						}
					}
				}
				if(oldFilesJSONExists) {
					const deletedFiles = await utils.deletedFiles(oldFiles, extractedFiles);
					if(deletedFiles.length > 0) {
						i = 0;
						var filePath = '';
						for(i = 0; i < deletedFiles.length; i++) {
							filePath = resolve("./files/last/" + deletedFiles[i]);
							utils.log("Deleting file: " + deletedFiles[i] + " as it is not presented in new archive");
							await fs.unlink(filePath, err => { if(err) utils.log(err, 2); });
							await fs.mkdir(dirname(patchFile), { recursive: true }, err => { if(err) utils.log(err, 2); });
							await Bun.write(resolve("./patches/" + timestamp + "/" + deletedFiles[i] + ".d"), ":3");
						}
					}
				}
				if(patchedFiles.length > 0) {
					i = 0;
					var filePath = '';
					for(i = 0; i < patchedFiles.length; i++) {
						filePath = resolve("./files/last/" + patchedFiles[i])
						patchFile = resolve("./patches/" + timestamp + "/" + patchedFiles[i] + ".p");
						fs.mkdir(dirname(patchFile), { recursive: true }, err => { if(err) utils.log(err, 2); });
						utils.log("Patching file: " + patchedFiles[i]);
						await hdiffpatch.patch(filePath, patchFile, filePath + "_new");
						await fs.unlink(filePath, err => { if(err) utils.log(err, 2); }); 
						await fs.rename(filePath + "_new", filePath, err => { if(err) utils.log(err, 2); }); 
						Bun.gc(true);
					}
				}
				await utils.createLatestVersionArchive(timestamp);
				await utils.changeUpdateState(updateID, 3, hasPatches);
			} else {
				await utils.createLatestVersionArchive();
				await utils.changeUpdateState(updateID, 3, hasPatches);
			}
			await Bun.write(resolve("./files/files.json"), JSON.stringify(extractedFiles));
			utils.log("Everything is done!!!!! yaaay");
			Bun.gc(true);
			try {
				const tempFolderExists = await utils.directoryExists(resolve("./files/" + timestamp));
				if(tempFolderExists) await fs.rmSync(resolve("./files/" + timestamp), { recursive: true, force: true });
			} catch(e) {
				utils.log(e, 2);
			}
		});
	} catch(e) {
		utils.log(e, 2);
		return 'Error while unzipping';
	}
	return 'File uploaded, other stuff will happen on backend';
}, {
  body: t.Object({
    file: t.File()
  })
});

app.get("/download/:lastUpdate", async function({ params: { lastUpdate } }) {
	if(lastUpdate == 0) {
		return Bun.file(resolve("./files/latest.7z"));
	} else {
		if(isNaN(lastUpdate)) {
			const lastUpdateDecoded = decodeURIComponent(atob(lastUpdate));
			return Bun.file(resolve("./files/last/" + lastUpdateDecoded));
		}
		return Bun.file(resolve("./patches/" + lastUpdate + "/patches.7z"));
	}
});

app.get("/updates/:lastUpdate", async function({ params: { lastUpdate } }) {
	const updates = await utils.getPatchUpdates(lastUpdate);
	var i = 0;
	var updatesTimeArray = [];
	for(i = 0; i < updates.length; i++) {
		updatesTimeArray.push(updates[i].timestamp);
	}
	return updatesTimeArray;
});

app.get("/lastUpdate", async function() {
	const lastUpdateTimestamp = await utils.getLastUpdateTimestamp();
	return lastUpdateTimestamp;
});

app.post("/files", async function({ server, request, body }) {
	return await new Promise(async function(r) {
		const files = body.files;
		if(files.length == 0) r({'error': 0});
		const IP = server.requestIP(request).address;
		const filesCheck = utils.checkFilesCreating(IP);
		if(filesCheck) r({'error': 1});
		const timestamp = await utils.timestamp();
		const pathTo7zip = await utils.pathTo7zip();
		const filesPath = [];
		var i = 0;
		for(i = 0; i < files.length; i++) filesPath.push(await resolve("./files/last/" + files[i]));
		const logID = await utils.logAction(2, 0, files.length, IP);
		const downloadFilesStream = Seven.add(await resolve("./files/" + timestamp + "_temp.7z"), filesPath, {
			$bin: pathTo7zip
		});
		downloadFilesStream.on('data', async function(data) {
			utils.log(data.file);
			await Bun.sleep(2);
		});
		downloadFilesStream.on('error', async function(data) {
			utils.log('test');
			utils.updateAction(logID, 1);
			r({'error': 2});
		});
		downloadFilesStream.on('end', async function(data) {
			utils.log('test1');
			utils.updateAction(logID, 1);
			setTimeout(() => {
				fs.unlink(resolve("./files/" + timestamp + "_temp.7z"), err => { if(err) utils.log(err, 2); });
			}, 300000);
			r(Bun.file(resolve("./files/" + timestamp + "_temp.7z")));
		});
	});
});
	
app.listen(process.env.PORT, async () => { utils.log(`Running on port ${app.server?.port}. Happy GDPS'ing!`) });