// Run the app's testDocParserRegressions() logic against the REAL parser.
// Since the P2 module split, testDocParserRegressions lives in
// js/doc-import-templates.js (it moved with the DoC import/test hooks), no
// longer inline in index.html. We source it from that module file — brace-
// matching the single, self-contained function (its only free variable is
// parseDocPost) and eval'ing it in a vm sandbox, mirroring parser-loader's
// synchronous vm-eval pattern (no more index.html <script> scraping).
const fs=require('fs'),path=require('path'),vm=require('vm');
const {JSDOM}=require('jsdom');
const {buildParser,REPO}=require('./parser-loader');
const api=buildParser();
const src=fs.readFileSync(path.join(REPO,'js','doc-import-templates.js'),'utf8');
function extractFn(name){const re=new RegExp('function '+name+'\\s*\\(');const s=src.search(re);if(s===-1)throw new Error('not found '+name);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;else if(src[i]==='}'){d--;if(d===0){i++;break;}}}return src.slice(s,i);}
const win=new JSDOM('<!doctype html><body></body>').window;
const sandbox={DOMParser:win.DOMParser,console,parseDocPost:api.parseDocPost};sandbox.global=sandbox;vm.createContext(sandbox);
vm.runInContext(extractFn('testDocParserRegressions')+'\nglobal.__run=testDocParserRegressions;',sandbox);
const r=sandbox.__run();
process.exit(r.fail?1:0);
