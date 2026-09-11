// Compare large cover decoding with bounded thumbnails in fresh Electron processes.
// Run on Windows: node scripts/benchmark-covers.cjs
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = path.resolve(__dirname, '../.cache/cover-memory');
if (!process.versions.electron) {
  (async()=>{
    const sharp = require('sharp'); sharp.cache(false); sharp.concurrency(1);
    fs.mkdirSync(dir,{recursive:true});
    for(let i=0;i<20;i++) {
      const original=await sharp(Buffer.from(`<svg width="3000" height="3000"><defs><linearGradient id="g"><stop stop-color="hsl(${i*17},60%,45%)"/><stop offset="1" stop-color="hsl(${i*17+70},80%,60%)"/></linearGradient></defs><rect width="3000" height="3000" fill="url(#g)"/><circle cx="1500" cy="1500" r="900" fill="none" stroke="white" stroke-width="100"/></svg>`)).png().toBuffer();
      fs.writeFileSync(path.join(dir,`${i}.png`),original);
      await sharp(original).resize(320,320).webp({quality:90}).toFile(path.join(dir,`${i}.webp`));
    }
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    for(const mode of ['original','thumbnail']) {
      const result=spawnSync(require('electron'),[__filename,mode],{env,windowsHide:true,encoding:'utf8',timeout:60000});
      if(result.status!==0)throw new Error(result.stderr || result.error?.message);
      console.log(result.stdout.trim());
    }
  })().catch(e=>{console.error(e);process.exitCode=1});
} else {
  const {app,BrowserWindow}=require('electron');
  const mode=process.argv[2];
  app.setPath('userData',path.join(dir,mode));
  app.whenReady().then(async()=>{
    const window=new BrowserWindow({width:800,height:650,show:false,webPreferences:{backgroundThrottling:false}});
    const extension=mode==='original'?'png':'webp';
    const html=`<style>body{display:grid;grid-template-columns:repeat(5,128px);gap:4px}img{width:128px;height:128px}</style>`+Array.from({length:20},(_,i)=>`<img src="${i}.${extension}">`).join('');
    const file=path.join(dir,`${mode}.html`);fs.writeFileSync(file,html);
    await window.loadFile(file);
    await window.webContents.executeJavaScript('Promise.all([...document.images].map(i=>i.decode()))');
    await window.webContents.capturePage();
    await new Promise(r=>setTimeout(r,1000));
    const metrics=app.getAppMetrics().map(p=>({type:p.type,privateKiB:p.memory.privateBytes,workingSetKiB:p.memory.workingSetSize}));
    const result={mode,metrics,privateMiB:metrics.reduce((n,p)=>n+p.privateKiB,0)/1024};
    fs.writeFileSync(path.join(dir,`${mode}.json`),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));app.quit();
  });
}
