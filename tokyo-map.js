/* Leaflet-backed map. Coordinates are cached; no geocoding requests run in the browser. */
(() => {
  'use strict';
  const host = document.getElementById('tokyo-map-canvas');
  if (!host) return;
  const el = id => document.getElementById(id);
  if (!window.L || typeof TOKYO_MAP_DATA === 'undefined') {
    host.innerHTML = '<p class="map-canvas-fallback">지도를 불러오지 못했어. 새로고침하거나 각 카드의 구글 지도 링크를 이용해줘.</p>';
    return;
  }
  const data = TOKYO_MAP_DATA;
  const svg = content => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + content + '</svg>';
  const kinds = {
    hotel: {name:'숙소', color:'#73559b', icon:svg('<path d="M3 18V7m18 11V7M3 14h18M6 10h4v4H6zm8 0h4v4h-4zM3 18v2m18-2v2M3 7h18"/>')},
    food: {name:'식당', color:'#aa512d', icon:svg('<path d="M5 3v6m3-6v6m3-6v6M5 7h6m-3 2v12M19 3c-3 3-3 8 0 9v9m0-18v9"/>')},
    cafe: {name:'카페', color:'#386b98', icon:svg('<path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zm12 1h2a3 3 0 0 1 0 6h-2M7 3v3m5-3v3M3 22h15"/>')},
    spot: {name:'명소', color:'#236e64', icon:svg('<path d="m3 8 9-5 9 5H3zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18"/>')}
  };
  const icon = kind => '<span class="map-kind-icon" style="--marker:'+kinds[kind].color+'">'+kinds[kind].icon+'</span>';
  const entries = [
    ...TOKYO.hotels.map(p=>({...p, key:'hotel:'+p.id, kind:'hotel'})),
    ...TOKYO.items.map(p=>({...p, key:'item:'+p.id}))
  ].map(p=>({...p,geo:data.points[p.key]}));
  const entryByKey = new Map(entries.map(p=>[p.key,p]));
  const cfg = {view:'areas', area:'all', kinds:new Set(Object.keys(kinds)), day:'all', focus:null, limit:8};
  const mainAreas = new Set(['ginza','marunouchi','asakusa','ueno','aoyama','shinjuku','kiyo','roppongi','komagome']);
  const dayColors = ['#73559b','#236e64','#386b98','#aa512d'];
  let map, areasLayer, markersLayer, routesLayer, selectedLayer, tileErrors=0, tileLoads=0;
  const selected = p => p.kind==='hotel' ? state.hotel===p.id : state.selected.includes(p.id);
  const activeEntries = () => entries.filter(p => cfg.kinds.has(p.kind) && (cfg.area==='all'||cfg.area===p.area) &&
    (cfg.view!=='selected' && cfg.view!=='route' || selected(p)));
  const scrollMap = () => el('map').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});

  map=L.map(host,{scrollWheelZoom:false,zoomSnap:.25,zoomDelta:1,minZoom:10,maxZoom:18,attributionControl:true,
    zoomAnimation:!matchMedia('(prefers-reduced-motion: reduce)').matches}).setView([35.695,139.758],12.25);
  map.createPane('tripAreas'); map.getPane('tripAreas').style.zIndex=350;
  map.createPane('tripRoutes'); map.getPane('tripRoutes').style.zIndex=410;
  areasLayer=L.layerGroup().addTo(map); routesLayer=L.layerGroup().addTo(map);
  markersLayer=L.layerGroup().addTo(map); selectedLayer=L.layerGroup().addTo(map);
  L.tileLayer(data.tileUrl,{maxZoom:19,attribution:data.attribution,keepBuffer:1}).on('tileload',()=>{
    tileLoads++; el('map-tile-warning').hidden=true;
  }).on('tileerror',()=>{tileErrors++;if(tileErrors>2&&!tileLoads)el('map-tile-warning').hidden=false;}).addTo(map);
  L.control.scale({imperial:false,maxWidth:100}).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com/" target="_blank" rel="noopener">Leaflet</a>');
  host.setAttribute('aria-label','도쿄 동네와 여행 후보 지도. 방향키로 이동하고 더하기·빼기로 확대할 수 있어.');
  const homeBounds=L.latLngBounds([[35.648,139.684],[35.747,139.829]]);
  function fitHome(){map.fitBounds(homeBounds,{padding:[22,22],maxZoom:12.75,animate:false});}
  function fitChosen(){const ps=entries.filter(selected).map(p=>p.geo.point);if(ps.length)map.fitBounds(ps,{padding:[55,55],maxZoom:15,animate:false});else fitHome();}
  function kindCount(list){return Object.entries(kinds).map(([k,v])=>{const n=list.filter(p=>p.kind===k).length;return n?'<b title="'+v.name+' '+n+'곳" style="color:'+v.color+'">'+v.icon+n+'</b>':''}).join('');}
  function setView(view){cfg.view=view;cfg.focus=null;cfg.limit=8;sync();}
  function setArea(area,zoom=true){cfg.area=area;cfg.focus=null;cfg.limit=8;el('map-area').value=area;
    if(area!=='all'&&cfg.view==='areas')cfg.view='all';
    if(zoom){if(area==='all')fitHome();else{const ps=entries.filter(p=>p.area===area&&p.geo.precision==='venue').map(p=>p.geo.point);
      if(ps.length>1)map.fitBounds(ps,{padding:[45,45],maxZoom:15,animate:false});else map.setView(data.areas[area].point,14.5,{animate:false});}}
    sync();
  }
  function areaMarker(id,a,small=false,offset=[0,0]){
    const list=entries.filter(p=>p.area===id&&cfg.kinds.has(p.kind));
    const size=small?[100,24]:[146,55];
    const marker=L.marker(a.point,{pane:'markerPane',zIndexOffset:cfg.area===id?800:50,
      title:a.name+' 동네 보기',alt:a.name+' 동네 보기',keyboard:true,
      icon:L.divIcon({className:'map-area-marker '+(small?'secondary ':'')+(cfg.area===id?'active':''),
        html:'<span class="map-area-label"><strong>'+esc(a.name)+'</strong>'+(!small?'<small>'+kindCount(list)+'</small>':'')+'</span>',iconSize:size,iconAnchor:[size[0]/2-offset[0],size[1]/2-offset[1]]})});
    marker.on('add',()=>marker.getElement()?.setAttribute('aria-label',a.name+' 동네 보기 · '+Object.entries(kinds).map(([k,v])=>v.name+' '+list.filter(p=>p.kind===k).length+'곳').join(', ')));
    marker.on('click',()=>setArea(id));return marker;
  }
  function paintAreas(){areasLayer.clearLayers();const overview=cfg.view==='areas',zoom=map.getZoom();
    const size=map.getSize(),compact=size.x<500,occupied=[];
    const chosenHotel=entries.find(p=>p.kind==='hotel'&&selected(p));
    if(overview&&chosenHotel&&cfg.kinds.has('hotel')){const pt=map.latLngToContainerPoint(chosenHotel.geo.point);occupied.push({x:pt.x-23,y:pt.y-23,w:46,h:46});}
    const sorted=Object.entries(data.areas).sort((a,b)=>Number(mainAreas.has(b[0]))-Number(mainAreas.has(a[0])));
    for(const [id,a]of sorted){
      if(cfg.area!=='all'&&id!==cfg.area)continue;
      if(overview||id===cfg.area){L.circle(a.point,{pane:'tripAreas',radius:id==='aoyama'?1250:850,
        color:'#38796b',weight:1,dashArray:'4 6',opacity:.3,fillColor:'#8cbba3',fillOpacity:.12,interactive:false}).addTo(areasLayer);}
      if(overview||zoom<14.1){
        const small=!overview||!mainAreas.has(id),pt=map.latLngToContainerPoint(a.point);
        const w=Math.max(small?64:80,Math.min(145,a.name.length*(compact?11:13)+18)),h=small?26:49;
        const shifts=[[0,0],[0,-48],[0,48],[-60,0],[60,0],[-52,-46],[52,-46],[-52,46],[52,46],[0,-86],[0,86],[-95,-35],[95,-35],[-95,35],[95,35]];
        let offset=[0,0],best=Infinity;
        for(const [dx,dy]of shifts){
          const x=Math.max(9,Math.min(size.x-w-9,pt.x+dx-w/2)),y=Math.max(10,Math.min(size.y-h-35,pt.y+dy-h/2));
          const rect={x,y,w,h};
          const overlap=occupied.reduce((n,r)=>n+Math.max(0,Math.min(x+w+5,r.x+r.w)-Math.max(x-5,r.x))*Math.max(0,Math.min(y+h+5,r.y+r.h)-Math.max(y-5,r.y)),0);
          const move=Math.hypot(x+w/2-pt.x,y+h/2-pt.y),score=overlap*100+move;
          if(score<best){best=score;offset=[x+w/2-pt.x,y+h/2-pt.y];}
        }
        occupied.push({x:pt.x+offset[0]-w/2,y:pt.y+offset[1]-h/2,w,h});
        if(Math.hypot(...offset)>15){const end=map.containerPointToLatLng(pt.add(L.point(offset[0],offset[1])));
          L.polyline([a.point,end],{pane:'tripAreas',color:'#477569',weight:1,opacity:.6,interactive:false}).addTo(areasLayer);
          L.circleMarker(a.point,{pane:'tripAreas',radius:3,fillColor:'#236e64',color:'#fff',weight:1,fillOpacity:1,interactive:false}).addTo(areasLayer);}
        areaMarker(id,a,small,offset).addTo(areasLayer);
      }
    }
  }
  function markerFor(p,step=null,color=null){const chosen=selected(p),approx=p.geo.precision==='area',size=chosen?36:30;
    const label=p.kind==='hotel'&&chosen&&cfg.view!=='areas'?'<span class="map-marker-caption">숙소 · '+esc(p.name)+'</span>':'';
    const mark=L.marker(p.geo.point,{keyboard:true,title:p.name+(approx?' · 동네 기준 위치':''),alt:p.name,
      zIndexOffset:chosen?1200:400,
      icon:L.divIcon({className:'map-marker',html:'<span class="map-pin '+p.kind+(chosen?' chosen':'')+(approx?' approx':'')+(step!==null?' step':'')+'" style="--marker:'+(color||kinds[p.kind].color)+'">'+(step!==null?step:kinds[p.kind].icon)+'</span>'+label,iconSize:[size,size],iconAnchor:[size/2,size/2]})});
    mark.on('click',()=>focusEntry(p.key,false));return mark;
  }
  function paintMarkers(){markersLayer.clearLayers();selectedLayer.clearLayers();
    if(cfg.view==='areas'){
      const h=entries.find(p=>p.kind==='hotel'&&selected(p));if(h&&cfg.kinds.has('hotel'))markerFor(h).addTo(selectedLayer);
      return;
    }
    let visible=activeEntries();
    if(cfg.view==='route'){paintRoutes();return;}
    const exact=visible.filter(p=>p.geo.precision==='venue'),approx=visible.filter(p=>p.geo.precision==='area');
    const taken=new Set();
    for(const p of exact){if(taken.has(p.key))continue;const at=map.latLngToContainerPoint(p.geo.point);
      const group=exact.filter(q=>!taken.has(q.key)&&map.latLngToContainerPoint(q.geo.point).distanceTo(at)<34);
      group.forEach(q=>taken.add(q.key));
      if(group.length===1||map.getZoom()>=16.5){group.forEach(q=>markerFor(q).addTo(markersLayer));continue;}
      const center=[group.reduce((s,q)=>s+q.geo.point[0],0)/group.length,group.reduce((s,q)=>s+q.geo.point[1],0)/group.length];
      const cs=[...new Set(group.map(q=>q.kind))];
      L.marker(center,{title:group.length+'곳 모여 있음 · 눌러 확대',keyboard:true,
        icon:L.divIcon({className:'map-cluster',iconSize:[36,36],iconAnchor:[18,18],
          html:'<span>'+group.length+'</span><i>'+cs.map(k=>'<b style="background:'+kinds[k].color+'"></b>').join('')+'</i>'})})
        .on('click',()=>map.setView(center,Math.min(map.getZoom()+1.5,17),{animate:false})).addTo(markersLayer);
    }
    // Unverified facility coordinates remain explicitly neighborhood-level, never a fabricated street pin.
    if(map.getZoom()>=14&&cfg.area!=='all')for(const p of approx)markerFor(p).addTo(markersLayer);
    const chosenHotel=visible.find(p=>p.kind==='hotel'&&selected(p));if(chosenHotel)markerFor(chosenHotel).addTo(selectedLayer);
  }
  function paintRoutes(){routesLayer.clearLayers();
    if(cfg.view!=='route'||!state.plan)return;
    const hotel=entries.find(p=>p.kind==='hotel'&&p.id===state.plan.hotel.id);
    state.plan.days.forEach((day,i)=>{if(cfg.day!=='all'&&Number(cfg.day)!==i)return;
      const stops=day.rows.filter(r=>r.item).map(r=>entryByKey.get('item:'+r.item.id)).filter(Boolean);
      const exact=stops.filter(p=>p.geo.precision==='venue');
      const coords=[...(hotel?[hotel.geo.point]:[]),...exact.map(p=>p.geo.point),...(hotel?[hotel.geo.point]:[])];
      if(coords.length>1)L.polyline(coords,{pane:'tripRoutes',color:dayColors[i],weight:3,opacity:.7,dashArray:'7 7',interactive:false}).addTo(routesLayer);
      stops.forEach((p,j)=>{if(cfg.kinds.has(p.kind))markerFor(p,j+1,dayColors[i]).addTo(markersLayer);});
    });
    if(hotel)markerFor(hotel).addTo(selectedLayer);
  }
  function mixed(list){const groups=Object.keys(kinds).map(k=>list.filter(p=>p.kind===k));const out=[];for(let i=0;out.length<list.length;i++)for(const group of groups)if(group[i])out.push(group[i]);return out;}
  function renderSidebar(){
    if(cfg.focus){renderDetail(entryByKey.get(cfg.focus));return;}
    el('map-detail').hidden=true;el('map-area-info').hidden=false;
    const a=data.areas[cfg.area];el('map-side-title').textContent=a?a.name:cfg.view==='selected'?'담은 곳의 위치':cfg.view==='route'?'날짜별 동선':'도쿄 동네부터 보기';
    el('map-side-desc').textContent=a?a.description:cfg.view==='selected'?'선택한 숙소와 담은 장소만 표시해.':cfg.view==='route'?'시간표에 들어간 장소를 방문 순서대로 이었어.':'긴자는 도쿄역 남쪽, 아사쿠사는 우에노 동쪽. 동네 이름을 누르면 주변 후보를 볼 수 있어.';
    const nearby=a?a.neighbors:['ginza','asakusa','ueno','aoyama','shinjuku','kiyo'];
    el('map-neighbors').innerHTML=nearby.map(id=>'<button data-map-area="'+id+'">'+esc(data.areas[id].name)+'</button>').join('');
    el('map-neighbors').querySelectorAll('button').forEach(b=>b.onclick=()=>setArea(b.dataset.mapArea));
    const list=mixed(activeEntries());el('map-list-label').textContent=(a?'이 동네 후보':cfg.view==='selected'||cfg.view==='route'?'선택한 후보':'지도에서 볼 수 있는 후보')+' '+list.length+'곳';
    el('map-list').innerHTML=list.length?list.slice(0,cfg.limit).map(p=>'<li><button data-map-entry="'+p.key+'">'+icon(p.kind)+'<span><strong>'+esc(p.name)+(selected(p)?' · 선택':'')+'</strong><small>'+esc(data.areas[p.area].name)+' · '+(p.kind==='hotel'?won(p.price)+' / 3박':esc(p.menu))+(p.geo.precision==='area'?' · 동네 기준':'')+'</small></span></button></li>').join(''):'<li class="map-empty">'+(cfg.view==='selected'||cfg.view==='route'?'아직 선택한 곳이 없어. 카드나 지도에서 가고 싶은 곳을 담아봐.':'표시할 후보가 없어. 종류 필터를 다시 켜줘.')+'</li>';
    el('map-list').querySelectorAll('button').forEach(b=>b.onclick=()=>focusEntry(b.dataset.mapEntry));
    el('map-more').hidden=list.length<=cfg.limit;
  }
  function renderDetail(p){if(!p)return;el('map-area-info').hidden=true;el('map-detail').hidden=false;
    const on=selected(p),photo=p.photos?.[0];
    el('map-detail').innerHTML='<button class="map-detail-back" id="map-back">동네 목록으로</button>'+(photo?'<img class="map-detail-photo" src="'+esc(photo)+'" alt="'+esc(p.name)+' 사진" loading="lazy">':'')+icon(p.kind)+'<h3>'+esc(p.name)+'</h3><p>'+esc(data.areas[p.area].name)+' · '+(p.kind==='hotel'?esc(p.room):esc(p.menu))+'</p>'+(p.kind==='hotel'?'<p class="map-detail-price">'+won(p.price)+'</p><p>2인 1실 · 3박 표시 합계<br>후기 '+p.rating+' / 10 · '+hotelTax(p)+'</p>':'<p>'+esc(p.desc)+'</p>')+
      '<button class="btn '+(on?'lime':'')+'" id="map-pick">'+(p.kind==='hotel'?(on?'선택한 숙소':'이 숙소 선택'):(on?'담음 · 빼기':'가고 싶은 곳에 담기'))+'</button><div class="map-detail-links"><button class="map-card-link" id="map-show-card">카드에서 자세히</button>'+urlLink(mapURL(p.jp||p.en||p.name),'구글 지도')+'</div><p class="map-detail-source">'+esc(p.geo.label)+' · '+urlLink(p.geo.source,'위치 출처')+'</p>';
    const img=el('map-detail').querySelector('img');if(img)img.onerror=()=>{img.hidden=true;};
    el('map-back').onclick=()=>{cfg.focus=null;map.closePopup();renderSidebar();};
    el('map-pick').onclick=()=>{if(p.kind==='hotel'){state.hotel=p.id;save();renderHotels();renderBasket();renderPlan();renderBudget();}else{togglePlace(p.id);save();renderCatalog();renderBasket();renderPlan();}sync();};
    el('map-show-card').onclick=()=>showCard(p);
  }
  function showCard(p){if(p.kind==='hotel'){filters.hotelArea='all';filters.hotelPrice='all';filters.hotelBed='all';filters.hotelLimit=99;
      for(const id of ['hotel-area','hotel-price','hotel-bed'])el(id).value='all';renderHotels();
    }else{filters.kind=p.kind;filters.area='all';filters.menu='all';filters.weather='all';filters.query='';filters.recommended=false;filters.japanese=false;filters.limit=99;
      el('place-area').value='all';el('place-weather').value='all';el('place-search').value='';el('recommended-only').checked=false;el('japanese-only').checked=false;renderCatalogTabs();renderMenus();renderCatalog();}
    const target=document.querySelector(p.kind==='hotel'?'[data-hotel="'+p.id+'"]':'[data-add="'+p.id+'"]');
    target?.closest('article')?.scrollIntoView({block:'center',behavior:'smooth'});target?.focus({preventScroll:true});
  }
  function focusEntry(key,move=true){const p=entryByKey.get(key);if(!p)return;
    if(cfg.view==='areas'||cfg.view==='route'||(cfg.view==='selected'&&!selected(p)))cfg.view='all';
    cfg.kinds.add(p.kind);cfg.area=p.area;cfg.focus=key;el('map-area').value=p.area;
    if(move)map.setView(p.geo.point,p.geo.precision==='venue'?16:14.25,{animate:false});
    sync();
    const content=document.createElement('div');content.className='map-popup';
    content.innerHTML='<strong>'+esc(p.name)+'</strong><small>'+kinds[p.kind].name+' · '+esc(data.areas[p.area].name)+(p.geo.precision==='area'?' · 동네 기준 위치':'')+'</small>';
    L.popup({closeButton:true,maxWidth:230,autoPan:false}).setLatLng(p.geo.point).setContent(content).openOn(map);
  }
  function sync(){
    el('map-day-controls').hidden=cfg.view!=='route';
    document.querySelectorAll('[data-map-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mapMode===cfg.view));
    document.querySelectorAll('[data-map-kind]').forEach(b=>b.setAttribute('aria-pressed',cfg.kinds.has(b.dataset.mapKind)));
    const h=selectedHotel();el('map-base').innerHTML=h?'선택한 숙소 · <strong>'+esc(h.name)+'</strong>':'숙소를 고르면 지도에서도 강조돼';
    el('map-hotel-focus').hidden=!h;
    el('map-selection-count').textContent='담은 곳 '+state.selected.length;
    routesLayer.clearLayers();paintAreas();paintMarkers();renderSidebar();
    el('map-status').textContent=cfg.view==='route'&&!state.plan?'항공·숙소와 장소를 고른 뒤 시간표를 먼저 만들어줘.':cfg.view==='route'&&state.plan.signature!==signature()?'선택이 바뀌었어. 동선을 보려면 시간표를 다시 만들어줘.':cfg.view==='areas'?'동네 이름을 눌러 주변 후보 보기':cfg.view==='route'?'번호는 그날의 방문 순서':'';
  }
  document.querySelectorAll('[data-map-mode]').forEach(b=>b.onclick=()=>{setView(b.dataset.mapMode);if(cfg.view==='selected'||cfg.view==='route')fitChosen();});
  el('map-legend').innerHTML=Object.entries(kinds).map(([key,k])=>'<button data-map-kind="'+key+'" aria-pressed="true">'+icon(key)+k.name+'</button>').join('')+'<small>숫자는 가까이 모인 후보 수</small>';
  el('map-legend').querySelectorAll('button').forEach(b=>b.onclick=()=>{const key=b.dataset.mapKind;if(cfg.kinds.has(key))cfg.kinds.delete(key);else cfg.kinds.add(key);cfg.focus=null;sync();});
  el('map-area').innerHTML='<option value="all">도쿄 전체</option>'+Object.entries(data.areas).map(([id,a])=>'<option value="'+id+'">'+esc(a.name)+'</option>').join('');
  el('map-area').onchange=e=>setArea(e.target.value);
  el('map-home').onclick=()=>{cfg.area='all';cfg.focus=null;cfg.view='areas';cfg.kinds=new Set(Object.keys(kinds));el('map-area').value='all';fitHome();sync();};
  el('map-fit-selected').onclick=()=>{cfg.area='all';el('map-area').value='all';setView('selected');fitChosen();};
  el('map-hotel-focus').onclick=()=>{if(state.hotel)focusEntry('hotel:'+state.hotel);};
  el('map-more').onclick=()=>{cfg.limit+=8;renderSidebar();};
  el('map-day').onchange=e=>{cfg.day=e.target.value;sync();};
  map.on('zoomend',()=>{paintAreas();paintMarkers();});
  window.addEventListener('tokyo:selection-changed',()=>sync());
  window.TokyoTripMap={focus(key){scrollMap();focusEntry(key);},sync};
  const observer=new IntersectionObserver(items=>{if(items.some(x=>x.isIntersecting)){map.invalidateSize({pan:false});if(!host.dataset.ready){fitHome();host.dataset.ready='true';}observer.disconnect();}},{rootMargin:'120px'});observer.observe(host);
  let lastSize='';
  new ResizeObserver(()=>{const size=host.clientWidth+':'+host.clientHeight;if(size===lastSize)return;lastSize=size;
    requestAnimationFrame(()=>{map.invalidateSize({pan:false});if(cfg.view==='areas'&&cfg.area==='all')fitHome();else{paintAreas();paintMarkers();}});
  }).observe(host);
  sync();
})();
