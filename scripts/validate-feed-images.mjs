import fs from "node:fs/promises";

const FILES=["data/feed.json","data/feed-candidates.json","data/buzz.json","data/ticket-trends.json"];
const USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";
const cache=new Map();

async function imageIsValid(url){
  if(!url||!/^https?:\/\//i.test(url))return false;
  if(cache.has(url))return cache.get(url);
  const promise=(async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(url,{method:"GET",redirect:"follow",headers:{"User-Agent":USER_AGENT,Accept:"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"},signal:controller.signal});
      const contentType=(response.headers.get("content-type")||"").toLowerCase();
      return response.ok&&contentType.startsWith("image/");
    }catch{return false;}finally{clearTimeout(timer);}
  })();
  cache.set(url,promise);return promise;
}

async function mapConcurrent(items,worker,limit=6){
  const results=new Array(items.length);let next=0;
  async function run(){
    while(true){const i=next++;if(i>=items.length)return;results[i]=await worker(items[i],i);}
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));
  return results;
}

async function validateArray(items,label){
  if(!Array.isArray(items))return [];
  const results=await mapConcurrent(items,async item=>{
    if(!item||!item.img)return null;
    if(await imageIsValid(item.img))return item;
    console.log(`Removed unusable image from ${label}: ${item.title||item.movie||item.t||"untitled"}`);
    return null;
  },6);
  return results.filter(Boolean);
}

async function main(){
  for(const file of FILES){
    try{
      const raw=await fs.readFile(file,"utf8");
      const data=JSON.parse(raw);let changed=false;
      for(const key of ["news","reviews","trailers","buzz","movies"]){
        if(Array.isArray(data[key])){const before=data[key].length;data[key]=await validateArray(data[key],`${file} ${key}`);changed ||= before!==data[key].length;}
      }
      if(changed)await fs.writeFile(file,JSON.stringify(data,null,2)+"\n","utf8");
    }catch(error){
      if(error.code==="ENOENT")console.log(`Skipping missing optional file: ${file}`);else throw error;
    }
  }
  console.log("Cineinsta image validation completed.");
}
main().catch(error=>{console.error(error);process.exit(1);});
