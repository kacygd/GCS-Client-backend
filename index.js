import { utils } from "./utils/utils.js";
import { rename, mkdir, rm } from 'node:fs/promises';
import { resolve } from "path";
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';

const app = new Elysia({ serve: { maxRequestBodySize: 1024 * 1024 * 500 } });
app.use(cors());

app.get("/", async ({server, request, cookie: { token }}) => {
	const validatePerson = await utils.validatePerson(request, server, token.toString());
	if(!validatePerson) return new Response(await Bun.file(resolve("./pages/setToken.html")).bytes(), { headers: { "Content-Type": "text/html" }});
			
	return new Response(await Bun.file(resolve("./pages/index.html")).bytes(), { headers: { "Content-Type": "text/html" }});
});

app.post("/create/:updateType", async({ server, request, params: { updateType }, cookie: { token }, body: { file, version } }) => {
	const validatePerson = await utils.validatePerson(request, server, token.toString());
	if(!validatePerson) return new Response(Bun.file(resolve("./pages/setToken.html")), { headers: { "Content-Type": "text/html" }});

	const timestamp = await utils.timestamp();
	const updateFile = await file.arrayBuffer();

	if(updateType.toLowerCase() == 'temp') return Response.json({ success: false, cause: "Update type can't be TEMP" }, { status: 400 });

	const checkUpdatesCreating = await utils.checkUpdatesCreating(updateType);
	if(checkUpdatesCreating) return Response.json({ success: false, cause: "Wait until update is finished" }, { status: 400 });
				
	const updateFileType = await utils.getUpdateFileType(updateType);
	const updateVersion = updateFileType.endsWith('version') ? version : false;

	if(updateFileType.startsWith('file')) return await utils.createNewFileUpdate(updateFile, updateType, timestamp, updateVersion) // The update is file, Android GDPS APK file or Android launcher APK file
		.then(async () => {
			return Response.json({ success: true, cause: "Update is uploaded!" }, { status: 200 });
		})
		.catch(e => {
			return Response.json({ success: false, cause: "Invalid file" }, { status: 400 });
		});

	return await utils.createNewArchiveUpdate(await Buffer.from(updateFile), updateType, timestamp, updateVersion) // The update is archive, PC/Geode file
		.then(async () => {
			await Bun.write(resolve(`./files/TEMP/${updateType}/${timestamp}/archive.zip`), updateFile);

			return Response.json({ success: true, cause: "Update uploaded, wait 5-10 minutes" }, { status: 200 });
		})
		.catch(e => {
			return Response.json({ success: false, cause: "Invalid file" }, { status: 400 });
		});
});

app.get("/download/:updateType/:lastTimestamp", async ({params: { updateType, lastTimestamp }}) => {
	if(updateType == 'launcher') updateType = 'pc-launcher';
	
	const updateFileType = await utils.getUpdateFileType(updateType);
	if(updateFileType.startsWith('file')) return new Response(Bun.file(resolve(`./files/${updateType}.file`)));

	if(lastTimestamp == 0) return new Response(Bun.file(resolve(`./files/${updateType}/archive.zip`)));

	return new Response(Bun.file(resolve(`./patches/${updateType}/${lastTimestamp}/patches.zip`)));
});

app.route('OPTIONS', '/download/:updateType/:lastTimestamp', async ({params: { updateType, lastTimestamp }}) => {
	const updateFileType = await utils.getUpdateFileType(updateType);
	if(updateFileType.startsWith('file')) return new Response(await Bun.file(resolve(`./files/${updateType}.file`)).size);

	if(lastTimestamp == 0) return new Response(await Bun.file(resolve(`./files/${updateType}/archive.zip`)).size);

	return new Response(await Bun.file(resolve(`./patches/${updateType}/${lastTimestamp}/patches.zip`)).size);
});

app.get("/version/:updateType", async ({params: { updateType }}) => {
	const updateFileType = await utils.getUpdateFileType(updateType);
	if(updateFileType.endsWith('version')) return Response(await Bun.file(resolve(`./${updateType}-version`)).text());

	const lastTimestamp = await utils.getLastUpdateTimestamp(updateType);
	return Response.json({ timestamp: lastTimestamp?.timestamp ?? 0 }, { status: 200 });
});

app.get("/updates/:updateType/:lastTimestamp", async ({params: { updateType, lastTimestamp }}) => {
	const updateFileType = await utils.getUpdateFileType(updateType);
	if(updateFileType.startsWith('file')) {
		const getLastUpdateTimestamp = await utils.getLastUpdateTimestamp(updateType);
		return Response.json({ updates: getLastUpdateTimestamp.timestamp > lastTimestamp }, { status: 200 });
	}
				
	const newUpdates = await utils.getPatchUpdates(lastTimestamp, updateType);
	const newUpdatesTimestamps = [];
				
	for await (const timestamp of newUpdates) {
		newUpdatesTimestamps.push(timestamp.timestamp);
	}
				
	return Response.json({ updates: newUpdatesTimestamps }, { status: 200 });
});

// Backwards compatibility, so you could update launcher of old version
app.get("/launcher", async () => Response(await Bun.file(resolve(`./pc-launcher-version`)).text()))

app.get("/style.css", async () => Bun.file('pages/style.css'));

app.listen(process.env.PORT, async () => { utils.log(`Running on port ${app.server?.port}. Happy GDPS'ing!`) });

process.on("unhandledRejection", async (reason, promise) => {
	await utils.log(reason, 2);
});

process.on("uncaughtException", async (error) => {
	await utils.log(error.stack, 2);
});

// Converting old files to new format
const convert_oldPCVersionFile = Bun.file(resolve(`./launcher_version`));
if(await convert_oldPCVersionFile.exists()) {
	utils.log("Converting old GDPS updates format to new...");
	
	const convert_oldPCVersionFileNew = Bun.file(resolve(`./pc-launcher-version`));
	if(await convert_oldPCVersionFileNew.exists()) await rm(resolve(`./pc-launcher-version`), { recursive: true, force: true });
	
	await rename(resolve(`./files/last`), resolve(`./files/pc`));
	rename(resolve(`./files/files.json`), resolve(`./files/pc/files.json`));
	rename(resolve(`./files/latest.7z`), resolve(`./files/pc/archive.zip`));
	const convert_newUpdatesPC = await utils.getPatchUpdates(0, 'pc');
	
	utils.log(`PC patches: ${convert_newUpdatesPC.length}`);
	
	for(const timestamp of convert_newUpdatesPC) {
		await mkdir(resolve(`./patches/pc`), {recursive: true});
		
		await rename(resolve(`./patches/${timestamp.timestamp}`), resolve(`./patches/pc/${timestamp.timestamp}`));
		rename(resolve(`./patches/pc/${timestamp.timestamp}/patches.7z`), resolve(`./patches/pc/${timestamp.timestamp}/patches.zip`));
	}
	
	await rename(resolve(`./launcher_version`), resolve(`./pc-launcher-version`));
	await rename(resolve(`./files/launcher`), resolve(`./files/pc-launcher`));
	rename(resolve(`./files/launcher.json`), resolve(`./files/pc-launcher/files.json`));
	rename(resolve(`./files/launcher.7z`), resolve(`./files/pc-launcher/archive.zip`));
	const convert_newUpdatesLauncher = await utils.getPatchUpdates(0, 'pc-launcher');
	
	utils.log(`Launcher patches: ${convert_newUpdatesLauncher.length}`);

	for(const timestamp of convert_newUpdatesLauncher) {
		await mkdir(resolve(`./patches/pc-launcher`), {recursive: true});
		
		await rename(resolve(`./patches/${timestamp.timestamp}`), resolve(`./patches/pc-launcher/${timestamp.timestamp}`));
		rename(resolve(`./patches/pc-launcher/${timestamp.timestamp}/patches.7z`), resolve(`./patches/pc-launcher/${timestamp.timestamp}/patches.zip`));
	}
	
	utils.log("Finished converting old GDPS updates format to new!");
}

utils.finishAllUpdates();