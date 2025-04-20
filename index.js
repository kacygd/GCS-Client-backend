import { utils } from "./utils/utils.js";
import { rename, mkdir, rm, readFile, writeFile, stat, existsSync } from 'node:fs/promises';
import { resolve } from "path";
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';

const app = new Elysia({ serve: { maxRequestBodySize: 1024 * 1024 * 500 } });
app.use(cors());

app.get("/", async ({ server, request, cookie: { token } }) => {
    try {
        console.log("Processing GET / request...");
        const validatePerson = await utils.validatePerson(request, server, token.toString());
        if (!validatePerson) {
            console.log("Validation failed, serving setToken.html");
            const setTokenPath = resolve("./pages/setToken.html");
            if (!existsSync(setTokenPath)) {
                console.error("setToken.html not found");
                return new Response("setToken.html not found", { status: 500 });
            }
            return new Response(await readFile(setTokenPath), { headers: { "Content-Type": "text/html" } });
        }

        console.log("Validation passed, serving index.html");
        const indexPath = resolve("./pages/index.html");
        if (!existsSync(indexPath)) {
            console.error("index.html not found");
            return new Response("index.html not found", { status: 500 });
        }
        return new Response(await readFile(indexPath), { headers: { "Content-Type": "text/html" } });
    } catch (error) {
        console.error("Error in GET /:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});

app.post("/create/:updateType", async ({ server, request, params: { updateType }, cookie: { token }, body: { file, version } }) => {
    try {
        console.log("Processing POST /create/:updateType request...");
        const validatePerson = await utils.validatePerson(request, server, token.toString());
        if (!validatePerson) {
            console.log("Validation failed, serving setToken.html");
            const setTokenPath = resolve("./pages/setToken.html");
            if (!existsSync(setTokenPath)) {
                console.error("setToken.html not found");
                return new Response("setToken.html not found", { status: 500 });
            }
            return new Response(await readFile(setTokenPath), { headers: { "Content-Type": "text/html" } });
        }

        const timestamp = await utils.timestamp();
        const updateFile = await file.arrayBuffer();

        if (updateType.toLowerCase() == 'temp') return Response.json({ success: false, cause: "Update type can't be TEMP" }, { status: 400 });

        const checkUpdatesCreating = await utils.checkUpdatesCreating(updateType);
        if (checkUpdatesCreating) return Response.json({ success: false, cause: "Wait until update is finished" }, { status: 400 });

        const updateFileType = await utils.getUpdateFileType(updateType);
        const updateVersion = updateFileType.endsWith('version') ? version : false;

        if (updateFileType.startsWith('file')) return await utils.createNewFileUpdate(updateFile, updateType, timestamp, updateVersion)
            .then(async () => {
                return Response.json({ success: true, cause: "Update is uploaded!" }, { status: 200 });
            })
            .catch(e => {
                console.error("Error in createNewFileUpdate:", e);
                return Response.json({ success: false, cause: "Invalid file" }, { status: 400 });
            });

        return await utils.createNewArchiveUpdate(await Buffer.from(updateFile), updateType, timestamp, updateVersion)
            .then(async () => {
                await writeFile(resolve(`./files/TEMP/${updateType}/${timestamp}/archive.zip`), Buffer.from(updateFile));
                return Response.json({ success: true, cause: "Update uploaded, wait 5-10 minutes" }, { status: 200 });
            })
            .catch(e => {
                console.error("Error in createNewArchiveUpdate:", e);
                return Response.json({ success: false, cause: "Invalid file" }, { status: 400 });
            });
    } catch (error) {
        console.error("Error in POST /create/:updateType:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});

app.get("/download/:updateType/:lastTimestamp", async ({ params: { updateType, lastTimestamp } }) => {
    try {
        console.log(`Processing GET /download/${updateType}/${lastTimestamp} request...`);
        if (updateType == 'launcher') updateType = 'pc-launcher';

        const updateFileType = await utils.getUpdateFileType(updateType);
        const filePath = updateFileType.startsWith('file')
            ? resolve(`./files/${updateType}.file`)
            : lastTimestamp == 0
            ? resolve(`./files/${updateType}/archive.zip`)
            : resolve(`./patches/${updateType}/${lastTimestamp}/patches.zip`);

        if (!existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            return new Response("File not found", { status: 404 });
        }

        return new Response(await readFile(filePath));
    } catch (error) {
        console.error("Error in GET /download/:updateType/:lastTimestamp:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});

app.route('OPTIONS', '/download/:updateType/:lastTimestamp', async ({ params: { updateType, lastTimestamp } }) => {
    try {
        console.log(`Processing OPTIONS /download/${updateType}/${lastTimestamp} request...`);
        const updateFileType = await utils.getUpdateFileType(updateType);
        const filePath = updateFileType.startsWith('file')
            ? resolve(`./files/${updateType}.file`)
            : lastTimestamp == 0
            ? resolve(`./files/${updateType}/archive.zip`)
            : resolve(`./patches/${updateType}/${lastTimestamp}/patches.zip`);

        if (!existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            return new Response("File not found", { status: 404 });
        }

        const fileStats = await stat(filePath);
        return new Response(fileStats.size.toString());
    } catch (error) {
        console.error("Error in OPTIONS /download/:updateType/:lastTimestamp:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});

app.get("/version/:updateType", async ({ params: { updateType } }) => {
    try {
        console.log(`Processing GET /version/${updateType} request...`);
        const updateFileType = await utils.getUpdateFileType(updateType);
        if (updateFileType.endsWith('version')) {
            const filePath = resolve(`./${updateType}-version`);
            if (!existsSync(filePath)) {
                console.error(`File not found: ${filePath}`);
                return new Response("File not found", { status: 404 });
            }
            return new Response(await readFile(filePath, 'utf8'));
        }

        const lastTimestamp = await utils.getLastUpdateTimestamp(updateType);
        return Response.json({ timestamp: lastTimestamp?.timestamp ?? 0 }, { status: 200 });
    } catch (error) {
        console.error("Error in GET /version/:updateType:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});

app.get("/updates/:updateType/:lastTimestamp", async ({ params: { updateType, lastTimestamp } }) => {
    try {
        console.log(`Processing GET /updates/${updateType}/${lastTimestamp} request...`);
        const updateFileType = await utils.getUpdateFileType(updateType);
        if (updateFileType.startsWith('file')) {
            const getLastUpdateTimestamp = await utils.getLastUpdateTimestamp(updateType);
            return Response.json({ updates: getLastUpdateTimestamp.timestamp > lastTimestamp }, { status: 200 });
        }

        const newUpdates = await utils.getPatchUpdates(lastTimestamp, updateType);
        const newUpdatesTimestamps = [];

        for await (const timestamp of newUpdates) {
            newUpdatesTimestamps.push(timestamp.timestamp);
        }

        return Response.json({ updates: newUpdatesTimestamps }, { status: 200 });
    } catch (error) {
        console.error("Error in GET /updates/:updateType/:lastTimestamp:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});

app.get("/launcher", async () => {
    try {
        console.log("Processing GET /launcher request...");
        const filePath = resolve(`./pc-launcher-version`);
        if (!existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            return new Response("File not found", { status: 404 });
        }
        return new Response(await readFile(filePath, 'utf8'));
    } catch (error) {
        console.error("Error in GET /launcher:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});

app.get("/style.css", async () => {
    try {
        console.log("Processing GET /style.css request...");
        const filePath = resolve('pages/style.css');
        if (!existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            return new Response("File not found", { status: 404 });
        }
        return new Response(await readFile(filePath));
    } catch (error) {
        console.error("Error in GET /style.css:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});

// Xuất hàm serverless cho Vercel
export const handler = async (req) => {
    return app.fetch(req);
};

// Xử lý lỗi
process.on("unhandledRejection", async (reason, promise) => {
    console.error("Unhandled Rejection:", reason);
    await utils.log(reason, 2);
});

process.on("uncaughtException", async (error) => {
    console.error("Uncaught Exception:", error.stack);
    await utils.log(error.stack, 2);
});

// Converting old files to new format
const convert_oldPCVersionPath = resolve(`./launcher_version`);
const convert_oldPCVersionFileExists = await (async () => {
    try {
        await stat(convert_oldPCVersionPath);
        return true;
    } catch {
        return false;
    }
})();

if (convert_oldPCVersionFileExists) {
    console.log("Converting old GDPS updates format to new...");
    utils.log("Converting old GDPS updates format to new...");

    const convert_oldPCVersionFileNewPath = resolve(`./pc-launcher-version`);
    const convert_oldPCVersionFileNewExists = await (async () => {
        try {
            await stat(convert_oldPCVersionFileNewPath);
            return true;
        } catch {
            return false;
        }
    })();

    if (convert_oldPCVersionFileNewExists) await rm(convert_oldPCVersionFileNewPath, { recursive: true, force: true });

    await rename(resolve(`./files/last`), resolve(`./files/pc`));
    await rename(resolve(`./files/files.json`), resolve(`./files/pc/files.json`));
    await rename(resolve(`./files/latest.7z`), resolve(`./files/pc/archive.zip`));
    const convert_newUpdatesPC = await utils.getPatchUpdates(0, 'pc');

    console.log(`PC patches: ${convert_newUpdatesPC.length}`);
    utils.log(`PC patches: ${convert_newUpdatesPC.length}`);

    for (const timestamp of convert_newUpdatesPC) {
        await mkdir(resolve(`./patches/pc`), { recursive: true });

        await rename(resolve(`./patches/${timestamp.timestamp}`), resolve(`./patches/pc/${timestamp.timestamp}`));
        await rename(resolve(`./patches/pc/${timestamp.timestamp}/patches.7z`), resolve(`./patches/pc/${timestamp.timestamp}/patches.zip`));
    }

    await rename(resolve(`./launcher_version`), resolve(`./pc-launcher-version`));
    await rename(resolve(`./files/launcher`), resolve(`./files/pc-launcher`));
    await rename(resolve(`./files/launcher.json`), resolve(`./files/pc-launcher/files.json`));
    await rename(resolve(`./files/launcher.7z`), resolve(`./files/pc-launcher/archive.zip`));
    const convert_newUpdatesLauncher = await utils.getPatchUpdates(0, 'pc-launcher');

    console.log(`Launcher patches: ${convert_newUpdatesLauncher.length}`);
    utils.log(`Launcher patches: ${convert_newUpdatesLauncher.length}`);

    for (const timestamp of convert_newUpdatesLauncher) {
        await mkdir(resolve(`./patches/pc-launcher`), { recursive: true });

        await rename(resolve(`./patches/${timestamp.timestamp}`), resolve(`./patches/pc-launcher/${timestamp.timestamp}`));
        await rename(resolve(`./patches/pc-launcher/${timestamp.timestamp}/patches.7z`), resolve(`./patches/pc-launcher/${timestamp.timestamp}/patches.zip`));
    }

    console.log("Finished converting old GDPS updates format to new!");
    utils.log("Finished converting old GDPS updates format to new!");
}

utils.finishAllUpdates();
