import { Elysia, t } from 'elysia';
import utils from './utils/utils.js';
import hdiffpatch from './utils/hdiffpatch.js';
const { resolve, dirname } = require("path");
import Seven from 'node-7z';
import sevenBin from '7zip-bin';
const { Readable } = require("stream");
import fs from 'fs';

const app = new Elysia({
	serve: {
		maxRequestBodySize: Number.MAX_SAFE_INTEGER,
	}
})
.get('/', (c) => {
	utils.log(utils.getUpdates(1731523591));
	return Bun.file('pages/index.html');
})
.post('/', async function(c) {
	const timestamp = utils.timestamp();
	const pathTo7zip = sevenBin.path7za;
	const lastUpdate = utils.getUpdates(1731523591)[0].timestamp;
	await Bun.write(resolve("./files/" + timestamp + ".7z"), c.body.file);
	try {
		var extractedFiles = [];
		const myStream = Seven.extractFull(resolve("./files/" + timestamp + ".7z"), resolve("./files/" + timestamp), {
		  $progress: true,
		  $bin: pathTo7zip
		});
		fs.mkdir(resolve("./patches/" + timestamp), err => { if(err) utils.log(err, 2); });
		myStream.on('data', async function (data) {
			utils.log("File: " + data.file);
			if(data.file.indexOf('.') > -1) extractedFiles.push(data.file);
		});
		myStream.on('end', async function () {
			utils.log("Unzipping done!!! :3 Making patch files now. :trollface:");
			await fs.unlink(resolve("./files/" + timestamp + ".7z"), err => { if(err) utils.log(err, 2); });
			await fs.unlink(resolve("./files/" + lastUpdate + ".7z"), err => { if(err) utils.log(err, 2); });
			var oldFilePath = resolve("./files/" + lastUpdate + "/" + extractedFiles[extractedFiles.length - 1]);
			var oldFile = Bun.file(oldFilePath);
			const oldFileExists = await oldFile.exists();
			var patchedFiles = [];
			if(oldFileExists) {
				var newFilePath = '';
				var patchFile = '';
				var i = 0;
				for(i = 0; i < extractedFiles.length; i++) {
					oldFilePath = resolve("./files/" + lastUpdate + "/" + extractedFiles[i])
					newFilePath = resolve("./files/" + timestamp + "/" + extractedFiles[i]);
					patchFile = resolve("./patches/" + timestamp + "/" + extractedFiles[i] + ".patch");
					fs.mkdir(dirname(patchFile), { recursive: true }, err => { if(err) utils.log(err, 2); });
					utils.log("Making patch file for: " + extractedFiles[i]);
					var diffValue = await hdiffpatch.diff(oldFilePath, newFilePath, patchFile);
					if(diffValue) patchedFiles.push(extractedFiles[i]);
				}
			}
			console.log(patchedFiles);
			if(patchedFiles.length > 0) {
				i = 0;
				var filePath = '';
				for(i = 0; i < patchedFiles.length; i++) {
					filePath = resolve("./files/" + lastUpdate + "/" + patchedFiles[i])
					patchFile = resolve("./patches/" + timestamp + "/" + patchedFiles[i] + ".patch");
					fs.mkdir(dirname(patchFile), { recursive: true }, err => { if(err) utils.log(err, 2); });
					utils.log("Patching file: " + patchedFiles[i]);
					await hdiffpatch.patch(filePath, patchFile, filePath + "_new");
					await fs.unlink(filePath, err => { if(err) utils.log(err, 2); });
					await fs.rename(filePath + "_new", filePath, err => { if(err) utils.log(err, 2); });
				}
			} 
			utils.log("Everything is done!!!!! yaaay");
			utils.newUpdate(timestamp);
			removeRemnants(timestamp, lastUpdate);
			utils.log("check");
		});
	} catch(e) {
		utils.log(e, 2);
		return 'Error while unzipping';
	}
	return 'File uploaded AZAZA';
}, {
  body: t.Object({
    file: t.File()
  })
})
.listen(process.env.PORT);

console.log(`🦊 Elysia is running at on port ${app.server?.port}...`)

async function removeRemnants(timestamp, lastUpdate) {
	await Bun.sleep(2000);
	await fs.unlink(resolve("./files/" + timestamp), err => { if(err) utils.log(err, 2); });
	await Bun.sleep(2000);
	await fs.rename(resolve("./files/" + lastUpdate), resolve("./files/" + timestamp), err => { if(err) utils.log(err, 2); });
}