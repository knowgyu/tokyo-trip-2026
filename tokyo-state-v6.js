/* Selection files and shared links use the same validated schema. No booking is made. */
'use strict';
const TokyoStateV6=(()=>{
  const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const bounded=(v,fallback,min=0,max=1000000)=>Number.isFinite(Number(v))&&v!==null&&v!==''?Math.min(max,Math.max(min,Math.round(Number(v)))):fallback;
  function defaults(){return {flight:null,hotel:null,selected:[],must:[],pins:{},weather:'balanced',foodBudget:70000,travelBudget:80000,ticketBudget:50000,extraBudget:100000,dayOrder:{},plan:null};}
  function normalise(raw,data){
    const s=isObject(raw)?raw:{};
    const items=new Set(data.items.map(p=>p.id)),dates=new Set(data.dates);
    const unique=values=>Array.isArray(values)?[...new Set(values.filter(id=>typeof id==='string'&&items.has(id)))]:[];
    const result=defaults();
    result.flight=data.flights.some(f=>f.id===s.flight)?s.flight:null;
    result.hotel=data.hotels.some(h=>h.id===s.hotel)?s.hotel:null;
    result.selected=unique(s.selected);
    const chosen=new Set(result.selected);
    result.must=unique(s.must).filter(id=>chosen.has(id));
    if(isObject(s.pins))for(const id of result.selected)if(dates.has(s.pins[id]))result.pins[id]=s.pins[id];
    result.weather=s.weather==='indoor'?'indoor':'balanced';
    for(const field of ['foodBudget','travelBudget','ticketBudget','extraBudget'])result[field]=bounded(s[field],result[field]);
    if(isObject(s.dayOrder))for(const date of data.dates){const ids=unique(s.dayOrder[date]).filter(id=>chosen.has(id));if(ids.length)result.dayOrder[date]=ids;}
    return result;
  }
  function signature(s){return JSON.stringify({flight:s.flight,hotel:s.hotel,selected:[...s.selected].sort(),pins:s.pins,must:[...s.must].sort(),weather:s.weather});}
  function selection(s){return {flight:s.flight,hotel:s.hotel,selected:[...s.selected],must:[...s.must],pins:{...s.pins},weather:s.weather,foodBudget:s.foodBudget,travelBudget:s.travelBudget,ticketBudget:s.ticketBudget,extraBudget:s.extraBudget,dayOrder:JSON.parse(JSON.stringify(s.dayOrder||{}))};}
  function readStorage(storage,key,data){try{const value=JSON.parse(storage.getItem(key)||'{}');return {state:normalise(value,data),hadPlan:isObject(value?.plan)&&Array.isArray(value.plan.days),error:null};}catch(e){return {state:defaults(),hadPlan:false,error:'저장한 선택을 읽지 못했어. 저장 파일이 있으면 불러올 수 있어.'};}}
  function saveStorage(storage,key,state){try{storage.setItem(key,JSON.stringify({...selection(state),plan:state.plan}));return null;}catch(e){return '선택을 브라우저에 저장하지 못했어. 파일 저장으로 남겨줘.';}}
  function exportFile(state,data){return {version:2,trip:{dates:[...data.dates],adults:2,rooms:1},selection:selection(state),plan:state.plan};}
  function importFile(value,data){
    if(!isObject(value)||!isObject(value.selection))return {error:'이 여행 수첩에서 저장한 JSON 파일을 골라줘.'};
    const state=normalise(value.selection,data);
    return {state,hadPlan:isObject(value.plan)&&Array.isArray(value.plan.days),error:null};
  }
  function encodeText(text){
    if(typeof Buffer!=='undefined')return Buffer.from(text,'utf8').toString('base64url');
    const bytes=new TextEncoder().encode(text);let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function decodeText(token){
    if(typeof Buffer!=='undefined')return Buffer.from(token,'base64url').toString('utf8');
    const binary=atob(token.replace(/-/g,'+').replace(/_/g,'/'));return new TextDecoder().decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));
  }
  function shareToken(state,data){const s=selection(state);return encodeText(JSON.stringify({v:1,d:data.dates[0],f:s.flight,h:s.hotel,s:s.selected,m:s.must,p:s.pins,w:s.weather,b:[s.foodBudget,s.travelBudget,s.ticketBudget,s.extraBudget],o:s.dayOrder}));}
  function parseShare(token,data){
    try{
      if(typeof token!=='string'||token.length>12000||!/^[A-Za-z0-9_-]+$/.test(token))throw Error('format');
      const p=JSON.parse(decodeText(token));if(!isObject(p)||p.v!==1)throw Error('version');
      const state=normalise({flight:p.f,hotel:p.h,selected:p.s,must:p.m,pins:p.p,weather:p.w,foodBudget:p.b?.[0],travelBudget:p.b?.[1],ticketBudget:p.b?.[2],extraBudget:p.b?.[3],dayOrder:p.o},data);
      return {state,dateMismatch:p.d!==data.dates[0],error:null};
    }catch(e){return {error:'공유 링크를 읽지 못했어. 링크 전체를 다시 복사해서 열어줘.'};}
  }
  function totalBudget(state,data){
    const flight=data.flights.find(f=>f.id===state.flight),hotel=data.hotels.find(h=>h.id===state.hotel);
    const parts={flight:flight?.fare||0,hotel:hotel?.price||0,food:state.foodBudget*data.dates.length*2,travel:state.travelBudget*2,tickets:state.ticketBudget*2,extra:state.extraBudget};
    return {parts,total:Object.values(parts).reduce((a,b)=>a+b,0),complete:!!(flight&&hotel),unknownFees:!!hotel?.unknownFees};
  }
  return {isObject,defaults,normalise,signature,selection,readStorage,saveStorage,exportFile,importFile,shareToken,parseShare,totalBudget,bounded};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=TokyoStateV6;
