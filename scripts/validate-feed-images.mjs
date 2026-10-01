import fs from "node:fs/promises";

const FILES=["data/feed.json","data/feed-candidates.json","data/buzz.json","data/ticket-trends.json"];
const USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";
const cache=new Map();

async function imageIsValid(url){
  if(!url) return false;

  // Cineinsta-generated SVG data images are local/original and
  // do not require an external HTTP licence check.
  if(/^data:image\/svg\+xml;base64,/i.test(url)) return true;

  if(!/^https?:\/\//i.test(url)) return false;
  if(cache.has(url))return cache.get(url);

  const promise=(async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(url,{
        method:"GET",
        redirect:"follow",
        headers:{
          "User-Agent":USER_AGENT,
          Accept:"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        },
        signal:controller.signal
      });
      const contentType=(response.headers.get("content-type")||"").toLowerCase();
      return response.ok&&contentType.startsWith("image/");
    }catch{return false;}
    finally{clearTimeout(timer);}
  })();

  cache.set(url,promise);
  return promise;
}
  }
  console.log("Cineinsta image validation completed.");
}
main().catch(error=>{console.error(error);process.exit(1);});
