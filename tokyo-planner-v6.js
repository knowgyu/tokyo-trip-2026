'use strict';
// Deterministic local planning. Distance estimates are not live transport routes.
function tokyoClock(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')}
function tokyoMinutes(s){const p=String(s).trim().match(/^(\d{1,2}):(\d{2})$/);return p&&+p[1]<24&&+p[2]<60?+p[1]*60+(+p[2]):NaN}
function tokyoWindow(p,date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return [];
  // Calendar dates in Japan must not depend on the browser/computer timezone.
  const weekday=new Date(date+'T12:00:00Z').getUTCDay();
  if(!Number.isFinite(weekday)||(p.closed||[]).includes(weekday))return [];
  if(p.eventDates&&(date<p.eventDates[0]||date>p.eventDates[1]))return [];
  const open=p.dayOpen?.[weekday]??p.open,close=p.dayClose?.[weekday]??p.close;
  return (p.dayWindows?.[weekday]??p.windows??[[open,close]]).map(w=>[Math.max(w[0],open,0),Math.min(w[1],close,1440)])
    .filter(w=>w.every(Number.isFinite)&&w[0]<w[1]).sort((a,b)=>a[0]-b[0]);
}
function tokyoGeo(entity,data){
  if(typeof entity==='string'&&data.areas[entity])return {area:entity,point:data.areas[entity].point,precision:'area'};
  if(typeof entity==='string')entity=(data.items||[]).find(p=>p.id===entity)||(data.hotels||[]).find(p=>p.id===entity);
  if(!entity||!data.areas[entity.area])return null;
  const type=entity.kind?'item':'hotel',key=entity.key||type+':'+entity.id;
  const map=data.mapData||(typeof TOKYO_MAP_DATA!=='undefined'?TOKYO_MAP_DATA:null);
  const geo=map?.points?.[key]||data.mapPoints?.[key];
  if(geo?.precision==='venue'&&Array.isArray(geo.point)&&geo.point.length===2&&geo.point.every(Number.isFinite))
    return {area:entity.area,key,point:geo.point,precision:'venue',source:geo.source};
  return {area:entity.area,key,point:data.areas[entity.area].point,precision:'area'};
}
function tokyoTransit(a,b,data){
  const aa=tokyoGeo(a,data),bb=tokyoGeo(b,data);
  if(!aa||!bb)return {minutes:45,how:'위치 미확인 · 이동 45분 가배치, 실제 경로 확인',estimated:true,basis:'unknown'};
  if(aa.key&&aa.key===bb.key)return {minutes:0,how:'같은 장소',estimated:true,basis:'same-place'};
  const dx=(aa.point[0]-bb.point[0])*111.2,dy=(aa.point[1]-bb.point[1])*111.2*Math.cos((aa.point[0]+bb.point[0])*Math.PI/360);
  const distance=Math.hypot(dx,dy),venue=aa.precision==='venue'&&bb.precision==='venue';
  let minutes,how;
  if(venue&&distance<=1.8){
    minutes=Math.max(10,Math.ceil((5+distance*1.3/0.067)/5)*5);
    how='시설 간 거리로 계산한 도보 추정 · 실제 경로 확인';
  }else if(aa.area===bb.area&&!venue){
    minutes=aa.area==='ueno'?30:20;how='같은 지역 도보·역 이동 추정 · 시설 위치와 경로 확인';
  }else{
    minutes=Math.min(80,Math.max(25,Math.ceil((20+distance*4)/5)*5));
    how=(venue?'시설 간':'지역 간')+' 거리 기준 철도·도보 추정 · 실제 환승·시각 확인';
  }
  return {minutes,how,estimated:true,basis:venue?'venue-distance':'area-distance',distanceKm:+distance.toFixed(2),originPoint:aa.point.slice(),destinationPoint:bb.point.slice()};
}
function tokyoAirport(f,h,outbound){
  const haneda=f.airport==='hnd';
  const minutes=haneda?(h.area==='ginza'?60:h.area==='akihabara'?70:80):(h.area==='ueno'?95:h.area==='asakusa'?105:h.area==='akihabara'?100:110);
  return {minutes,how:'공항 ↔ 숙소 이동 추정 · 열차·버스·터미널별 실제 경로 확인',estimated:true,basis:'airport-area',origin:outbound?h.name:(haneda?'Haneda Airport':'Narita Airport'),destination:outbound?(haneda?'Haneda Airport':'Narita Airport'):h.name};
}
function tokyoCandidate(p,date,t,from,data,deadline,earliest=0,maxStart=1440,maxWait=90){
  const trip=tokyoTransit(from,p,data),depart=Math.max(t,earliest-trip.minutes),arrival=depart+trip.minutes;
  for(const [open,close]of tokyoWindow(p,date)){
    const start=Math.max(arrival,open,earliest),end=start+p.duration;
    const lastEntry=p.dayLastEntry?.[new Date(date+'T12:00:00Z').getUTCDay()]??p.lastEntry??p.lastOrder??1440;
    if(!Number.isFinite(p.duration)||p.duration<=0||end>close||end>deadline||start>maxStart||start>lastEntry||start-arrival>maxWait)continue;
    return {p,start,end,arrival,depart,trip,wait:start-arrival};
  }
  return null;
}
function tokyoPlanSignature(config){
  // Keep v4's exact signature contract so existing saved choices remain valid.
  return JSON.stringify({flight:config.flight,hotel:config.hotel,selected:[...(config.selected||[])].sort(),pins:config.pins,must:[...(config.must||[])].sort(),weather:config.weather});
}
function createTokyoPlan(config,data){
  const flight=data.flights.find(f=>f.id===config.flight),hotel=data.hotels.find(h=>h.id===config.hotel);
  if(!flight||!hotel)return {error:'항공편과 숙소를 먼저 골라줘.'};
  const selected=data.items.filter(p=>(config.selected||[]).includes(p.id));
  if(!selected.length)return {error:'가고 싶은 장소를 한 곳 이상 담아줘.'};
  const dates=data.dates,pins=config.pins||{},must=new Set(config.must||[]),assigned=new Set(),warnings=[];
  const outDep=tokyoMinutes(flight.out.split(' → ')[0]),outArr=tokyoMinutes(flight.out.split(' → ')[1]);
  const backDep=tokyoMinutes(flight.back.split(' → ')[0]),backArr=tokyoMinutes(flight.back.split(' → ')[1]);
  if([outDep,outArr,backDep,backArr].some(n=>!Number.isFinite(n))||dates.length!==4)return {error:'항공 시각과 여행 날짜 형식을 확인해줘.'};
  const airportBack=tokyoAirport(flight,hotel,true),airportIn=tokyoAirport(flight,hotel,false),airportBuffer=flight.airport==='hnd'?160:180;
  const airportAt=backDep-airportBuffer,hotelLeave=airportAt-airportBack.minutes;
  const days=dates.map(date=>({date,label:Number(date.slice(5,7))+'/'+Number(date.slice(8))+' '+['일','월','화','수','목','금','토'][new Date(date+'T12:00:00Z').getUTCDay()],rows:[],notes:[]}));
  const fixed=(day,start,end,title,desc,extra={})=>day.rows.push({start,end,title,desc,...extra});
  // A cruise changes its endpoint. Do not fabricate its departure, landing or next origin.
  const needsRoute=p=>p.id==='suijobus';
  const allowed=(p,date)=>!needsRoute(p)&&!assigned.has(p.id)&&(!pins[p.id]||pins[p.id]===date)&&tokyoWindow(p,date).length>0;
  function append(day,c,origin,role){
    const p=c.p;day.rows.push({id:p.id,start:c.start,end:c.end,title:p.name,desc:p.desc,item:p,role:role||p.kind,trip:{...c.trip,depart:c.depart,arrive:c.arrival,origin,destination:(p.jp||p.name)+' Tokyo'},wait:c.wait});assigned.add(p.id);
    if(p.reservation)day.notes.push(p.name+' · 시간 지정권·예약은 아직 확보 전이야. 생성 시각은 예약 시간이 아니야.');
    if(!p.hoursKnown)day.notes.push(p.name+' · 표시 시각은 가배치. 실제 영업일·시간을 출처에서 확인해야 해.');
    if(p.id==='suijobus')day.notes.push('수상버스는 운항편·도착 선착장 미확인 가안이야. 예약한 배의 시각과 하선 위치에 맞춰 다음 이동을 다시 확인해줘.');
  }
  const checkin=outArr+90+airportIn.minutes;
  fixed(days[0],outDep-180,outDep,(flight.airport==='hnd'?'김포':'인천')+'공항 체크인·출국','이륙 3시간 전 공항 도착 목표. 성수·수원시청 출발 경로는 각자 지도에서 확인.');
  fixed(days[0],outDep,outArr,'도쿄로 출발',flight.outRoute);
  fixed(days[0],outArr,outArr+90,'입국·수하물','입국 줄과 지연을 고려해 90분 여유.');
  fixed(days[0],checkin,checkin+30,hotel.name+' 체크인','늦은 체크인 가능 여부는 숙소에 확인.',{trip:{...airportIn,depart:outArr+90,arrive:checkin},role:'checkin'});
  const lateMeal=selected.filter(p=>allowed(p,dates[0])&&p.kind==='food'&&p.area===hotel.area)
    .map(p=>tokyoCandidate(p,dates[0],checkin+30,hotel,data,1380,0,1440,30)).filter(Boolean)
    .sort((a,b)=>(must.has(b.p.id)-must.has(a.p.id))||a.end-b.end)[0];
  if(lateMeal)append(days[0],lateMeal,hotel.name,'dinner');
  else fixed(days[0],checkin+30,Math.min(checkin+75,1440),'숙소 근처 늦은 저녁 · 미정','라멘·우동 등 늦게까지 하는 곳으로. 첫날은 식당 예약을 비워두기.',{role:'dinner'});
  if(lateMeal){const tr=tokyoTransit(lateMeal.p,hotel,data);fixed(days[0],lateMeal.end+tr.minutes,lateMeal.end+tr.minutes+5,'숙소로 돌아오기','첫날은 가까운 곳에서 식사하고 쉬기.',{role:'return',trip:{...tr,depart:lateMeal.end,arrive:lateMeal.end+tr.minutes,origin:(lateMeal.p.jp||lateMeal.p.name)+' Tokyo',destination:hotel.name}})}

  // Plan the two full days before using leftover places on departure morning.
  for(const di of [1,2]){
    const day=days[di];let t=540,from=hotel,origin=hotel.name,spots=0;
    const support=p=>selected.filter(q=>q.id!==p.id&&allowed(q,day.date)&&data.areas[q.area].group===data.areas[p.area].group).length;
    const anchors=selected.filter(p=>p.kind==='spot'&&allowed(p,day.date)).map(p=>({p,c:tokyoCandidate(p,day.date,540,hotel,data,1020)})).filter(x=>x.c);
    for(const a of anchors)a.score=a.c.trip.minutes+a.c.wait*.3-support(a.p)*6-(must.has(a.p.id)?90:0)-(pins[a.p.id]===day.date?180:0)-(di===1&&!tokyoWindow(a.p,dates[2]).length?85:0);
    anchors.sort((a,b)=>a.score-b.score||a.p.id.localeCompare(b.p.id));
    const dayGroup=anchors[0]?data.areas[anchors[0].p.area].group:null;
    function choose(kinds,deadline,earliest=0,role,maxStart=1440,eveningOnly=false){
      const options=[];
      for(const p of selected){
        if(!kinds.includes(p.kind)||!allowed(p,day.date)||(eveningOnly&&p.open<1020))continue;
        // A different district that is also open Friday belongs to Friday unless prioritized.
        if(di===1&&dayGroup&&data.areas[p.area].group!==dayGroup&&p.kind!=='food'&&!must.has(p.id)&&!pins[p.id]&&tokyoWindow(p,dates[2]).length)continue;
        // Leave one flexible sightseeing stop for Friday when Thursday already has one.
        if(di===1&&p.kind==='spot'&&spots>0&&!must.has(p.id)&&!pins[p.id]&&tokyoWindow(p,dates[2]).length){
          const tomorrow=selected.filter(q=>q.kind==='spot'&&allowed(q,dates[2])&&(!pins[q.id]||pins[q.id]===dates[2]));
          if(tomorrow.length<=1)continue;
        }
        const returnDeadline=1380-25-tokyoTransit(p,hotel,data).minutes;
        const c=tokyoCandidate(p,day.date,t,from,data,Math.min(deadline,returnDeadline),earliest,maxStart,60);if(!c)continue;
        const cross=dayGroup&&data.areas[p.area].group!==dayGroup?100:0;
        const onlyToday=di===1&&!tokyoWindow(p,dates[2]).length;
        const priority=Array.isArray(config.priority)?Math.max(0,35-config.priority.indexOf(p.id)*5)*(config.priority.includes(p.id)?1:0):0;
        c.score=c.trip.minutes+c.wait*.5+cross-(must.has(p.id)?110:0)-(pins[p.id]===day.date?240:0)-(onlyToday?45:0)-priority;
        if(config.weather==='indoor'&&!p.indoor)c.score+=18;
        options.push(c);
      }
      options.sort((a,b)=>a.score-b.score||a.p.id.localeCompare(b.p.id));
      const c=options[0];if(!c)return false;
      append(day,c,origin,role);t=c.end+10;from=c.p;origin=(c.p.jp||c.p.name)+' Tokyo';if(c.p.kind==='spot')spots++;return true;
    }
    function meal(role,earliest,deadline){
      if(choose(['food'],deadline,earliest,role,role==='lunch'?810:1170))return;
      const start=Math.max(t,role==='lunch'?720:1080),areaName=data.areas[from.area].name;
      fixed(day,start,start+60,areaName+' '+(role==='lunch'?'점심':'저녁')+' · 미정','현재 동네에서 자유롭게 한 끼. 선택한 식당 중 시간·동선이 맞는 곳이 없어서 비워뒀어.',{role});t=start+70;
    }
    if(!choose(['spot'],735))choose(['cafe'],720);
    if(t<615)choose(['spot','cafe'],735);
    meal('lunch',690,870);
    choose(['spot'],1020);
    choose(['cafe'],1080);
    if(t<930&&spots<3)choose(['spot'],1080);
    // Early evening lights can fit before dinner; ordinary late-open attractions remain optional.
    if(t<1050)choose(['spot'],1170,1020,'spot',1440,true);
    meal('dinner',1050,1230);
    if(spots<4)choose(['spot'],1305,1020);
    const tr=tokyoTransit(from,hotel,data);
    fixed(day,t+tr.minutes,t+tr.minutes+15,'숙소로 돌아오기','다음 날을 위해 쉬기.',{role:'return',trip:{...tr,depart:t,arrive:t+tr.minutes,origin,destination:hotel.name}});
    if(!day.rows.some(r=>r.id))day.notes.push('이 날짜에 넣을 수 있는 담은 장소가 적어. 원하는 지역에서 명소·카페를 더 담아봐.');
  }

  const last=days[3],checkoutStart=hotelLeave>=600?510:hotelLeave-60,checkoutEnd=checkoutStart+30;
  fixed(last,checkoutStart,checkoutEnd,'숙소 체크아웃·짐 보관','이른 체크아웃과 짐 보관 가능 여부를 숙소에 확인. 공항 출발 전에 짐을 찾기.',{role:'checkout'});
  const finalCandidates=selected.filter(p=>allowed(p,dates[3])&&p.kind!=='food'&&p.duration<=100)
    .map(p=>{const back=tokyoTransit(p,hotel,data);return tokyoCandidate(p,dates[3],Math.max(checkoutEnd,540),hotel,data,hotelLeave-30-back.minutes,0,1440,45)})
    .filter(c=>c&&c.trip.minutes<=35)
    .sort((a,b)=>(!!pins[b.p.id]-!!pins[a.p.id])||(must.has(b.p.id)-must.has(a.p.id))||a.trip.minutes-b.trip.minutes||a.end-b.end);
  if(finalCandidates[0]){
    const c=finalCandidates[0];append(last,c,hotel.name);const tr=tokyoTransit(c.p,hotel,data);
    fixed(last,c.end+tr.minutes,c.end+tr.minutes+30,'호텔에서 짐 찾기','보관한 짐을 찾고 공항 이동 준비.',{role:'luggage',trip:{...tr,depart:c.end,arrive:c.end+tr.minutes,origin:(c.p.jp||c.p.name)+' Tokyo',destination:hotel.name}});
  }else if(hotelLeave-checkoutEnd>=45){
    fixed(last,checkoutEnd,Math.min(checkoutEnd+60,hotelLeave-30),'숙소 근처 아침·자유시간','관광을 억지로 넣지 않고 아침과 공항 이동 준비.',{role:'breakfast'});
    fixed(last,hotelLeave-30,hotelLeave,'호텔에서 짐 찾기','보관한 짐을 찾고 공항 이동 준비.',{role:'luggage'});
  }else{
    fixed(last,checkoutEnd,hotelLeave,'아침·공항 이동 준비','이른 귀국편이라 마지막 날 관광은 생략.',{role:'breakfast'});
  }
  fixed(last,hotelLeave,airportAt,(flight.airport==='hnd'?'하네다':'나리타')+'공항으로 이동',airportBack.how,{role:'airport-transfer',trip:{...airportBack,depart:hotelLeave,arrive:airportAt}});
  fixed(last,airportAt,backDep,'공항 체크인·출국','이 여유는 계획용이야. 실제 승차편·터미널·항공사 마감 확인.',{role:'airport'});
  fixed(last,backDep,backArr,'한국으로 출발',flight.backRoute);
  fixed(last,backArr+60,backArr+90,'입국·수하물 후 각자 귀가',flight.airport==='hnd'?'김포 → 성수·수원시청 전철 등. 도착 시각에 맞춰 실제 환승 경로 확인.':flight.id==='late'?'22:40~23:10 승차장 도착 예상. 수원행 막차·좌석 확인이 먼저야.':'성수·수원 방면 공항버스 시간·좌석 확인. 마지막 구간은 택시도 고려.');
  const unplaced=selected.filter(p=>!assigned.has(p.id)).map(p=>({id:p.id,name:p.name,reason:needsRoute(p)?'운항편의 출발·도착 시각과 하선 선착장을 먼저 골라야 해. 도착지가 달라지는 이동이라 일반 관광지처럼 자동 배치하지 않았어.':pins[p.id]&&!dates.includes(pins[p.id])?'지정 날짜가 이번 여행 기간 밖이야.':!dates.some(date=>(!pins[p.id]||pins[p.id]===date)&&tokyoWindow(p,date).length)?'여행일·지정 날짜에는 휴무이거나 행사 기간 밖이야.':pins[p.id]?'지정한 날짜의 영업시간·이동·공항 여유에 맞지 않아.':must.has(p.id)?'꼭 가기로 선택했지만 영업시간·식사·이동 여유 안에 넣지 못했어. 다른 장소를 덜거나 날짜를 지정해봐.':'영업시간과 동선·식사·공항 여유를 함께 맞추다 이번 일정에는 남았어.'}));
  if(outDep<840)warnings.push('선택한 출국편은 한국 출발 14시 이후 조건보다 일러. 항공편 선택을 확인해줘.');
  if(backDep<840)warnings.push('귀국편이 이른 편이라 마지막 날 관광은 거의 넣기 어려워.');
  if(flight.id==='late')warnings.push('인천 21:40 도착편은 수원행 막차와 겹칠 수 있어. 11월 운행 시간표·좌석을 확인하기 전에는 버스 연결을 보장할 수 없어.');
  if(unplaced.some(p=>must.has(p.id)))warnings.push('꼭 가기 장소 중 못 넣은 곳이 있어. 아래 미배치 사유를 확인해줘.');
  warnings.push('이동은 시설·지역 간 거리 기준 추정이야. 실제 철도·버스 경로·시각과 대기열·티켓 재고는 반영하지 않았어.');
  let plan={days,unplaced,warnings,assigned:[...assigned],hotel,flight,createdAt:new Date().toISOString(),signature:tokyoPlanSignature(config),engineVersion:6,airportBuffer,hotelLeave,dayOrder:{},manualOrderPolicy:{dates:dates.slice(1,3),returnBy:1380,reason:'영업시간·점심·저녁과 이동 여유를 다시 계산해. 첫날과 귀국일의 공항·체크인·짐 보관 일정은 고정이야.'}};
  for(const [date,order]of Object.entries(config.dayOrder||{})){
    const reordered=tokyoReorderDay(plan,date,order,data);
    if(reordered.error)plan.warnings.push('수동 순서 · '+date+' · '+reordered.error);else plan=reordered;
  }
  return plan;
}

// Reflow only a full sightseeing day. Flight/airport/luggage rows are never movable.
function tokyoReorderDay(plan,date,orderedIds,data){
  if(plan.engineVersion!==6)return {error:'이전 버전 시간표야. 현재 선택으로 다시 만든 뒤 순서를 조정해줘.',reasonCode:'rebuild-required'};
  const index=plan.days.findIndex(d=>d.date===date);
  if(index!==1&&index!==2)return {error:'순서 조정은 관광하는 11/12·13 일정에서 할 수 있어.'};
  const day=plan.days[index],originalIds=day.rows.filter(r=>r.id).map(r=>r.id);
  if(!Array.isArray(orderedIds)||orderedIds.length!==originalIds.length||new Set(orderedIds).size!==originalIds.length||orderedIds.some(id=>!originalIds.includes(id)))return {error:'그날 배치된 장소 전체를 중복 없이 지정해줘.'};
  const lookup=new Map(day.rows.filter(r=>r.id).map(r=>[r.id,r]));
  const rows=[];let i=0,t=540,from=plan.hotel,origin=plan.hotel.name;
  for(const old of day.rows){
    if(old.role==='return'||old.title==='숙소로 돌아오기'||old.role==='free')continue;
    const r=old.id?lookup.get(orderedIds[i++]):old;
    const role=r.role||(r.item?.kind==='food'?(r.start<900?'lunch':'dinner'):r.item?.kind);
    const earliest=role==='lunch'?690:role==='dinner'?1050:0,deadline=role==='lunch'?870:role==='dinner'?1230:1305,maxStart=role==='lunch'?810:role==='dinner'?1170:1440;
    if(r.item){
      const c=tokyoCandidate(r.item,date,t,from,data,deadline,earliest,maxStart,120);
      if(!c)return {error:r.title+'의 영업시간·식사시간·이동 여유와 맞지 않는 순서야.'};
      rows.push({...r,start:c.start,end:c.end,wait:c.wait,role,trip:{...c.trip,depart:c.depart,arrive:c.arrival,origin,destination:(c.p.jp||c.p.name)+' Tokyo'}});
      t=c.end+10;from=c.p;origin=(c.p.jp||c.p.name)+' Tokyo';
    }else if(role==='lunch'||role==='dinner'){
      const start=Math.max(t,role==='lunch'?720:1080),end=start+(r.end-r.start);
      if(end>deadline)return {error:'식사시간 여유를 지키기 어려운 순서야.'};
      rows.push({...r,start,end,title:data.areas[from.area].name+' '+(role==='lunch'?'점심':'저녁')+' · 미정'});t=end+10;
    }else return {error:'이 일정은 고정 일정이 있어 순서를 바꾸기 어려워.'};
  }
  const tr=tokyoTransit(from,plan.hotel,data),arrival=t+tr.minutes;
  if(arrival+15>1380)return {error:'숙소 복귀가 23시를 넘어 이 순서로 바꿀 수 없어.'};
  rows.push({start:arrival,end:arrival+15,title:'숙소로 돌아오기',desc:'다음 날을 위해 쉬기.',role:'return',trip:{...tr,depart:t,arrive:arrival,origin,destination:plan.hotel.name}});
  const days=plan.days.slice();days[index]={...day,rows};
  const dayOrder={...(plan.dayOrder||plan.manualOrders||{}),[date]:orderedIds.slice()};
  return {...plan,days,dayOrder,manualOrders:dayOrder};
}
function tokyoMoveStop(plan,date,itemId,direction,data){
  const day=plan.days.find(d=>d.date===date);if(!day)return {error:'해당 날짜가 없어.'};
  const order=day.rows.filter(r=>r.id).map(r=>r.id),at=order.indexOf(itemId),delta=direction==='up'?-1:direction==='down'?1:Number(direction);
  if(at<0||![-1,1].includes(delta)||at+delta<0||at+delta>=order.length)return {error:'그 방향으로 옮길 이웃 장소가 없어.'};
  [order[at],order[at+delta]]=[order[at+delta],order[at]];
  return tokyoReorderDay(plan,date,order,data);
}
if(typeof module!=='undefined')module.exports={createTokyoPlan,tokyoClock,tokyoMinutes,tokyoTransit,tokyoAirport,tokyoWindow,tokyoGeo,tokyoReorderDay,tokyoMoveStop,tokyoPlanSignature};
