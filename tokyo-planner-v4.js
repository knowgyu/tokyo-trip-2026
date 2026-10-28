'use strict';
// A local, deterministic planner. No AI service or booking is called.
function tokyoClock(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')}
function tokyoMinutes(s){const p=s.split(':').map(Number);return p[0]*60+p[1]}
function tokyoTransit(a,b,data){
  if(a===b)return {minutes:a==='ueno'?30:20,how:'같은 지역 안에서 도보·역 이동'};
  const aa=data.areas[a],bb=data.areas[b];
  const dx=(aa.point[0]-bb.point[0])*111,dy=(aa.point[1]-bb.point[1])*91;
  const distance=Math.hypot(dx,dy);
  const minutes=Math.min(80,Math.max(25,Math.ceil((20+distance*4)/5)*5));
  return {minutes,how:'철도·도보 · 실제 환승은 지도에서 확인'};
}
function tokyoAirport(f,h,outbound){
  const haneda=f.airport==='hnd';
  const minutes=haneda?(h.area==='ginza'?60:h.area==='akihabara'?70:80):(h.area==='ueno'?95:h.area==='asakusa'?105:h.area==='akihabara'?100:110);
  const how=haneda?'게이큐·도에이선 등 철도 + 도보':h.area==='ginza'?'긴자 방면 공항버스 등 + 도보':h.area==='ueno'?'게이세이선 + 호텔까지 이동':'게이세이·도에이선 계통 등 + 도보';
  return {minutes,how,origin:outbound?h.name:(haneda?'Haneda Airport':'Narita Airport'),destination:outbound?(haneda?'Haneda Airport':'Narita Airport'):h.name};
}
function tokyoWindow(p,date){
  const weekday=new Date(date+'T12:00:00+09:00').getDay();
  if((p.closed||[]).includes(weekday))return [];
  if(p.eventDates&&(date<p.eventDates[0]||date>p.eventDates[1]))return [];
  const close=p.dayClose?.[weekday]||p.close;
  return (p.windows||[[p.open,close]]).map(w=>[w[0],Math.min(w[1],close)]);
}
function createTokyoPlan(config,data){
  const flight=data.flights.find(f=>f.id===config.flight),hotel=data.hotels.find(h=>h.id===config.hotel);
  if(!flight||!hotel)return {error:'항공편과 숙소를 먼저 골라줘.'};
  const selected=data.items.filter(p=>(config.selected||[]).includes(p.id));
  if(!selected.length)return {error:'가고 싶은 장소를 한 곳 이상 담아줘.'};
  const pins=config.pins||{},must=new Set(config.must||[]),assigned=new Set(),warnings=[];
  const dates=data.dates;
  const outDep=tokyoMinutes(flight.out.split(' → ')[0]),outArr=tokyoMinutes(flight.out.split(' → ')[1]);
  const backDep=tokyoMinutes(flight.back.split(' → ')[0]),backArr=tokyoMinutes(flight.back.split(' → ')[1]);
  const airportBack=tokyoAirport(flight,hotel,true),airportIn=tokyoAirport(flight,hotel,false);
  const airportAt=backDep-(flight.airport==='hnd'?160:180),hotelLeave=airportAt-airportBack.minutes;
  const days=dates.map((date,i)=>({date,label:['11/11 수','11/12 목','11/13 금','11/14 토'][i],rows:[],notes:[]}));
  const checkin=outArr+90+airportIn.minutes;
  function fixed(day,start,end,title,desc,extra={}){day.rows.push({start,end,title,desc,...extra})}
  function isAllowed(p,date){return !assigned.has(p.id)&&(!pins[p.id]||pins[p.id]===date)&&tokyoWindow(p,date).length>0}
  function candidate(p,day,t,area,deadline){
    const trip=tokyoTransit(area,p.area,data),arrival=t+trip.minutes;
    for(const [open,close]of tokyoWindow(p,day.date)){
      const start=Math.max(arrival,open),end=start+p.duration;
      if(end>close||end>deadline)continue;
      return {p,start,end,arrival,depart:t,trip,wait:start-arrival};
    }
    return null;
  }
  function append(day,cand,origin){
    const p=cand.p;
    day.rows.push({id:p.id,start:cand.start,end:cand.end,title:p.name,desc:p.desc,item:p,trip:{...cand.trip,depart:cand.depart,arrive:cand.arrival,origin,destination:p.jp+' Tokyo'},wait:cand.wait});
    assigned.add(p.id);
    if(p.reservation)day.notes.push(p.name+' · 시간 지정권·예약은 아직 확보 전이야.');
    if(!p.hoursKnown)day.notes.push(p.name+' · 표시 시각은 가배치. 실제 영업일·시간을 출처에서 확인해야 해.');
  }
  fixed(days[0],outDep-180,outDep,(flight.airport==='hnd'?'김포':'인천')+'공항 체크인·출국','이륙 3시간 전 공항 도착 목표. 성수·수원시청 출발 경로는 각자 지도에서 확인.');
  fixed(days[0],outDep,outArr,'도쿄로 출발',flight.outRoute);
  fixed(days[0],outArr,outArr+90,'입국·수하물','입국 줄과 지연을 고려해 90분 여유.');
  fixed(days[0],checkin,checkin+30,hotel.name+' 체크인','늦은 체크인 가능 여부는 숙소에 확인.',{trip:{...airportIn,depart:outArr+90,arrive:checkin}});
  const lateMeal=selected.filter(p=>isAllowed(p,dates[0])&&p.kind==='food'&&p.area===hotel.area).map(p=>candidate(p,days[0],checkin+30,hotel.area,1380)).filter(Boolean).sort((a,b)=>(must.has(b.p.id)-must.has(a.p.id))||a.end-b.end)[0];
  if(lateMeal)append(days[0],lateMeal,hotel.name);else fixed(days[0],checkin+30,checkin+75,'숙소 근처 늦은 저녁 · 미정','라멘·우동 등 늦게까지 하는 곳으로. 첫날은 식당 예약을 비워두기.');

  // Reserve a short final-morning visit near the hotel, never at the cost of the airport deadline.
  let lastTime=540,lastArea=hotel.area,lastOrigin=hotel.name;
  if(hotelLeave>=690){
    const lastCandidates=selected.filter(p=>isAllowed(p,dates[3])&&(!pins[p.id]||pins[p.id]===dates[3])&&p.open<720&&p.kind!=='food'&&p.duration<=90)
      .map(p=>candidate(p,days[3],540,hotel.area,hotelLeave-30-tokyoTransit(p.area,hotel.area,data).minutes)).filter(Boolean)
      .filter(c=>c.trip.minutes<=35)
      .sort((a,b)=>(!!pins[b.p.id]-!!pins[a.p.id])||a.trip.minutes-b.trip.minutes||a.end-b.end);
    if(lastCandidates[0]){const c=lastCandidates[0];append(days[3],c,lastOrigin);lastTime=c.end;lastArea=c.p.area;lastOrigin=c.p.jp+' Tokyo'}
  }

  for(const di of [1,2]){
    const day=days[di];let t=540,area=hotel.area,origin=hotel.name,group=null;
    function choose(kinds,deadline,earliest=0){
      const options=selected.filter(p=>kinds.includes(p.kind)&&isAllowed(p,day.date)).map(p=>candidate(p,day,Math.max(t,earliest),area,deadline)).filter(Boolean);
      for(const c of options){
        const onlyToday=di===1&&tokyoWindow(c.p,dates[2]).length===0;
        const cross=group&&data.areas[c.p.area].group!==group?45:0;
        c.score=c.trip.minutes+c.wait*.35+cross-(must.has(c.p.id)?75:0)-(pins[c.p.id]===day.date?110:0)-(onlyToday?80:0);
        if(config.weather==='indoor'&&!c.p.indoor)c.score+=18;
      }
      options.sort((a,b)=>a.score-b.score||a.p.id.localeCompare(b.p.id));
      const c=options[0];if(!c)return false;
      append(day,c,origin);t=c.end+10;area=c.p.area;origin=c.p.jp+' Tokyo';group=group||data.areas[area].group;return true;
    }
    // The rhythm is flexible; all named stops come exclusively from the basket.
    choose(['spot'],735);
    if(t<630)choose(['spot','cafe'],735);
    if(!choose(['food'],900,690)){fixed(day,Math.max(t,720),Math.max(t,720)+60,'근처 점심 · 미정','이 동네 식당을 더 담거나 자유롭게 한 끼.');t=Math.max(t,720)+70}
    choose(['spot'],1050);
    choose(['cafe'],1080);
    if(t<930)choose(['spot'],1080);
    if(!choose(['food'],1230,1050)){const tr=tokyoTransit(area,hotel.area,data),arrival=t+tr.minutes;
      if(arrival<1080)fixed(day,arrival,1080,'숙소에서 쉬기','체크인·휴식 후 가까이서 저녁.',{trip:{...tr,depart:t,arrive:arrival,origin,destination:hotel.name}});
      fixed(day,Math.max(arrival,1080),Math.max(arrival,1080)+60,'숙소 근처 저녁 · 미정','이름 있는 식당을 고르지 않은 자유 식사 시간.');t=Math.max(arrival,1080)+70;area=hotel.area;origin=hotel.name;
    }
    choose(['spot'],1320,1020);
    if(origin!==hotel.name){const tr=tokyoTransit(area,hotel.area,data);fixed(day,t+tr.minutes,t+tr.minutes+15,'숙소로 돌아오기','다음 날을 위해 쉬기.',{trip:{...tr,depart:t,arrive:t+tr.minutes,origin,destination:hotel.name}})}
    if(!day.rows.some(r=>r.id))day.notes.push('이 날짜에 넣을 수 있는 담은 장소가 적어. 원하는 지역에서 명소·카페를 더 담아봐.');
  }
  if(days[3].rows.length){const tr=tokyoTransit(lastArea,hotel.area,data);fixed(days[3],lastTime+tr.minutes,lastTime+tr.minutes+30,'호텔에서 짐 찾기','아침 체크아웃 후 보관해둔 짐 찾기.',{trip:{...tr,depart:lastTime,arrive:lastTime+tr.minutes,origin:lastOrigin,destination:hotel.name}})}
  else if(hotelLeave>540)fixed(days[3],Math.min(570,hotelLeave-60),Math.min(630,hotelLeave-20),'숙소 근처 아침·체크아웃','관광을 억지로 넣지 않고 공항 이동 준비.');
  else fixed(days[3],hotelLeave-45,hotelLeave,'아침·체크아웃','이른 귀국편이라 마지막 날 관광은 생략.');
  fixed(days[3],hotelLeave,airportAt,(flight.airport==='hnd'?'하네다':'나리타')+'공항으로 이동',airportBack.how,{trip:{...airportBack,depart:hotelLeave,arrive:airportAt}});
  fixed(days[3],airportAt,backDep,'공항 체크인·출국','실제 승차편·터미널·항공사 마감 확인.');
  fixed(days[3],backDep,backArr,'한국으로 출발',flight.backRoute);
  fixed(days[3],backArr+60,backArr+90,'입국·수하물 후 각자 귀가',flight.airport==='hnd'?'김포 → 성수·수원시청 전철 등. 도착 시각에 맞춰 경로 확인.':flight.id==='late'?'22:40~23:10 승차장 도착 예상. 수원행 막차·좌석 확인이 먼저야.':'성수 6013 / 수원 4000·4100 등. 마지막 구간은 택시도 고려.');
  const unplaced=selected.filter(p=>!assigned.has(p.id)).map(p=>({id:p.id,name:p.name,reason:pins[p.id]?'지정한 날짜의 영업시간·남은 시간에 맞지 않아.':p.closed?.length?'휴무·영업시간과 이동을 함께 맞추다 보니 이번 4일 안에 남았어.':'하루 이동·식사·관람 시간을 넘겨서 남았어. 꼭 가기를 켜거나 다른 곳을 덜어봐.'}));
  if(flight.id==='late')warnings.push('인천 21:40 도착편은 수원행 막차와 겹칠 수 있어. 11/1 개편 후 시간표·좌석을 확인해야 해.');
  warnings.push('이동은 지역 기준 추정이야. 실제 열차·버스 시각, 매장 대기시간, 티켓 재고는 반영하지 않았어.');
  return {days,unplaced,warnings,assigned:[...assigned],hotel,flight,createdAt:new Date().toISOString(),signature:JSON.stringify({flight:config.flight,hotel:config.hotel,selected:[...(config.selected||[])].sort(),pins:config.pins,must:[...(config.must||[])].sort(),weather:config.weather})};
}
if(typeof module!=='undefined')module.exports={createTokyoPlan,tokyoClock,tokyoTransit,tokyoAirport,tokyoWindow};
