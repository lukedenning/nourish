const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
for(const name of ['index.html','style.css','app.js','cloud.js','config.js'])fs.copyFileSync(path.join(root,name),path.join(out,name));
fs.cpSync(path.join(root,'vendor'),path.join(out,'vendor'),{recursive:true});
fs.cpSync(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
// Content hashes keep returning devices from reusing an older app or stylesheet.
const indexPath=path.join(out,'index.html');
const html=fs.readFileSync(indexPath,'utf8').replace(/(href|src)="([^"]+\.(?:css|js|png|svg))"/g,(match,attribute,file)=>{
  const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex').slice(0,16);
  return `${attribute}="${file}?v=${hash}"`;
});
fs.writeFileSync(indexPath,html);
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log('Built static app in dist/');
