const fs = require("fs");
function load(f){if(!fs.existsSync(f))return; for(const line of fs.readFileSync(f,"utf8").split(/\r?\n/)){const m=line.match(/^([A-Za-z0-9_]+)=(.*)$/); if(!m)continue; let v=m[2]; if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); if(!(m[1] in process.env)) process.env[m[1]]=v;}}
load(".env.local"); load(".env");
const propertyId = process.env.GA4_PROPERTY_ID || "289575590";
async function token(){const body=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_REFRESH_TOKEN,grant_type:"refresh_token"});const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",body});const json=await res.json();if(!json.access_token)throw new Error(JSON.stringify(json));return json.access_token;}
async function runReport(accessToken,body){const res=await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const json=await res.json();if(!res.ok)throw new Error(JSON.stringify(json).slice(0,600));return json;}
function rows(report){return (report.rows||[]).map(r=>({dims:(r.dimensionValues||[]).map(d=>d.value),mets:(r.metricValues||[]).map(m=>Number(m.value)||0)}));}
const unassignedFilter={filter:{fieldName:"sessionDefaultChannelGroup",stringFilter:{matchType:"EXACT",value:"Unassigned"}}};
const dateRanges=[{startDate:"28daysAgo",endDate:"yesterday"}];
(async()=>{
  const accessToken=await token();
  const out={};
  // Spike window only
  const spikeRanges=[{startDate:"2026-08-19",endDate:"2026-08-22"}];
  const spikeFilter=unassignedFilter;

  out.spikeByCity=rows(await runReport(accessToken,{dateRanges:spikeRanges,dimensions:[{name:"city"},{name:"country"}],metrics:[{name:"sessions"},{name:"engagedSessions"}],dimensionFilter:spikeFilter,orderBys:[{metric:{metricName:"sessions"},desc:true}],limit:25}));
  out.spikeByBrowser=rows(await runReport(accessToken,{dateRanges:spikeRanges,dimensions:[{name:"browser"}],metrics:[{name:"sessions"},{name:"engagedSessions"}],dimensionFilter:spikeFilter,orderBys:[{metric:{metricName:"sessions"},desc:true}],limit:15}));
  out.spikeByOs=rows(await runReport(accessToken,{dateRanges:spikeRanges,dimensions:[{name:"operatingSystem"}],metrics:[{name:"sessions"},{name:"engagedSessions"}],dimensionFilter:spikeFilter,orderBys:[{metric:{metricName:"sessions"},desc:true}],limit:15}));
  out.spikeByLanguage=rows(await runReport(accessToken,{dateRanges:spikeRanges,dimensions:[{name:"language"}],metrics:[{name:"sessions"}],dimensionFilter:spikeFilter,orderBys:[{metric:{metricName:"sessions"},desc:true}],limit:15}));
  out.spikeByPageReferrer=rows(await runReport(accessToken,{dateRanges:spikeRanges,dimensions:[{name:"pageReferrer"}],metrics:[{name:"sessions"}],dimensionFilter:spikeFilter,orderBys:[{metric:{metricName:"sessions"},desc:true}],limit:15}));
  out.spikeBySessionSourcePlatform=rows(await runReport(accessToken,{dateRanges:spikeRanges,dimensions:[{name:"sessionSourcePlatform"}],metrics:[{name:"sessions"},{name:"engagedSessions"}],dimensionFilter:spikeFilter,orderBys:[{metric:{metricName:"sessions"},desc:true}],limit:10}));
  // New vs returning
  out.spikeNewVsReturning=rows(await runReport(accessToken,{dateRanges:spikeRanges,dimensions:[{name:"newVsReturning"}],metrics:[{name:"sessions"},{name:"totalUsers"}],dimensionFilter:spikeFilter,orderBys:[{metric:{metricName:"sessions"},desc:true}],limit:5}));
  // Screen resolution - bots often identical
  out.spikeResolution=rows(await runReport(accessToken,{dateRanges:spikeRanges,dimensions:[{name:"screenResolution"}],metrics:[{name:"sessions"}],dimensionFilter:spikeFilter,orderBys:[{metric:{metricName:"sessions"},desc:true}],limit:15}));
  // Compare organic same days
  out.organicSpikeDays=rows(await runReport(accessToken,{dateRanges:spikeRanges,dimensions:[{name:"sessionDefaultChannelGroup"}],metrics:[{name:"sessions"},{name:"engagedSessions"}],orderBys:[{metric:{metricName:"sessions"},desc:true}],limit:10}));

  // Full 28d: browser for unassigned
  out.unassignedBrowser28=rows(await runReport(accessToken,{dateRanges,dimensions:[{name:"browser"}],metrics:[{name:"sessions"},{name:"engagedSessions"}],dimensionFilter:unassignedFilter,orderBys:[{metric:{metricName:"sessions"},desc:true}],limit:15}));

  fs.writeFileSync("scripts/output-ga4-unassigned-deep.json", JSON.stringify(out,null,2));
  console.log(JSON.stringify(out,null,2));
})().catch(e=>{console.error(e);process.exit(1);});
