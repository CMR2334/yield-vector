// Run the app's testDocParserRegressions() logic against the REAL parser.
const fs=require('fs'),path=require('path'),vm=require('vm');
const {JSDOM}=require('jsdom');
const {buildParser,REPO}=require('./parser-loader');
const api=buildParser();
const html=fs.readFileSync(path.join(REPO,'index.html'),'utf8');
const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).reduce((a,b)=>a.length>b.length?a:b,'');
function extractFn(name){const re=new RegExp('function '+name+'\\s*\\(');const s=script.search(re);if(s===-1)throw new Error('not found '+name);let i=script.indexOf('{',s),d=0;for(;i<script.length;i++){if(script[i]==='{')d++;else if(script[i]==='}'){d--;if(d===0){i++;break;}}}return script.slice(s,i);}
const win=new JSDOM('<!doctype html><body></body>').window;
const sandbox={DOMParser:win.DOMParser,console,parseDocPost:api.parseDocPost};sandbox.global=sandbox;vm.createContext(sandbox);
vm.runInContext(extractFn('testDocParserRegressions')+'\nglobal.__run=testDocParserRegressions;',sandbox);
const r=sandbox.__run();
process.exit(r.fail?1:0);
