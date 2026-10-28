const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
for(const name of ['index.html','style.css','app.js','cloud.js','config.js'])fs.copyFileSync(path.join(root,name),path.join(out,name));
fs.cpSync(path.join(root,'vendor'),path.join(out,'vendor'),{recursive:true});
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log('Built static app in dist/');
