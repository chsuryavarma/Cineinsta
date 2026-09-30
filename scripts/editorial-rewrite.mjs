    import fs from "node:fs/promises";

    const MODEL = "gemini-3.5-flash-lite";
    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";

    function decode(text = "") {
      return String(text).replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&#8217;/gi,"'").replace(/&#8216;/gi,"'").replace(/&#8220;/gi,'"').replace(/&#8221;/gi,'"').replace(/&#8211;/gi,"-").replace(/&#8212;/gi,"-").replace(/&#8230;/gi,"...").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g," ").trim();
    }
    function stripHtml(html="") {
      return decode(String(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<noscript[\s\S]*?<\/noscript>/gi," ").replace(/<svg[\s\S]*?<\/svg>/gi," ").replace(/<[^>]+>/g," "));
    }
    function meta(html,name){
      const p=[new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`,"i"),new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["']`,"i"),new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,"i"),new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`,"i")];
      for(const x of p){const m=html.match(x);if(m?.[1])return decode(m[1]);} return "";
    }
    function extractBody(html="") {
      const candidates=[];
      for(const m of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) candidates.push(stripHtml(m[1]||""));
      for(const m of html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)) candidates.push(stripHtml(m[1]||""));
      const ps=[...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>stripHtml(m[1]||"")).filter(x=>x.length>=45&&!/^(advertisement|read more|subscribe|follow us|share|home|menu)$/i.test(x));
      if(ps.length)candidates.push(ps.join(" "));
      return candidates.sort((a,b)=>b.length-a.length)[0]?.slice(0,9000)||"";
    }
    async function fetchText(url){const r=await fetch(url,{headers:{"User-Agent":USER_AGENT,Accept:"text/html,application/xhtml+xml"}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();}
    function jsonFrom(text){const t=String(text).replace(/^\s*```json\s*/i,"").replace(/\s*```\s*$/i,"").trim();try{return JSON.parse(t)}catch{}const a=t.indexOf("{"),b=t.lastIndexOf("}");return a>=0&&b>a?JSON.parse(t.slice(a,b+1)):null;}
    async function gemini(prompt){
      if(!process.env.GEMINI_API_KEY)throw new Error("GEMINI_API_KEY is missing");
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:"You are Cineinsta's original cinema news editor. Return JSON only."}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.2,responseMimeType:"application/json"}})});
      if(!r.ok)throw new Error(`Gemini HTTP ${r.status}: ${(await r.text()).slice(0,500)}`);
      const d=await r.json(); const t=(d?.candidates?.[0]?.content?.parts||[]).map(x=>x?.text||"").join(""); return jsonFrom(t);
    }
    async function main(){
      const path="data/feed.json"; const feed=JSON.parse(await fs.readFile(path,"utf8"));
      if(!Array.isArray(feed.news))throw new Error("data/feed.json has no news array");
      for(let i=0;i<feed.news.length;i++){
        const item=feed.news[i];
        if(!item?.url){console.log(`SKIP ${i+1}: no URL`);continue;}
        try{
          const html=await fetchText(item.url); const sourceText=extractBody(html);
          if(sourceText.length<250){console.log(`SKIP ${i+1}: insufficient source text`);continue;}
          const prompt=`You are writing for Cineinsta, an Indian cinema news website. Rewrite the supplied source facts into a fully original article. Preserve only facts supported by the source text. Do not copy sentences, paragraph order, or distinctive wording. Do not invent facts, quotes, numbers, dates, motives or details. Do not mention the source publisher or tell readers to read the original. Write 5-10 paragraphs, roughly 350-1000 words. Also provide a short 2-3 sentence homepage summary and a clean Cineinsta headline. Return JSON only in this exact shape: {"title":"...","summary":"...","body":["paragraph 1","paragraph 2"]}.\n\nCURRENT CINEINSTA HEADLINE: ${item.title}\nCURRENT SUMMARY: ${item.summary}\nSOURCE ARTICLE TEXT:\n${sourceText}`;
          const out=await gemini(prompt);
          if(!out||!Array.isArray(out.body)||out.body.length<5)throw new Error("No complete body returned");
          item.title=String(out.title||item.title).trim();
          item.summary=String(out.summary||item.summary).trim();
          item.body=out.body.map(x=>String(x).trim()).filter(Boolean);
          item.editorial="Cineinsta";
          item.keyFacts=[];
          item.cineinstaContext="";
          console.log(`UPDATED ${i+1}: ${item.title} (${item.body.length} paragraphs)`);
        }catch(e){console.log(`SKIP ${i+1}: ${e.message}`);}
      }
      feed.updatedAt=new Date().toISOString();
      await fs.writeFile(path,JSON.stringify(feed,null,2)+"\n","utf8");
    }
    main().catch(e=>{console.error(e);process.exit(1)});
