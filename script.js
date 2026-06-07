const colors = {
  "Hotel":"#111111","Snacks":"#f59e0b","Dinner":"#ef4444","Lunch":"#22c55e",
  "Small bites":"#f97316","Attractions":"#3b82f6","Shopping":"#a855f7"
};

const categoryLabels = {
  "Hotel":"Hotell",
  "Snacks":"Snacks",
  "Dinner":"Middag",
  "Lunch":"Lunsj",
  "Small bites":"Snacks",
  "Attractions":"Attraksjoner",
  "Shopping":"Shopping"
};

function translateCategory(category) {
  return categoryLabels[category] || category;
}

const hotelName = "Renaissance Porto Lapa Hotel";

function generateColor(category) {
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = ((hash << 5) - hash) + category.charCodeAt(i);
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 72%, 52%)`;
}

function getColorFor(category) {
  if (!colors[category]) colors[category] = generateColor(category);
  return colors[category];
}
const selectedStops = new Set();
let origin = null;
let originIsUser = false;
let originMarker = null;
let userRoute = null;
let currentRoute = null;
let activeRouteName = null;
let activeRouteStops = null;
let labelsEnabled = false;

const map = L.map("map").setView([41.147, -8.612], 14);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const statusEl = document.getElementById("status");
const groups = {};
const markersByName = {};

function iconFor(category, selected = false) {
  return L.divIcon({
    className: "",
    html: `<div class="pin${selected ? ' selected' : ''}" style="background:${getColorFor(category)}"></div>`,
    iconSize:[24,24],
    iconAnchor:[12,12]
  });
}

function locationIcon() {
  return L.divIcon({
    className: "",
    html: `<div class="pin current"></div>`,
    iconSize:[24,24],
    iconAnchor:[12,12]
  });
}

function getContrastText(hex) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0,2), 16);
  const g = parseInt(c.substring(2,4), 16);
  const b = parseInt(c.substring(4,6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? "#111" : "#fff";
}

const isTouchDevice = ('ontouchstart' in window || navigator.maxTouchPoints > 0);

function tooltipOptions() {
  return {
    permanent: labelsEnabled,
    direction: 'top',
    offset: [0, -10],
    sticky: !labelsEnabled,
    className: 'placeTooltip'
  };
}

function refreshTooltips() {
  const routeNames = activeRouteName ? new Set(window.ROUTES[activeRouteName] || []) : activeRouteStops ? activeRouteStops : null;
  Object.values(markersByName).forEach(marker => {
    if (!marker) return;
    const label = marker.placeName || '';
    marker.unbindTooltip();
    marker.bindTooltip(label, tooltipOptions());

    if (labelsEnabled) {
      const matchesRoute = !routeNames || routeNames.has(marker.placeName);
      const isVisible = marker._icon ? marker._icon.style.display !== 'none' : true;
      if (matchesRoute && isVisible) marker.openTooltip();
      else marker.closeTooltip();
    } else {
      marker.closeTooltip();
    }
  });
  updateLabelToggleButton();
}

function updateLabelToggleButton() {
  const checkbox = document.getElementById('toggleLabels');
  const labelText = document.querySelector('.toggleControl-text');
  const label = document.querySelector('.toggleControl');
  if (!checkbox || !labelText || !label) return;
  checkbox.checked = labelsEnabled;
  labelText.textContent = labelsEnabled ? 'Skjul navn' : 'Vis navn';
  label.classList.toggle('active', labelsEnabled);
}

function distanceMeters(a, b) {
  const toRad = x => x * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat/2);
  const sinDLon = Math.sin(dLon/2);
  const aVal = sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1-aVal));
  return R * c;
}

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function updateRoutePanel() {
  const selected = Array.from(selectedStops);
  const routeInfo = document.getElementById("routeInfo");
  const selectedEl = document.getElementById("selectedStops");
  const distanceInfo = document.getElementById("distanceInfo");
  routeInfo.textContent = origin ? `Start: ${originIsUser ? "Din posisjon" : origin.name}` : "Start: Hotellet";
  
  if (selected.length && origin) {
    const stops = selected
      .map(name => markersByName[name])
      .filter(Boolean)
      .map(marker => ({
        name: marker.placeName,
        lat: marker.getLatLng().lat,
        lon: marker.getLatLng().lng
      }));
    const ordered = orderStopsByNearest(origin, stops);
    selectedEl.innerHTML = ordered.length
      ? ordered.map(stop => `<div class="selectedStop" style="background:#0ea5e9; color:white;">${stop.name}</div>`).join("")
      : "Ingen stopp valgt ennå.";
    if (!selected.length) {
      distanceInfo.textContent = "Velg stopp og trykk Vis beste rute.";
    } else {
      distanceInfo.textContent = `Valgt: ${ordered.length} stopp. Trykk Vis beste rute.`;
    }
  } else {
    selectedEl.innerHTML = "Ingen stopp valgt ennå.";
    distanceInfo.textContent = "Velg stopp og trykk Vis beste rute.";
  }
}

function orderStopsByNearest(start, stops) {
  const ordered = [];
  let current = { lat: start.lat, lon: start.lon };
  const remaining = stops.slice();
  while (remaining.length) {
    let bestIndex = 0;
    let bestDist = distanceMeters(current, remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
      const d = distanceMeters(current, remaining[i]);
      if (d < bestDist) { bestDist = d; bestIndex = i; }
    }
    const next = remaining.splice(bestIndex, 1)[0];
    ordered.push(next);
    current = { lat: next.lat, lon: next.lon };
  }
  return ordered;
}

function renderUserRoute() {
  if (userRoute) { map.removeLayer(userRoute); userRoute = null; }
  if (currentRoute) { map.removeLayer(currentRoute); currentRoute = null; }
  activeRouteName = null;
  activeRouteStops = selectedStops.size ? new Set(selectedStops) : null;
  buildPanel();
  const selected = Array.from(selectedStops)
    .map(name => markersByName[name])
    .filter(Boolean);
  if (!selected.length || !origin) {
    if (labelsEnabled) refreshTooltips();
    return;
  }
  const stopPoints = selected.map(marker => ({
    name: marker.placeName,
    lat: marker.getLatLng().lat,
    lon: marker.getLatLng().lng
  }));
  const ordered = orderStopsByNearest(origin, stopPoints);
  const coords = [[origin.lat, origin.lon], ...ordered.map(p => [p.lat, p.lon])];
  userRoute = L.polyline(coords, { color: '#0ea5e9', weight: 5, opacity: 0.9, dashArray: '8,6' }).addTo(map);
  map.fitBounds(userRoute.getBounds(), { padding: [40, 40] });
  let total = 0;
  let current = origin;
  ordered.forEach(point => {
    total += distanceMeters(current, point);
    current = point;
  });
  document.getElementById("distanceInfo").textContent = `Beste rute: ${formatDistance(total)} for ${ordered.length} stopp.`;
  if (labelsEnabled) refreshTooltips();
}

function setDefaultOrigin() {
  originIsUser = false;
  if (markersByName[hotelName]) {
    const hotel = markersByName[hotelName].getLatLng();
    origin = { name: hotelName, lat: hotel.lat, lon: hotel.lng };
    if (originMarker) { map.removeLayer(originMarker); originMarker = null; }
    updateRoutePanel();
    renderUserRoute();
  }
}

function setUserOrigin(lat, lon) {
  originIsUser = true;
  origin = { name: "Your location", lat, lon };
  if (originMarker) map.removeLayer(originMarker);
  originMarker = L.marker([lat, lon], { icon: locationIcon() })
    .addTo(map)
    .bindPopup("You are here");
  originMarker.openPopup();
  updateRoutePanel();
  renderUserRoute();
}

function buildPopup(place) {
  const distanceText = origin ? formatDistance(distanceMeters(origin, { lat: place.lat, lon: place.lon })) : "ukjent";
  const buttonText = selectedStops.has(place.name) ? "Fjern fra ruta" : "Legg til i ruta";
  const originText = origin ? (originIsUser ? "din posisjon" : origin.name) : "hotellet";
  return `
      <div class="popup-title">${place.name}</div>
      <div>${translateCategory(place.category)} · fra hotellet: <b>${place.fromHotel}</b></div>
      <div class="small">${place.note || ""}</div>
      <div class="small">Avstand fra ${originText}: <b>${distanceText}</b></div>
      <p>
        <button onclick="toggleStop('${place.name.replaceAll("'", "\\'")}')">${buttonText}</button>
        <br>
        <a target="_blank" href="${directionsUrl(place.name)}">Åpne gangrute</a><br>
        <a target="_blank" href="${searchUrl(place.name)}">Åpne i Google Maps</a>
      </p>
    `;
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function setMarkerVisible(marker, visible) {
  if (marker._icon) {
    marker._icon.style.display = visible ? '' : 'none';
  }
  if (marker._shadow) {
    marker._shadow.style.display = visible ? '' : 'none';
  }
}

function updateMarkers() {
  const query = document.getElementById('searchBox').value.trim().toLowerCase();
  window.PLACES.forEach(place => {
    const marker = markersByName[place.name];
    const group = groups[place.category];
    if (!marker || !group) return;

    const categoryVisible = map.hasLayer(group);
    const matchesSearch = !query || place.name.toLowerCase().includes(query) || place.category.toLowerCase().includes(query) || place.note.toLowerCase().includes(query);
    const shouldShow = categoryVisible && matchesSearch;

    setMarkerVisible(marker, shouldShow);
    marker._matchesSearch = matchesSearch;
  });
  if (labelsEnabled) refreshTooltips();
}

function refreshSelectedMarkers() {
  Object.values(markersByName).forEach(marker => {
    if (!marker || !marker.placeCategory) return;
    const selected = selectedStops.has(marker.placeName);
    marker.setIcon(iconFor(marker.placeCategory, selected));
  });
}

function toggleStop(placeName) {
  if (selectedStops.has(placeName)) selectedStops.delete(placeName);
  else selectedStops.add(placeName);
  activeRouteName = null;
  activeRouteStops = null;
  refreshSelectedMarkers();
  updateRoutePanel();
  const marker = markersByName[placeName];
  if (marker && marker.isPopupOpen()) {
    const place = window.PLACES.find(p => p.name === placeName);
    if (place) marker.setPopupContent(buildPopup(place));
  }
  if (labelsEnabled) refreshTooltips();
}

function directionsUrl(placeName) {
  return "https://www.google.com/maps/dir/?api=1&destination=" +
         encodeURIComponent(placeName) + "&travelmode=walking";
}

function searchUrl(placeName) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(placeName);
}

async function addPlace(place, i, total) {
  statusEl.textContent = `Legger til pin ${i + 1}/${total}: ${place.name}`;

  if (!groups[place.category]) groups[place.category] = L.layerGroup().addTo(map);
  if (typeof place.lat !== 'number' || typeof place.lon !== 'number') {
    console.warn(`Missing static coordinates for ${place.name}`);
    statusEl.textContent = `Mangler koordinater for ${place.name}. Hopper over.`;
    return;
  }

  const marker = L.marker([place.lat, place.lon], { icon: iconFor(place.category) });
  marker.placeName = place.name;
  marker.placeCategory = place.category;
  marker._matchesSearch = true;
  marker.bindPopup(buildPopup(place));
  marker.bindTooltip(place.name, tooltipOptions());
  marker.on('click', () => {
    if (!labelsEnabled) marker.openTooltip();
  });
  marker.on('popupopen', () => marker.setPopupContent(buildPopup(place)));
  marker.addTo(groups[place.category]);
  markersByName[place.name] = marker;
}

function showRoute(routeName) {
  if (userRoute) { map.removeLayer(userRoute); userRoute = null; }
  if (currentRoute) map.removeLayer(currentRoute);

  selectedStops.clear();
  refreshSelectedMarkers();

  if (activeRouteName === routeName) {
    activeRouteName = null;
    activeRouteStops = null;
    buildPanel();
    if (labelsEnabled) refreshTooltips();
    return;
  }

  activeRouteName = routeName;
  activeRouteStops = null;
  buildPanel();
  const coords = (window.ROUTES[routeName] || [])
    .map(name => markersByName[name])
    .filter(Boolean)
    .map(marker => marker.getLatLng());

  if (coords.length < 2) return alert("Ruten lastes fortsatt. Prøv igjen om et øyeblikk.");
  currentRoute = L.polyline(coords, { weight:5, opacity:.85 }).addTo(map);
  map.fitBounds(currentRoute.getBounds(), { padding:[40,40] });
  refreshTooltips();
}

function buildPanel() {
  document.getElementById("routes").innerHTML = Object.keys(window.ROUTES).map(route => {
    const active = activeRouteName === route;
    const label = active ? 'Fjern rute' : 'Vis rute';
    return `<div class="routeBox"><b>${route}</b><br><button class="${active ? 'active' : ''}" onclick="showRoute('${route.replaceAll("'", "\\'")}')">${label}</button></div>`;
  }).join("");

  const categories = Array.from(new Set(window.PLACES.map(place => place.category).concat(Object.keys(colors))));
  document.getElementById("filters").innerHTML = categories.map(cat => {
    const color = getColorFor(cat);
    return `<button class="active" id="btn-${slugify(cat)}" onclick="toggleCategory('${cat}')" style="background:${color}; color:${getContrastText(color)}">${translateCategory(cat)}</button>`;
  }).join("");

  // Ensure all groups exist, even if they have no places
  categories.forEach(cat => {
    if (!groups[cat]) {
      groups[cat] = L.layerGroup().addTo(map);
    }
  });

  updateRoutePanel();
}

function toggleCategory(cat) {
  const group = groups[cat];
  if (!group) return;
  const btn = document.getElementById("btn-" + slugify(cat));
  if (map.hasLayer(group)) {
    map.removeLayer(group);
    btn.classList.remove("active");
  } else {
    group.addTo(map);
    btn.classList.add("active");
  }
  window.PLACES.filter(p => p.category === cat).forEach(place => {
    const marker = markersByName[place.name];
    if (marker) {
      const shouldShow = marker._matchesSearch !== false && map.hasLayer(group);
      setMarkerVisible(marker, shouldShow);
    }
  });
  if (labelsEnabled) refreshTooltips();
}

document.getElementById("clearCache").onclick = () => location.reload();

  document.getElementById("locateMe").onclick = () => {
    if (!navigator.geolocation) {
      statusEl.textContent = "Geolokalisering støttes ikke av denne nettleseren.";
      return;
    }
    statusEl.textContent = "Lokaliserer...";
    navigator.geolocation.getCurrentPosition(position => {
      setUserOrigin(position.coords.latitude, position.coords.longitude);
      statusEl.textContent = "Bruker din nåværende posisjon.";
    }, () => {
      statusEl.textContent = "Klarer ikke hente posisjonen din.";
    }, { enableHighAccuracy: true, timeout: 15000 });
  };

  document.getElementById("resetOrigin").onclick = () => {
    setDefaultOrigin();
    statusEl.textContent = "Startpunkt satt til hotellet.";
  };

  document.getElementById("showBestRoute").onclick = () => {
    if (!selectedStops.size) {
      statusEl.textContent = "Velg minst ett stopp.";
      return;
    }
    renderUserRoute();
  };

  const toggleLabelsInput = document.getElementById("toggleLabels");
  if (toggleLabelsInput) {
    toggleLabelsInput.onchange = (event) => {
      labelsEnabled = event.target.checked;
      refreshTooltips();
    };
  }

  document.getElementById("clearStops").onclick = () => {
    selectedStops.clear();
    activeRouteName = null;
    activeRouteStops = null;
    refreshSelectedMarkers();
    updateRoutePanel();
    if (userRoute) { map.removeLayer(userRoute); userRoute = null; }
    if (labelsEnabled) refreshTooltips();
    statusEl.textContent = "Valgte stopp er fjernet.";
  };

  document.getElementById("searchBox").oninput = () => {
    updateMarkers();
  };

  (async function init() {
    buildPanel();
    updateLabelToggleButton();
    const bounds = [];
    for (let i = 0; i < window.PLACES.length; i++) {
      try {
        await addPlace(window.PLACES[i], i, window.PLACES.length);
        bounds.push([window.PLACES[i].lat, window.PLACES[i].lon]);
      } catch (e) {
        console.warn(e);
      }
    }
    if (bounds.length) map.fitBounds(bounds, { padding:[35,35] });
    setDefaultOrigin();
    // Force all markers visible after load
    window.PLACES.forEach(place => {
      const marker = markersByName[place.name];
      if (marker) {
        marker._matchesSearch = true;
        setMarkerVisible(marker, true);
      }
    });
    updateMarkers();
    statusEl.textContent = "Ingen informasjon enda, kjem her om det er noke...";
  })();
