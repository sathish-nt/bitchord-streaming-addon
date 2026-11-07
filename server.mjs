import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {match} from './matcher.mjs';
const port=Number(process.env.PORT||8787);
const manifest={id:'org.community.mornye-authorized-match',name:'Mornye-style Authorized Full Tracks',version:'1.0.0',description:'BitChord full-track streaming from explicitly authorized catalog entries. Qobuz/Tidal matching concepts; no unauthorized provider access.',resources:['search','stream'],allowDownloads:0,checkValidLossless:0};
function send(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','cache-control':'no-store'});res.end(JSON.stringify(data));}
function https(u){try{const x=new URL(u);return x.protocol==='https:'&&!!x.hostname&&!['localhost','127.0.0.1','::1'].includes(x.hostname)&&!x.hostname.endsWith('.local');}catch{return false;}}
async function catalog(){const data=JSON.parse(await readFile(new URL('./catalog.json',import.meta.url),'utf8'));return (data.tracks||[]).filter(t=>t&&typeof t.id==='string'&&t.id.length<160&&t.title&&t.artist&&Number(t.duration)>0&&https(t.url)&&t.authorized===true&&['mp3','flac','aac','m4a','ogg'].includes(t.format));}
function publicTrack(t){return {id:t.id,title:t.title,artist:t.artist,album:t.album||'',duration:Number(t.duration),isrc:t.isrc||undefined,artworkURL:https(t.artworkURL)?t.artworkURL:undefined,format:t.format,audioQuality:t.format==='flac'?'LOSSLESS':'HIGH'};}
function stream(t){return {url:t.url,format:t.format,quality:t.format==='flac'?'Lossless':'Standard',codec:t.format==='m4a'?'aac':t.format,container:t.format==='m4a'?'mp4':t.format,manifest:'none',encrypted:false,...(Number(t.bitDepth)>0?{bitDepth:Number(t.bitDepth)}:{}),...(Number(t.sampleRate)>0?{sampleRate:Number(t.sampleRate)}:{})};}
http.createServer(async(req,res)=>{if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});let u;try{u=new URL(req.url,'http://localhost');}catch{return send(res,400,{error:'Bad URL'});}
if(u.pathname==='/'||u.pathname==='/manifest.json')return send(res,200,manifest);
if(u.pathname==='/health')return send(res,200,{ok:true});
try{const tracks=await catalog();if(u.pathname==='/search'){
 const query={title:(u.searchParams.get('title')||u.searchParams.get('q')||'').slice(0,160),artist:(u.searchParams.get('artist')||'').slice(0,160),album:(u.searchParams.get('album')||'').slice(0,160),isrc:(u.searchParams.get('isrc')||'').slice(0,40),duration:Number(u.searchParams.get('duration')||0)};
 if(!query.title&&!query.isrc)return send(res,200,{tracks:[]});
 const matched=match(tracks,query).slice(0,25).map(publicTrack);return send(res,200,{tracks:matched});}
if(u.pathname.startsWith('/stream/')){let id;try{id=decodeURIComponent(u.pathname.slice(8));}catch{return send(res,400,{error:'Invalid id'});}const t=tracks.find(t=>t.id===id);if(!t)return send(res,404,{error:'Authorized full-track stream unavailable'});return send(res,200,stream(t));}
return send(res,404,{error:'Not found'});
}catch(e){console.error(e);return send(res,500,{error:'Catalog error'});}}).listen(port,'0.0.0.0',()=>console.log(`BitChord addon on ${port}`));
