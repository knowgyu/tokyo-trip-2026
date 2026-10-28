/* A list-and-map view. Selecting a place never resets the neighborhood or camera. */
(()=>{
 'use strict';
 const el=id=>document.getElementById(id),host=el('tokyo-map-canvas');
 if(!host)return;
 if(!window.L){host.innerHTML='<p class="map-canvas-fallback">지도를 불러오지 못했어. 각 카드의 구글 지도 링크에서 위치를 볼 수 있어.</p>';return}
 const data=TOKYO_MAP_DATA;
 const svg=s=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+s+'</svg>';
 const kinds={hotel:{name:'숙소',color:'#73559b',icon:svg('<path d="M3 20V7h18v13M3 14h18M7 10h3v4H7m7-4h3v4h-3"/>')},food:{name:'식당',color:'#aa512d',icon:svg('<path d="M5 3v6m3-6v6m3-6v6M5 7h6m-3 2v12M19 3c-3 3-3 8 0 9v9m0-18v9"/>')},cafe:{name:'카페',color:'#386b98',icon:svg('<path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zm12 1h2a3 3 0 0 1 0 6h-2M7 3v3m5-3v3M3 22h15"/>')},spot:{name:'명소',color:'#236e64',icon:svg('<path d="m3 8 9-5 9 5H3zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18"/>')}};
 const entries=[...TOKYO.hotels.map(p=>({...p,key:'hotel:'+p.id,kind:'hotel'})),...TOKYO.items.map(p=>({...p,key:'item:'+p.id}))].map(p=>({...p,geo:data.points[p.key]})).filter(p=>p.geo);
 const byKey=new Map(entries.map(p=>[p.key,p]));
 const cfg={view:'all',area:'all',kinds:new Set(Object.keys(kinds)),query:'',budget:true,day:'all',focus:null,limit:24,surface:'map',feedback:'',camera:null,pendingArea:null,pendingFit:false};
 const isSelected=p=>p.kind==='hotel'?state.hotel===p.id:state.selected.includes(p.id);
 const filtered=()=>entries.filter(p=>cfg.kinds.has(p.kind)&&(cfg.area==='all'||cfg.area===p.area)&&(cfg.view==='all'||isSelected(p))&&(!cfg.budget||p.kind!=='hotel'||p.price<=1000000)&&(!cfg.query||[p.name,p.jp,p.menu,data.areas[p.area].name].join(' ').toLocaleLowerCase().includes(cfg.query)));
 const motion=()=>!matchMedia('(prefers-reduced-motion: reduce)').matches;
 const map=L.map(host,{scrollWheelZoom:false,minZoom:10,maxZoom:18,zoomSnap:.25,zoomAnimation:motion()}).setView([35.69,139.753],12.25);
 map.createPane('tripAreas');map.getPane('tripAreas').style.zIndex=350;
 map.createPane('tripRoutes');map.getPane('tripRoutes').style.zIndex=410;
 const areas=L.layerGroup().addTo(map),markers=L.layerGroup().addTo(map),routes=L.layerGroup().addTo(map),chosen=L.layerGroup().addTo(map);
 let tileLoads=0,tileErrors=0,cameraSet=false;
 L.tileLayer(data.tileUrl,{maxZoom:19,attribution:data.attribution,keepBuffer:1}).on('tileload',()=>{tileLoads++;el('map-tile-warning').hidden=true}).on('tileerror',()=>{if(++tileErrors>2&&!tileLoads)el('map-tile-warning').hidden=false}).addTo(map);
 L.control.scale({imperial:false,maxWidth:100}).addTo(map);
 map.attributionControl.setPrefix('<a href="https://leafletjs.com/" target="_blank" rel="noopener">Leaflet</a>');
 host.setAttribute('aria-label','도쿄 여행 후보 지도. 방향키로 이동, 더하기·빼기로 확대. 왼쪽 목록과 동네 선택으로도 이동할 수 있어.');
 const homeBounds=[[35.633,139.681],[35.748,139.827]],dayColors=['#73559b','#236e64','#386b98','#aa512d'];
 const mainAreas=new Set(['ginza','asakusa','ueno','shibuya','aoyama','shinjuku','marunouchi','kiyo','komagome']);
 function fitHome(){map.fitBounds(homeBounds,{padding:[24,24],maxZoom:12.6,animate:false})}
 function fitEntries(list){const ps=list.map(p=>p.geo.point);if(ps.length)map.fitBounds(ps,{padding:[42,42],maxZoom:15,animate:false});else fitHome()}
 function paintAreas(){areas.clearLayers();const z=map.getZoom();
  if(cfg.area!=='all')L.circle(data.areas[cfg.area].point,{pane:'tripAreas',radius:800,color:'#236e64',weight:1,dashArray:'4 6',fillColor:'#72a88b',fillOpacity:.09,interactive:false}).addTo(areas);
  if(z>=14.1)return;
  for(const [id,a]of Object.entries(data.areas)){
   if(cfg.area!=='all'&&id!==cfg.area||cfg.area==='all'&&!mainAreas.has(id))continue;
   const label=L.marker(a.point,{keyboard:true,zIndexOffset:50,title:a.name+' 주변 보기',icon:L.divIcon({className:'map-region-label',html:'<span>'+esc(a.name)+'</span>',iconSize:[120,26],iconAnchor:[60,13]})});
   label.on('click',()=>setArea(id));label.addTo(areas);
  }
 }
 function marker(p,step,color){const on=isSelected(p),size=on?36:30;const m=L.marker(p.geo.point,{keyboard:true,title:p.name,alt:p.name,zIndexOffset:on?1100:400,icon:L.divIcon({className:'map-marker',html:'<span class="map-pin '+p.kind+(on?' chosen':'')+(p.geo.precision==='area'?' approx':'')+'" style="--marker:'+(color||kinds[p.kind].color)+'">'+(step||kinds[p.kind].icon)+'</span>'+(p.kind==='hotel'&&on?'<span class="map-marker-caption">숙소 · '+esc(p.name)+'</span>':''),iconSize:[size,size],iconAnchor:[size/2,size/2]})});m.on('click',()=>focus(p.key,false));return m}
 function paintRoutes(){if(!state.plan||state.plan.signature!==signature())return;const h=byKey.get('hotel:'+state.plan.hotel.id);
  state.plan.days.forEach((day,i)=>{if(cfg.day!=='all'&&Number(cfg.day)!==i)return;const stops=day.rows.filter(r=>r.item).map(r=>byKey.get('item:'+r.item.id)).filter(Boolean);const coords=[...(h?[h.geo.point]:[]),...stops.filter(p=>p.geo.precision==='venue').map(p=>p.geo.point)];if(i!==3&&h)coords.push(h.geo.point);if(coords.length>1)L.polyline(coords,{pane:'tripRoutes',color:dayColors[i],weight:3,dashArray:'6 6',opacity:.7,interactive:false}).addTo(routes);stops.filter(p=>cfg.kinds.has(p.kind)).forEach((p,j)=>marker(p,j+1,dayColors[i]).addTo(markers))});if(h)marker(h).addTo(chosen)
 }
 function paintMarkers(){markers.clearLayers();chosen.clearLayers();routes.clearLayers();if(cfg.view==='route'){paintRoutes();return}
  const exact=filtered().filter(p=>p.geo.precision==='venue'),used=new Set();
  for(const p of exact){if(used.has(p.key))continue;const at=map.latLngToContainerPoint(p.geo.point);const group=exact.filter(q=>!used.has(q.key)&&map.latLngToContainerPoint(q.geo.point).distanceTo(at)<34);group.forEach(q=>used.add(q.key));
   if(group.length===1||map.getZoom()>=16.5){group.forEach(q=>marker(q).addTo(markers));continue}
   const center=[group.reduce((s,q)=>s+q.geo.point[0],0)/group.length,group.reduce((s,q)=>s+q.geo.point[1],0)/group.length];
   L.marker(center,{keyboard:true,title:group.length+'곳 · 확대해서 보기',icon:L.divIcon({className:'map-cluster',html:'<span>'+group.length+'</span><i>'+[...new Set(group.map(q=>q.kind))].map(k=>'<b style="background:'+kinds[k].color+'"></b>').join('')+'</i>',iconSize:[36,36],iconAnchor:[18,18]})}).on('click',()=>{map.setView(center,Math.min(map.getZoom()+1.5,17),{animate:false})}).addTo(markers);
  }
  const h=entries.find(p=>p.kind==='hotel'&&isSelected(p));if(h&&cfg.kinds.has('hotel'))marker(h).addTo(chosen);
  const f=byKey.get(cfg.focus);if(f&&f.geo.precision==='area')marker(f).addTo(chosen);
 }
 function grouped(list){const ranked=[...list].sort((a,b)=>Number(isSelected(b))-Number(isSelected(a))||Number(b.recommended)-Number(a.recommended));const buckets=Object.keys(kinds).map(k=>ranked.filter(p=>p.kind===k));const out=[];for(let i=0;out.length<list.length;i++)for(const b of buckets)if(b[i])out.push(b[i]);return out}
 function pick(p){if(p.kind==='hotel')state.hotel=p.id;else togglePlace(p.id);cfg.feedback=p.name+(p.kind==='hotel'?' 숙소로 선택했어.':isSelected(p)?' 담았어.':' 뺐어.');save();renderHotels();renderCatalog();renderBasket();renderPlan();renderBudget();sync()}
 function renderList(){const list=grouped(filtered()),scroll=el('map-sidebar-scroll')?.scrollTop||0;el('map-count').textContent=list.length+'곳 · 담은 곳 '+state.selected.length;
  const a=data.areas[cfg.area];el('map-side-title').textContent=a?a.name:cfg.view==='selected'?'담은 곳':cfg.view==='route'?'시간표에 담은 곳':'도쿄 전체';el('map-side-desc').textContent=a?a.description:'';
  el('map-list').innerHTML=list.length?list.slice(0,cfg.limit).map(p=>'<li class="'+(cfg.focus===p.key?'active':'')+'"><button class="map-result" data-map-entry="'+p.key+'">'+(p.photos.length?'<img src="'+esc(p.photos[0])+'" alt="" loading="lazy">':'<span class="map-kind-icon" style="--marker:'+kinds[p.kind].color+'">'+kinds[p.kind].icon+'</span>')+'<span><strong>'+esc(p.name)+'</strong><small>'+esc(kinds[p.kind].name)+' · '+esc(data.areas[p.area].name)+'</small><small>'+(p.kind==='hotel'?'3박 '+won(p.price):esc(p.menu))+(p.geo.precision==='area'?' · 동네 기준':'')+'</small></span></button><button class="map-quick-pick" data-map-pick="'+p.key+'" aria-label="'+esc(p.name)+(p.kind==='hotel'?' 숙소 선택':isSelected(p)?' 빼기':' 담기')+'" aria-pressed="'+isSelected(p)+'">'+(isSelected(p)?'선택':p.kind==='hotel'?'선택':'담기')+'</button></li>').join(''):'<li class="map-empty">조건에 맞는 곳이 없어. 검색어나 종류를 바꿔줘.</li>';
  el('map-list').querySelectorAll('[data-map-entry]').forEach(b=>b.onclick=()=>focus(b.dataset.mapEntry,true));el('map-list').querySelectorAll('[data-map-pick]').forEach(b=>b.onclick=()=>{const key=b.dataset.mapPick;pick(byKey.get(key));el('map-list').querySelector('[data-map-pick="'+key+'"]')?.focus({preventScroll:true})});el('map-more').hidden=list.length<=cfg.limit;
  el('map-sidebar-scroll')?.scrollTo(0,scroll);
 }
 function renderDetail(){const p=byKey.get(cfg.focus);el('map-detail').hidden=!p;if(!p)return;
  const on=isSelected(p),meta=p.kind==='hotel'?'3박 '+won(p.price)+' · '+hotelTax(p):p.menu;
  el('map-detail').innerHTML='<button class="map-detail-close" id="map-detail-close" aria-label="장소 상세 닫기">닫기</button><div class="map-detail-summary">'+(p.photos.length?'<button class="map-detail-image" data-gallery="'+p.key+'" aria-label="'+esc(p.name)+' 사진 보기"><img src="'+esc(p.photos[0])+'" alt="" loading="lazy"></button>':'')+'<div><p class="map-detail-category">'+kinds[p.kind].name+' · '+esc(data.areas[p.area].name)+'</p><h3>'+esc(p.name)+'</h3><p>'+esc(meta)+'</p></div></div><div class="map-detail-links"><button class="btn '+(on?'lime':'')+'" id="map-pick">'+(p.kind==='hotel'?(on?'선택한 숙소':'숙소 선택'):(on?'담음 · 빼기':'담기'))+'</button><button class="map-card-link" id="map-show-card">자세히</button>'+urlLink(mapURL(p.jp||p.en),'구글 지도')+'</div><details class="map-location-source"><summary>'+esc(p.geo.precision==='area'?'동네 기준 위치':'위치 출처')+'</summary><p>'+esc(p.geo.label)+' '+urlLink(p.geo.source,'원문')+'</p></details>';
  el('map-detail-close').onclick=()=>{cfg.focus=null;map.closePopup();el('map-detail').hidden=true;paintMarkers();renderList()};el('map-pick').onclick=()=>pick(p);el('map-show-card').onclick=()=>showCard(p);bindGalleries();
  const img=el('map-detail').querySelector('img');if(img)img.onerror=()=>{img.hidden=true};
 }
 function focus(key,move){const p=byKey.get(key);if(!p)return;cfg.focus=key;
  if(move){cameraSet=true;cfg.pendingArea=null;cfg.pendingFit=false;cfg.camera={point:p.geo.point,zoom:p.geo.precision==='venue'?Math.max(15,map.getZoom()):14};if(host.clientWidth)map.setView(cfg.camera.point,cfg.camera.zoom,{animate:false});if(matchMedia('(max-width:760px)').matches)setSurface('map')}
  paintMarkers();renderDetail();renderList();
 }
 function showCard(p){if(p.kind==='hotel'){Object.assign(filters,{hotelArea:'all',hotelPrice:'all',hotelBed:'all',hotelStyle:'all',hotelQuery:'',hotelMinClean:false,hotelFees:false,hotelLimit:99});syncHotelControls();renderHotels()}
  else{Object.assign(filters,{kind:p.kind,area:'all',menu:'all',weather:'all',query:'',recommended:false,japanese:false,limit:999});el('place-area').value='all';el('place-weather').value='all';el('place-search').value='';el('recommended-only').checked=false;el('japanese-only').checked=false;renderCatalogTabs();renderMenus();renderCatalog()}
  const b=document.querySelector(p.kind==='hotel'?'[data-hotel="'+p.id+'"]':'[data-add="'+p.id+'"]');b?.closest('article')?.scrollIntoView({block:'center',behavior:motion()?'smooth':'auto'});b?.focus({preventScroll:true});
 }
 function moveToArea(id){if(id==='all')fitHome();else{const exact=entries.filter(p=>p.area===id&&p.geo.precision==='venue');if(exact.length)fitEntries(exact);else map.setView(data.areas[id].point,14,{animate:false})}}
 function setArea(id){cfg.area=id;cfg.limit=24;cfg.focus=null;el('map-area').value=id;el('map-detail').hidden=true;if(host.clientWidth)moveToArea(id);else cfg.pendingArea=id;sync()}
 function restoreCamera(){if(!host.clientWidth)return;const camera=cfg.camera;map.invalidateSize({pan:false});if(cfg.pendingArea!==null){const id=cfg.pendingArea;cfg.pendingArea=null;moveToArea(id)}else if(cfg.pendingFit){cfg.pendingFit=false;fitEntries(filtered())}else if(camera)map.setView(camera.point,camera.zoom,{animate:false});paintAreas();paintMarkers()}
 function setSurface(surface){if(surface==='list'&&host.clientWidth)cfg.camera={point:map.getCenter(),zoom:map.getZoom()};cfg.surface=surface;el('map-layout').dataset.surface=surface;document.querySelectorAll('[data-map-surface]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mapSurface===surface));if(surface==='map')requestAnimationFrame(restoreCamera)}
 function sync(){document.querySelectorAll('[data-map-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mapMode===cfg.view));document.querySelectorAll('[data-map-kind]').forEach(b=>b.setAttribute('aria-pressed',cfg.kinds.has(b.dataset.mapKind)));el('map-day-controls').hidden=cfg.view!=='route';const h=selectedHotel();el('map-base').textContent=h?'숙소 · '+h.name:'숙소 선택 전';el('map-hotel-focus').hidden=!h;el('map-selection-count').textContent='담은 곳 '+state.selected.length;paintAreas();paintMarkers();renderList();renderDetail();el('map-status').textContent=cfg.view==='route'&&!state.plan?'시간표를 먼저 만들면 날짜별 동선이 보여.':cfg.view==='route'&&state.plan.signature!==signature()?'선택이 바뀌었어. 시간표를 다시 만들어줘.':cfg.feedback}
 document.querySelectorAll('[data-map-mode]').forEach(b=>b.onclick=()=>{cfg.view=b.dataset.mapMode;cfg.limit=24;cfg.focus=null;sync();if(cfg.view!=='all'){if(host.clientWidth)fitEntries(filtered());else cfg.pendingFit=true}});
 el('map-legend').innerHTML=Object.entries(kinds).map(([id,k])=>'<button data-map-kind="'+id+'" aria-pressed="true"><span class="map-kind-icon" style="--marker:'+k.color+'">'+k.icon+'</span>'+k.name+'</button>').join('');el('map-legend').querySelectorAll('button').forEach(b=>b.onclick=()=>{const k=b.dataset.mapKind;cfg.kinds.has(k)?cfg.kinds.delete(k):cfg.kinds.add(k);cfg.limit=24;sync()});
 el('map-area').innerHTML='<option value="all">도쿄 전체</option>'+Object.entries(data.areas).map(([id,a])=>'<option value="'+id+'">'+esc(a.name)+'</option>').join('');el('map-area').onchange=e=>setArea(e.target.value);
 let timer;el('map-search').oninput=e=>{cfg.query=e.target.value.toLocaleLowerCase().trim();cfg.limit=24;clearTimeout(timer);timer=setTimeout(sync,140)};el('map-budget').onchange=e=>{cfg.budget=e.target.checked;sync()};
 el('map-home').onclick=()=>setArea('all');el('map-hotel-focus').onclick=()=>{if(state.hotel)focus('hotel:'+state.hotel,true)};
 el('map-more').onclick=()=>{cfg.limit+=24;renderList()};el('map-day').onchange=e=>{cfg.day=e.target.value;sync()};document.querySelectorAll('[data-map-surface]').forEach(b=>b.onclick=()=>setSurface(b.dataset.mapSurface));
 map.on('zoomend',()=>{paintAreas();paintMarkers()});map.on('moveend',()=>{if(host.clientWidth)cfg.camera={point:map.getCenter(),zoom:map.getZoom()}});window.addEventListener('tokyo:selection-changed',sync);
 window.TokyoTripMap={focus(key){el('map').scrollIntoView({block:'start',behavior:motion()?'smooth':'auto'});focus(key,true)},sync};
 new ResizeObserver(()=>requestAnimationFrame(restoreCamera)).observe(host);
 const observer=new IntersectionObserver(v=>{if(v.some(x=>x.isIntersecting)){map.invalidateSize({pan:false});if(!cameraSet)fitHome();observer.disconnect()}},{rootMargin:'120px'});observer.observe(host);sync();
})();
