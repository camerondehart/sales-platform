// Bundle pricing check: 3,000 random carts. For each cart it confirms that
//  - the bundle savings equal the true best combination (brute force),
//  - savings never exceed the cart or go negative,
//  - with no bundles, the result is exactly the old BOGO + "buy N" maths.
// Run: node tests/unit/bundle-pricing.cjs
const path = require("path"), fs = require("fs"), os = require("os");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-"));
for (const f of ["pricing", "bundles"]) {
  const src = fs.readFileSync(path.join(repo, "lib", `${f}.ts`), "utf8");
  fs.writeFileSync(path.join(dir, `${f}.js`), ts.transpileModule(src, { compilerOptions: { module: 1, target: 7 } }).outputText.replace('"./pricing"', '"./pricing.js"'));
}
const { priceCart } = require(path.join(dir, "bundles.js"));
const P = ["a","b","c","d","e"].map((id,i)=>({id, price:`$${10+i*7}`, ...(i==2?{salePrice:"$15"}:{}), ...(i==3?{promo:{type:"bogo",percent:50}}:{})}));
let rnd=1; const R=()=>{rnd=(rnd*1103515245+12345)%2147483648; return rnd/2147483648;};
let bad=0, n=0;
for (let t=0;t<3000;t++){
  const bundles=[]; const nb=1+Math.floor(R()*4);
  for(let k=0;k<nb;k++){ const ids=P.filter(()=>R()<0.5).map(p=>({productId:p.id,qty:1+Math.floor(R()*2)})); if(ids.length<2) continue;
    bundles.push({id:"b"+k,name:"B"+k,items:ids,type:R()<0.5?"percent":"price",value:R()<0.5?Math.ceil(R()*50):Math.ceil(R()*60),active:true,createdAt:k,updatedAt:k}); }
  const lines=P.filter(()=>R()<0.8).map(p=>({product:p,quantity:1+Math.floor(R()*4)}));
  const rule={enabled:R()<0.5,minItems:3,percent:10};
  const r=priceCart(lines,bundles,rule); n++;
  // brute force optimum of bundle savings
  const unit=id=>parseFloat((P.find(p=>p.id===id).salePrice||P.find(p=>p.id===id).price).slice(1));
  const have={}; lines.forEach(l=>have[l.product.id]=(have[l.product.id]||0)+l.quantity);
  const per=bundles.map(b=>{const c=b.items.reduce((s,i)=>s+unit(i.productId)*i.qty,0); return b.type==="percent"?Math.round(c*b.value)/100:Math.max(0,Math.round((c-b.value)*100)/100);});
  let best=0; const rec=(k,left,tot)=>{ if(k===bundles.length){best=Math.max(best,tot);return;} const b=bundles[k]; let m=Math.min(...b.items.map(i=>Math.floor((left[i.productId]||0)/i.qty))); for(let s=0;s<=m;s++){const L={...left}; b.items.forEach(i=>L[i.productId]-=i.qty*s); rec(k+1,L,tot+per[k]*s);} };
  rec(0,have,0);
  const sub=lines.reduce((s,l)=>s+unit(l.product.id)*l.quantity,0);
  if (Math.abs(best-r.bundleSavings)>0.011 || r.discount>sub+1e-9 || r.discount<0) { bad++; if(bad<4) console.log("MISMATCH",best,r.bundleSavings,JSON.stringify(bundles),JSON.stringify(lines.map(l=>[l.product.id,l.quantity]))); }
  // parity without bundles
  const r0=priceCart(lines,[],rule);
  let promo=0; lines.forEach(l=>{ if(l.product.promo) promo+=Math.round(Math.floor(l.quantity/2)*unit(l.product.id)*0.5*100)/100; });
  promo=Math.round(promo*100)/100; const cnt=lines.reduce((s,l)=>s+l.quantity,0);
  const old=Math.round((promo+(rule.enabled&&cnt>=3?Math.round((sub-promo)*0.1*100)/100:0))*100)/100;
  if (Math.abs(old-r0.discount)>1e-9){bad++; console.log("PARITY",old,r0.discount);}
}
console.log(`${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
