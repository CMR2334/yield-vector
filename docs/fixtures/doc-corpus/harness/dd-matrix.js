const {buildParser}=require('./parser-loader');
const api=buildParser();
const cases=[
  ['Yes',true],['No',false],['Required',true],['Not required',false],['None required',false],
  ['No, not required',false],['Yes, no minimum mentioned',true],['Yes, $500',true],
  ['Yes, $500 OR ACH deposit',true],['Not required, but recommended',false],['None',false],
  ['No direct deposit',false],['Yes, direct deposit of $250+',true],['Not needed',false],
  ['No minimum',false],['Yes (no minimum)',true],['direct deposit needed',true],
];
let bad=0;
for(const [v,want] of cases){
  const html=`<article><p><strong>Offer at a glance</strong></p><ul><li>Direct deposit required: ${v}</li><li>Maximum bonus amount: $300</li></ul></article>`;
  const r=api.parseDocPost(html); const got=r.fields.ddRequired?r.fields.ddRequired.value:undefined;
  const ok=got===want; if(!ok)bad++;
  console.log(`  ${ok?'OK ':'XX '} "${v}" → ${got} (want ${want})`);
}
console.log(bad?`\n${bad} DD MISMATCH`:'\nDD MATRIX ALL PASS');
process.exit(bad?1:0);
