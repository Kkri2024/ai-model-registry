import { readFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { validateCatalog } from '../modelRegistry.js';
validateCatalog(JSON.parse(await readFile('models.json','utf8')));
await rm('dist',{recursive:true,force:true});
await mkdir('dist');
for(const file of ['models.json','_headers','index.html']) await copyFile(file,'dist/'+file);
