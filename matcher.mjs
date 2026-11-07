// Independently implemented matching principles informed by Mornye's Qobuz/Tidal source.
export function norm(s='') {return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(feat|featuring|ft)\.?\b/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');}
export function title(s='') {return norm(String(s).replace(/\s*[([](?:official|lyric|visualizer|remaster(?:ed)?|audio|video)[^\])]*[\])]/ig,''));}
export function score(track, request) {
 const a=title(track.title),b=title(request.title);
 if(!a||!b)return -1;
 let points=a===b?65:(a.includes(b)||b.includes(a)?35:-30);
 const artist=norm(track.artist),expected=norm(request.artist);
 if(expected)points+=artist===expected?25:(artist.includes(expected)||expected.includes(artist)?12:-35);
 const album=norm(track.album),target=norm(request.album);
 if(target&&album)points+=album===target?8:0;
 const isrc=norm(track.isrc),wanted=norm(request.isrc);
 if(wanted&&isrc)points+=isrc===wanted?100:-80;
 const d=Number(track.duration),e=Number(request.duration);
 if(d>0&&e>0){const delta=Math.abs(d-e);points+=delta<=2?12:delta<=5?4:delta<=10?-10:-55;}
 return points;
}
export function match(tracks,request){return tracks.map(t=>({...t,matchScore:score(t,request)})).filter(t=>t.matchScore>=45).sort((a,b)=>b.matchScore-a.matchScore);}
