import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
for (const line of readFileSync("../.env","utf8").split("\n")){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const today='2026-07-05';
// 0. confirm default status of a fresh insert: count current pending rows
const { count: pendingNow } = await sb.from("post_mentions").select("*",{count:'exact',head:true}).eq("enrichment_status","pending");
console.log("post_mentions currently 'pending':", pendingNow);
// 1. upcoming events
const { data: ev } = await sb.from("events").select("id,name,start_date,is_active,whogoes_only").gte("start_date",today);
console.log("upcoming events (start_date>=today):", ev?.length);
const evMap=new Map((ev||[]).map(e=>[e.id,e]));
const evIds=[...evMap.keys()];
// 2. company-authored qualified posts on those events, with mentioned_profiles
const REJECT=new Set(['editorial_rejected','past_event_rejected','edition_mismatch_rejected','other_rejected']);
let posts=[];
for(let i=0;i<evIds.length;i+=50){
  const { data } = await sb.from("posts").select("id,event_id,post_type,mentioned_profiles").eq("author_type","company").in("event_id",evIds.slice(i,i+50)).not("mentioned_profiles","is",null);
  posts.push(...(data||[]));
}
// 3. for each, check expansion + tally
let totalPosts=0, missPosts=0, missProfiles=0, missWithUrl=0;
const perEventSend={eligible:{posts:0,profiles:0},noSend:{posts:0,profiles:0}};
const sampleEvents=new Map();
for(const p of posts){
  const mp=Array.isArray(p.mentioned_profiles)?p.mentioned_profiles:[];
  if(!mp.length || REJECT.has(p.post_type)) continue;
  totalPosts++;
  const { count } = await sb.from("post_mentions").select("*",{count:'exact',head:true}).eq("post_id",p.id);
  if(count>0) continue;
  missPosts++; missProfiles+=mp.length; missWithUrl+=mp.filter(m=>m.linkedin_url).length;
  const e=evMap.get(p.event_id);
  const willSend = e.is_active===true && e.whogoes_only===false;
  const b = willSend?perEventSend.eligible:perEventSend.noSend;
  b.posts++; b.profiles+=mp.length;
  const k=e.name+(willSend?" [SENDS]":"");
  sampleEvents.set(k,(sampleEvents.get(k)||0)+mp.length);
}
console.log(`\nUPCOMING company posts w/ mentions: ${totalPosts} | un-expanded (MISSING): ${missPosts}`);
console.log(`Lost mention profiles: ${missProfiles} (with linkedin_url: ${missWithUrl})`);
console.log(`\nSEND RISK split (if backfilled + live Phase 5 processes):`);
console.log(`  Would trigger OUTREACH (event is_active & !whogoes_only): ${perEventSend.eligible.posts} posts, ${perEventSend.eligible.profiles} profiles`);
console.log(`  Enrich-only, NO send: ${perEventSend.noSend.posts} posts, ${perEventSend.noSend.profiles} profiles`);
const top=[...sampleEvents.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log("\nTop events by lost mentions:"); for(const [k,v] of top) console.log(`  ${v.toString().padStart(4)}  ${k}`);
