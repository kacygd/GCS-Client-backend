const { resolve } = require("path");
const util = require('util');
const exec = util.promisify(require('child_process').execFile);
const hdiffpatch = [];
/*
	hdiffpatch.path()
	Get platform-specific hdiffpatch path
	
	Return: Dictionary:
		hdiffz — absolute path for hdiffz
		hpatchz — absolute path for hpatchz
*/
hdiffpatch.path = function() {
	const platforms = {win32: 'windows', linux: 'linux'};
	const architectures = {x64: '64', arm64: '_arm64'};
	return {
		hdiffz: resolve(import.meta.dir + "/../lib/hdiffpatch/" + platforms[process.platform] + architectures[process.arch] + "/hdiffz" + (process.platform == 'win32' ? ".exe" : "")),
		hpatchz: resolve(import.meta.dir + "/../lib/hdiffpatch/" + platforms[process.platform] + architectures[process.arch] + "/hpatchz" + (process.platform == 'win32' ? ".exe" : ""))
	};
}
/*
	hdiffpatch.diff(originalFile, targetFile, patchFile)
	Generate patch file out of old and new files
	
	originalFile — path for original file
	targetFile — path for target file
	patchFile — path for generating patch file
	
	Return: stdout of hdiffz
*/
hdiffpatch.diff = function(originalFile, targetFile, patchFile) {
	return new Promise(async function(r) {
		const hdiff = hdiffpatch.path()['hdiffz'];
		const args = [originalFile, targetFile, patchFile];
		exec(hdiff, args).then(result => {
			r(result);
		});
	});
}
/*
	hdiffpatch.patch(originalFile, patchFile, newFile)
	Patch old file with patch file
	
	originalFile — path for original file
	patchFile — path for patch file
	newFile — path for new file
	
	Return: stdout of hpatchz
*/
hdiffpatch.patch = function(originalFile, patchFile, newFile) {
	return new Promise(async function(r) {
		const hpatch = hdiffpatch.path()['hpatchz'];
		const args = [originalFile, patchFile, newFile];
		exec(hpatch, args).then(result => {
			r(result);
		});
	});
}

export { hdiffpatch };