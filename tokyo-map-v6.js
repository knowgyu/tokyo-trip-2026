/* Leaflet canvas only. The app owns selection, filters, lists, and place details. */
(() => {
  'use strict';

  const HOME_BOUNDS = [[35.633, 139.681], [35.748, 139.827]];
  const HOME_CENTER = [(HOME_BOUNDS[0][0] + HOME_BOUNDS[1][0]) / 2, (HOME_BOUNDS[0][1] + HOME_BOUNDS[1][1]) / 2];
  const DAY_COLORS = ['#73559b', '#236e64', '#386b98', '#aa512d'];
  const MAIN_AREAS = new Set(['ginza', 'asakusa', 'ueno', 'shibuya', 'aoyama', 'shinjuku', 'marunouchi', 'kiyo', 'komagome']);
  const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const svg = paths => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  const KINDS = {
    airport: {name: '공항', color: '#315a70', icon: svg('<path d="M12 2c-1.1 0-2 1.2-2 2.5V8l-7 4v3l7-2v5l-3 2v2l5-1 5 1v-2l-3-2v-5l7 2v-3l-7-4V4.5C14 3.2 13.1 2 12 2Z"/>')},
    hotel: {name: '숙소', color: '#73559b', icon: svg('<path d="M3 20V7h18v13M3 14h18M7 10h3v4H7m7-4h3v4h-3"/>')},
    food: {name: '식당', color: '#aa512d', icon: svg('<path d="M5 3v6m3-6v6m3-6v6M5 7h6m-3 2v12M19 3c-3 3-3 8 0 9v9m0-18v9"/>')},
    cafe: {name: '카페', color: '#386b98', icon: svg('<path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zm12 1h2a3 3 0 0 1 0 6h-2M7 3v3m5-3v3M3 22h15"/>')},
    spot: {name: '명소', color: '#236e64', icon: svg('<path d="m3 8 9-5 9 5H3zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18"/>')}
  };

  function create({host, data = {}, onFocus, onArea, onViewport} = {}) {
    if (!host || typeof host.getBoundingClientRect !== 'function') throw new TypeError('TokyoMapV6에는 지도 host가 필요합니다.');
    const L = window.L;
    const originalLabel = host.getAttribute('aria-label');
    const originalRole = host.getAttribute('role');
    const originalTabIndex = host.getAttribute('tabindex');
    host.classList.add('tokyo-map-v6');
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', '도쿄 여행 지도. 방향키로 이동하고 더하기·빼기 키로 확대하거나 축소할 수 있습니다. 장소 핀에서 Enter를 누르면 상세를 봅니다.');

    let map = null;
    let destroyed = false;
    let shown = true;
    let frame = null;
    let flushing = false;
    let camera = null;
    let pendingView = {type: 'home'};
    let lastSize = '';
    let viewportSignature = '';
    let clusterFocusKey = null;
    let routeLayer = null;
    let model = {entries: [], airports: [], selectedKeys: new Set(), hotelKey: null, hotelEntry: null, focusedKey: null, route: null, mode: 'all'};
    const cache = new Map();
    const markerRecords = new Map();
    const areaRecords = new Map();
    const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    function normalizeEntry(raw) {
      if (!raw || typeof raw.key !== 'string' || !KINDS[raw.kind]) return null;
      const geo = raw.geo || data.points?.[raw.key];
      const point = geo?.point;
      if (!Array.isArray(point) || point.length < 2 || !point.every(Number.isFinite)) return null;
      return {...raw, geo: {...geo, point: [point[0], point[1]]}};
    }

    function rememberEntry(raw) {
      const entry = normalizeEntry(raw);
      if (entry) cache.set(entry.key, entry);
      return entry;
    }

    const isPrecise = entry => entry.kind === 'airport' || entry.geo.precision === 'venue' || entry.geo.precision === 'airport';
    const airportCode = entry => String(entry.code || entry.iata || entry.id || entry.key.split(':').at(-1)).toUpperCase();

    function selectedHotel() {
      if (!model.hotelKey) return null;
      return (model.hotelEntry?.key === model.hotelKey ? model.hotelEntry : null) || cache.get(model.hotelKey) || normalizeEntry({key: model.hotelKey, kind: 'hotel', name: '선택한 숙소'});
    }

    function rememberCamera() {
      if (!map) return;
      const center = map.getCenter();
      camera = {point: [center.lat, center.lng], zoom: map.getZoom()};
    }

    function notifyViewport() {
      if (!map || !shown || typeof onViewport !== 'function') return;
      const center = map.getCenter();
      const bounds = map.getBounds();
      const viewport = {center: [center.lat, center.lng], zoom: map.getZoom(), bounds: [[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]]};
      const signature = JSON.stringify(viewport);
      if (signature !== viewportSignature) {
        viewportSignature = signature;
        onViewport(viewport);
      }
    }

    function keyboardEvent(event) {
      const native = event?.originalEvent;
      return Boolean(native && (/^key/.test(native.type) || native.detail === 0));
    }

    function focusMarkerElement(key) {
      const record = markerRecords.get(key) || [...markerRecords.values()].find(item => item.descriptor.members?.some(entry => entry.key === key));
      record?.marker.getElement()?.focus({preventScroll: true});
    }

    function makeMap() {
      if (map || !L) return;
      map = L.map(host, {scrollWheelZoom: false, keyboard: true, zoomControl: false, minZoom: 8, maxZoom: 18, zoomSnap: 0.25, zoomAnimation: !reducedMotion(), fadeAnimation: !reducedMotion(), markerZoomAnimation: !reducedMotion()});
      map.setView([35.69, 139.753], 12.25, {animate: false});
      map.createPane('tokyoV6Regions');
      map.getPane('tokyoV6Regions').style.zIndex = '350';
      map.createPane('tokyoV6Routes');
      map.getPane('tokyoV6Routes').style.zIndex = '410';
      routeLayer = L.layerGroup().addTo(map);
      L.tileLayer(data.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, keepBuffer: 1, attribution: data.attribution || ATTRIBUTION}).addTo(map);
      L.control.zoom({zoomInTitle: '지도 확대', zoomOutTitle: '지도 축소'}).addTo(map);
      L.control.scale({imperial: false, maxWidth: 100}).addTo(map);
      map.attributionControl.setPrefix('<a href="https://leafletjs.com/" target="_blank" rel="noopener">Leaflet</a>');
      map.on('zoomend', () => { if (!flushing) schedule(); });
      map.on('moveend', () => {
        rememberCamera();
        if (!flushing) notifyViewport();
      });
    }

    function markerDescriptor(entry, {step = null, dayIndex = null, hotel = false} = {}) {
      const kind = KINDS[entry.kind];
      const airport = entry.kind === 'airport';
      const selected = hotel || airport || model.selectedKeys.has(entry.key);
      const approximate = !isPrecise(entry);
      const focused = model.focusedKey === entry.key;
      const color = dayIndex === null ? kind.color : DAY_COLORS[((dayIndex % DAY_COLORS.length) + DAY_COLORS.length) % DAY_COLORS.length];
      const caption = airport ? airportCode(entry) : approximate ? entry.name + ' · 동네 기준' : hotel ? '숙소 · ' + entry.name : '';
      const classes = ['tm6-pin', entry.kind, selected ? 'is-selected' : '', focused ? 'is-focused' : '', approximate ? 'is-approximate' : '', step !== null ? 'is-step' : ''].filter(Boolean).join(' ');
      const label = [airport ? airportCode(entry) : '', entry.name, kind.name, step !== null ? (dayIndex + 1) + '일차 ' + step + '번째 방문' : '', selected && !airport ? '담은 곳' : '', approximate ? '동네 기준 위치' : '', '상세 보기'].filter(Boolean).join(' · ');
      return {
        id: entry.key, entry, point: entry.geo.point, zIndex: airport ? (focused ? 1800 : 1700) : hotel ? 1600 : focused ? 1500 : selected ? 1100 : 400,
        className: 'tm6-marker', label,
        html: '<span class="' + classes + '" style="--tm6-marker:' + color + '">' + (step === null ? kind.icon : '<span>' + step + '</span>') + '</span>' + (caption ? '<span class="tm6-marker-caption' + (airport ? ' tm6-airport-caption' : '') + '">' + escapeHTML(caption) + '</span>' : ''),
        onClick: event => onFocus?.(entry.key, {keyboard: keyboardEvent(event)})
      };
    }

    function clusterDescriptor(entries) {
      const keys = entries.map(entry => entry.key).sort();
      const point = [entries.reduce((sum, entry) => sum + entry.geo.point[0], 0) / entries.length, entries.reduce((sum, entry) => sum + entry.geo.point[1], 0) / entries.length];
      return {
        id: 'cluster:' + keys.join('|'), members: entries, point, zIndex: 500,
        className: 'tm6-marker tm6-cluster', label: entries.length + '곳이 모여 있습니다. Enter를 누르면 확대합니다.',
        html: '<span class="tm6-cluster-count">' + entries.length + '</span><span class="tm6-cluster-kinds">' + [...new Set(entries.map(entry => entry.kind))].map(kind => '<i style="--tm6-marker:' + KINDS[kind].color + '"></i>').join('') + '</span>',
        onClick(event) {
          if (keyboardEvent(event)) clusterFocusKey = entries[0].key;
          map.setView(point, Math.min(map.getZoom() + 1.5, 17), {animate: false});
        }
      };
    }

    function ordinaryDescriptors(hotel) {
      const descriptors = [];
      const candidates = model.entries.filter(entry => entry.kind !== 'airport' && isPrecise(entry) && entry.key !== hotel?.key);
      const groupedKeys = new Set();
      const standalone = entry => model.focusedKey === entry.key || map.getZoom() >= 16.25 || map.getZoom() >= 11.25 && model.selectedKeys.has(entry.key) || markerRecords.get(entry.key)?.marker.getElement() === document.activeElement;
      for (const entry of candidates) {
        if (groupedKeys.has(entry.key)) continue;
        if (standalone(entry)) {
          groupedKeys.add(entry.key);
          descriptors.push(markerDescriptor(entry));
          continue;
        }
        const point = map.latLngToContainerPoint(entry.geo.point);
        const group = candidates.filter(other => !groupedKeys.has(other.key) && !standalone(other) && map.latLngToContainerPoint(other.geo.point).distanceTo(point) < 34);
        group.forEach(other => groupedKeys.add(other.key));
        descriptors.push(group.length > 1 ? clusterDescriptor(group) : markerDescriptor(entry));
      }
      const approximate = cache.get(model.focusedKey);
      if (approximate && !isPrecise(approximate) && approximate.key !== hotel?.key) descriptors.push(markerDescriptor(approximate));
      return descriptors;
    }

    function routeDescriptors(hotel) {
      const descriptors = [];
      const used = new Set();
      for (const day of model.route?.days || []) {
        const dayIndex = Number.isInteger(day.index) ? day.index : 0;
        const entries = Array.isArray(day.entries) ? day.entries.map(rememberEntry).filter(Boolean) : [];
        let segment = hotel && isPrecise(hotel) ? [hotel.geo.point] : [];
        const drawSegment = () => {
          if (segment.length > 1) L.polyline(segment, {pane: 'tokyoV6Routes', color: DAY_COLORS[((dayIndex % DAY_COLORS.length) + DAY_COLORS.length) % DAY_COLORS.length], weight: 3, dashArray: '6 7', opacity: 0.75, interactive: false}).addTo(routeLayer);
        };
        entries.forEach((entry, index) => {
          if (isPrecise(entry)) segment.push(entry.geo.point);
          else { drawSegment(); segment = []; }
          if (entry.kind === 'airport' || entry.key === hotel?.key || used.has(entry.key)) return;
          if (!isPrecise(entry) && model.focusedKey !== entry.key) return;
          descriptors.push(markerDescriptor(entry, {step: index + 1, dayIndex}));
          used.add(entry.key);
        });
        // Only supplied visits form the line; a return to the hotel must be an actual entry.
        drawSegment();
      }
      return descriptors;
    }

    function syncMarkers(descriptors) {
      const wanted = new Set(descriptors.map(descriptor => descriptor.id));
      for (const [key, record] of markerRecords) {
        if (!wanted.has(key)) {
          record.marker.remove();
          markerRecords.delete(key);
        }
      }
      for (const descriptor of descriptors) {
        let record = markerRecords.get(descriptor.id);
        if (!record) {
          const marker = L.marker(descriptor.point, {keyboard: true, title: descriptor.label, zIndexOffset: descriptor.zIndex, icon: L.divIcon({className: descriptor.className, html: descriptor.html, iconSize: [44, 44], iconAnchor: [22, 22]})}).addTo(map);
          record = {marker, descriptor, html: descriptor.html, className: descriptor.className};
          marker.on('click', event => record.descriptor.onClick(event));
          markerRecords.set(descriptor.id, record);
        } else {
          const oldPoint = record.descriptor.point;
          if (oldPoint[0] !== descriptor.point[0] || oldPoint[1] !== descriptor.point[1]) record.marker.setLatLng(descriptor.point);
          if (record.descriptor.zIndex !== descriptor.zIndex) record.marker.setZIndexOffset(descriptor.zIndex);
          record.descriptor = descriptor;
        }
        const element = record.marker.getElement();
        if (!element) continue;
        // Keep the Leaflet icon element itself: it may currently own keyboard focus.
        if (record.html !== descriptor.html) { element.innerHTML = descriptor.html; record.html = descriptor.html; }
        if (record.className !== descriptor.className) {
          for (const name of record.className.split(' ')) element.classList.remove(name);
          for (const name of descriptor.className.split(' ')) element.classList.add(name);
          record.className = descriptor.className;
        }
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', descriptor.label);
        element.setAttribute('title', descriptor.label);
        element.dataset.tm6MarkerId = descriptor.id;
        if (descriptor.entry) element.dataset.entryKey = descriptor.entry.key;
      }
    }

    function syncAreas() {
      const zoom = map.getZoom();
      const wanted = new Set();
      if (zoom < 14.1) {
        const labels = zoom < 11.25 ? [['all', {name: '도쿄 도심', point: HOME_CENTER}]] : Object.entries(data.areas || {});
        for (const [id, area] of labels) {
          if (!Array.isArray(area.point) || zoom >= 11.25 && zoom < 13.2 && !MAIN_AREAS.has(id)) continue;
          wanted.add(id);
          if (areaRecords.has(id)) continue;
          const label = L.marker(area.point, {pane: 'tokyoV6Regions', keyboard: true, title: area.name + ' 주변 보기', icon: L.divIcon({className: 'tm6-area' + (id === 'all' ? ' tm6-city' : ''), html: '<span>' + escapeHTML(area.name) + '</span>', iconSize: [140, 32], iconAnchor: [70, 16]})}).addTo(map);
          label.on('click', () => onArea?.(id));
          const element = label.getElement();
          element?.setAttribute('role', 'button');
          element?.setAttribute('aria-label', area.name + ' 주변 보기');
          if (element) element.dataset.tm6AreaId = id;
          areaRecords.set(id, label);
        }
      }
      for (const [id, marker] of areaRecords) {
        if (!wanted.has(id)) {
          if (marker.getElement() === document.activeElement) host.focus({preventScroll: true});
          marker.remove();
          areaRecords.delete(id);
        }
      }
    }

    function paint() {
      if (!map || destroyed || !shown) return;
      routeLayer.clearLayers();
      const hotel = selectedHotel();
      const descriptors = model.mode === 'route' ? routeDescriptors(hotel) : ordinaryDescriptors(hotel);
      if (hotel && (isPrecise(hotel) || model.focusedKey === hotel.key)) descriptors.push(markerDescriptor(hotel, {hotel: true}));
      for (const airport of model.airports) descriptors.push(markerDescriptor(airport));
      syncMarkers(descriptors);
      syncAreas();
      if (clusterFocusKey) { focusMarkerElement(clusterFocusKey); clusterFocusKey = null; }
    }

    function applyView(action) {
      if (action.type === 'home') map.fitBounds(HOME_BOUNDS, {padding: [24, 24], maxZoom: 12.6, animate: false});
      else if (action.type === 'focus') map.setView(action.point, action.zoom, {animate: false});
      else if (action.type === 'airports') {
        if (model.airports.length) {
          const points = model.airports.map(entry => entry.geo.point);
          points.push(selectedHotel()?.geo.point || HOME_CENTER);
          map.fitBounds(points, {padding: [54, 54], maxZoom: 11, animate: false});
        } else map.fitBounds(HOME_BOUNDS, {padding: [24, 24], maxZoom: 12.6, animate: false});
      }
      else if (action.type === 'entries') {
        if (action.points.length) map.fitBounds(action.points, {padding: [42, 42], maxZoom: 15.5, animate: false});
        else map.fitBounds(HOME_BOUNDS, {padding: [24, 24], maxZoom: 12.6, animate: false});
      }
    }

    function flush() {
      frame = null;
      if (destroyed || !shown) return;
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (!L) {
        if (!host.querySelector('.tm6-unavailable')) {
          const message = document.createElement('p');
          message.className = 'tm6-unavailable';
          message.textContent = '지도를 불러오지 못했어요. 장소 목록의 구글 지도 링크에서 위치를 볼 수 있어요.';
          host.append(message);
        }
        return;
      }
      flushing = true;
      try {
        makeMap();
        const size = rect.width + ':' + rect.height;
        if (size !== lastSize) {
          const saved = camera && {...camera, point: [...camera.point]};
          map.invalidateSize({pan: false, animate: false});
          if (saved && !pendingView) map.setView(saved.point, saved.zoom, {animate: false});
          lastSize = size;
        }
        if (pendingView) { const action = pendingView; pendingView = null; applyView(action); }
        paint();
        rememberCamera();
      } finally {
        flushing = false;
      }
      notifyViewport();
    }

    function schedule() {
      if (!destroyed && shown && frame === null) frame = requestAnimationFrame(flush);
    }

    function activateFromKeyboard(event) {
      if (destroyed || !shown || !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
      const target = event.target.closest?.('.tm6-marker,.tm6-area');
      if (!target || !host.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const record = markerRecords.get(target.dataset.tm6MarkerId);
      if (record) record.descriptor.onClick({originalEvent: event});
      else if (target.dataset.tm6AreaId) onArea?.(target.dataset.tm6AreaId);
    }

    host.addEventListener('keydown', activateFromKeyboard);

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(host);
    const resizeFallback = () => schedule();
    if (!resizeObserver) window.addEventListener('resize', resizeFallback);

    const controller = {
      show() { if (!destroyed) { shown = true; lastSize = ''; schedule(); } },
      hide() {
        if (destroyed) return;
        rememberCamera();
        shown = false;
        if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
      },
      render(next = {}) {
        if (destroyed) return;
        const entries = Array.isArray(next.entries) ? next.entries.map(rememberEntry).filter(Boolean) : [];
        const airports = new Map((Array.isArray(next.airports) ? next.airports : model.airports).map(raw => rememberEntry({...raw, kind: 'airport'})).filter(Boolean).map(entry => [entry.key, entry]));
        for (const entry of entries) if (entry.kind === 'airport') airports.set(entry.key, entry);
        const hotelEntry = rememberEntry(next.hotelEntry || next.route?.hotelEntry);
        model = {entries, airports: [...airports.values()], selectedKeys: new Set(next.selectedKeys || []), hotelKey: next.hotelKey || hotelEntry?.key || null, hotelEntry, focusedKey: next.focusedKey || null, route: next.route || null, mode: ['all', 'selected', 'route'].includes(next.mode) ? next.mode : 'all'};
        schedule();
      },
      focus(key, {zoom = false} = {}) {
        if (destroyed) return;
        const entry = cache.get(key) || (selectedHotel()?.key === key ? selectedHotel() : null);
        if (!entry) return;
        model.focusedKey = key;
        if (zoom) pendingView = {type: 'focus', point: entry.geo.point, zoom: entry.kind === 'airport' || entry.geo.precision === 'airport' ? 12.5 : isPrecise(entry) ? 15.5 : 14};
        schedule();
      },
      fitAll() { if (!destroyed) { pendingView = {type: 'home'}; schedule(); } },
      fitAirports() { if (!destroyed) { pendingView = {type: 'airports'}; schedule(); } },
      fitEntries(entries) {
        if (destroyed) return;
        pendingView = {type: 'entries', points: (Array.isArray(entries) ? entries : []).map(rememberEntry).filter(Boolean).map(entry => entry.geo.point)};
        schedule();
      },
      fitSelected() {
        if (destroyed) return;
        const entries = [...model.selectedKeys].map(key => cache.get(key)).filter(Boolean);
        const hotel = selectedHotel();
        if (hotel && !entries.some(entry => entry.key === hotel.key)) entries.push(hotel);
        controller.fitEntries(entries);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (frame !== null) cancelAnimationFrame(frame);
        resizeObserver?.disconnect();
        if (!resizeObserver) window.removeEventListener('resize', resizeFallback);
        host.removeEventListener('keydown', activateFromKeyboard);
        map?.remove();
        map = null;
        markerRecords.clear();
        areaRecords.clear();
        cache.clear();
        host.querySelector('.tm6-unavailable')?.remove();
        host.classList.remove('tokyo-map-v6');
        if (originalLabel === null) host.removeAttribute('aria-label'); else host.setAttribute('aria-label', originalLabel);
        if (originalRole === null) host.removeAttribute('role'); else host.setAttribute('role', originalRole);
        if (originalTabIndex === null) host.removeAttribute('tabindex'); else host.setAttribute('tabindex', originalTabIndex);
      }
    };
    schedule();
    return controller;
  }

  window.TokyoMapV6 = {create};
})();
