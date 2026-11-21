/**
 * @file Nearby Clinic Finder component.
 * Uses OpenStreetMap + Overpass API via backend proxy.
 * Features: geolocation, nearby search, type filter, radius selector, map view.
 */
import { $, $$, showToast, escapeHtml as h } from '../utils/helpers.js';
import * as backend from '../services/backend.js';
import { t, currentLang } from '../i18n.js';

const TYPE_LABELS = {
  clinic: 'Clinic',
  hospital: 'Hospital',
  pharmacy: 'Pharmacy',
  emergency: 'Emergency Care'
};

const TYPE_ICONS = {
  clinic: 'fa-clinic-medical',
  hospital: 'fa-hospital',
  pharmacy: 'fa-prescription-bottle-medical',
  emergency: 'fa-ambulance'
};

const RADIUS_OPTIONS = [
  { value: 1000, label: '1 km' },
  { value: 3000, label: '3 km' },
  { value: 5000, label: '5 km' },
  { value: 10000, label: '10 km' }
];

let map = null;
let markers = [];
let userMarker = null;
let currentLat = null;
let currentLon = null;
let watchId = null;

function createMap(lat, lon) {
  if (typeof L === 'undefined') {
    console.warn('Leaflet not loaded');
    return null;
  }

  const container = $('#clinicMap');
  if (!container) return null;

  // Clear any existing map
  if (map) {
    map.remove();
    map = null;
  }

  container.innerHTML = '';
  map = L.map('clinicMap', {
    center: [lat, lon],
    zoom: 14,
    zoomControl: true,
    attributionControl: true
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  return map;
}

function addUserMarker(lat, lon) {
  if (!map) return;
  if (userMarker) map.removeLayer(userMarker);

  userMarker = L.circleMarker([lat, lon], {
    radius: 10,
    fillColor: '#2563eb',
    color: '#fff',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.9
  }).addTo(map);

  userMarker.bindPopup('<strong>Your Location</strong>').openPopup();
}

function addPlaceMarkers(places) {
  if (!map) return;

  // Clear existing markers
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  const typeColors = {
    clinic: '#16a34a',
    hospital: '#dc2626',
    pharmacy: '#2563eb',
    emergency: '#ea580c'
  };

  places.forEach(place => {
    const color = typeColors[place.type] || '#6b7280';
    const marker = L.circleMarker([place.latitude, place.longitude], {
      radius: 8,
      fillColor: color,
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(map);

    const popupContent = `
      <div class="place-popup">
        <strong>${h(place.name)}</strong>
        <div class="place-popup-type"><i class="fas ${TYPE_ICONS[place.type]}" aria-hidden="true"></i> ${h(TYPE_LABELS[place.type])}</div>
        <div class="place-popup-address">${h(place.address)}</div>
        <div class="place-popup-distance">${Math.round(place.distance / 100) / 10} km away</div>
        <a href="${h(place.directions_url)}" target="_blank" rel="noopener noreferrer" class="place-popup-directions">
          <i class="fas fa-directions" aria-hidden="true"></i> Get Directions
        </a>
      </div>
    `;
    marker.bindPopup(popupContent);
    markers.push(marker);
  });

  // Fit bounds to show all markers + user location
  if (markers.length > 0) {
    const group = new L.featureGroup([userMarker, ...markers]);
    map.fitBounds(group.getBounds().pad(0.1));
  }
}

function renderPlaceList(places) {
  const container = $('#clinicList');
  if (!container) return;

  if (!places.length) {
    container.innerHTML = `<div class="clinic-empty"><i class="fas fa-map-marker-alt" aria-hidden="true"></i><p>No ${h(TYPE_LABELS[currentType])}s found within ${currentRadius / 1000} km.</p></div>`;
    return;
  }

  container.innerHTML = places.map(place => `
    <article class="clinic-card" data-lat="${place.latitude}" data-lon="${place.longitude}">
      <div class="clinic-icon" style="background: ${getTypeColor(place.type)}">
        <i class="fas ${TYPE_ICONS[place.type]}" aria-hidden="true"></i>
      </div>
      <div class="clinic-info">
        <h4>${h(place.name)}</h4>
        <div class="clinic-meta">
          <span class="clinic-type"><i class="fas ${TYPE_ICONS[place.type]}" aria-hidden="true"></i> ${h(TYPE_LABELS[place.type])}</span>
          <span class="clinic-distance">${Math.round(place.distance / 100) / 10} km</span>
        </div>
        <p class="clinic-address">${h(place.address)}</p>
        <a href="${h(place.directions_url)}" target="_blank" rel="noopener noreferrer" class="clinic-directions">
          <i class="fas fa-directions" aria-hidden="true"></i> Directions
        </a>
      </div>
    </article>
  `).join('');
}

function getTypeColor(type) {
  const colors = {
    clinic: '#16a34a',
    hospital: '#dc2626',
    pharmacy: '#2563eb',
    emergency: '#ea580c'
  };
  return colors[type] || '#6b7280';
}

let currentType = 'clinic';
let currentRadius = 5000;
let isSearching = false;

async function searchNearby() {
  if (isSearching || currentLat === null || currentLon === null) return;

  isSearching = true;
  const btn = $('#searchClinicsBtn');
  const originalText = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Searching...';
  }

  $('#clinicList').innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Searching...</div>';
  $('#clinicMap').innerHTML = '<div class="loading-map"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading map...</div>';

  try {
    const data = await backend.api('/api/places/nearby', {
      method: 'GET',
      auth: backend.isOnline()  // Only auth if online
    }, { latitude: currentLat, longitude: currentLon, radius: currentRadius, type: currentType });

    renderPlaceList(data.places || []);
    createMap(currentLat, currentLon);
    addUserMarker(currentLat, currentLon);
    addPlaceMarkers(data.places || []);

    if (data.places?.length) {
      showToast(`Found ${data.places.length} ${TYPE_LABELS[currentType].toLowerCase()}(s) nearby`, 'success');
    } else {
      showToast(`No ${TYPE_LABELS[currentType].toLowerCase()}s found within ${currentRadius / 1000} km`, 'info');
    }
  } catch (err) {
    console.error('Places search error:', err);
    showToast(err.message || 'Failed to search nearby places. Please try again.', 'error');
    $('#clinicList').innerHTML = `<div class="clinic-error"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><p>Failed to load places. ${h(err.message || 'Please try again.')}</p></div>`;
    $('#clinicMap').innerHTML = '<div class="map-error">Map unavailable</div>';
  } finally {
    isSearching = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

function getCurrentLocation() {
  const btn = $('#locateBtn');
  const originalText = btn?.innerHTML;

  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Locating...';
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      currentLat = position.coords.latitude;
      currentLon = position.coords.longitude;

      // Update UI
      $('#currentLocation').textContent = `${currentLat.toFixed(4)}, ${currentLon.toFixed(4)}`;
      $('#currentLocation').setAttribute('aria-label', `Current location: latitude ${currentLat.toFixed(4)}, longitude ${currentLon.toFixed(4)}`);

      // Create/update map
      createMap(currentLat, currentLon);
      addUserMarker(currentLat, currentLon);

      // Auto-search
      searchNearby();

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }

      showToast('Location found! Searching nearby...', 'success');
    },
    (error) => {
      let message = 'Could not get your location. ';
      if (error.code === error.PERMISSION_DENIED) {
        message += 'Please enable location permission in browser settings.';
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        message += 'Location information is unavailable.';
      } else if (error.code === error.TIMEOUT) {
        message += 'Location request timed out.';
      }
      showToast(message, 'error');

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 300000
    }
  );
}

function initTypeFilter() {
  const container = $('#typeFilter');
  if (!container) return;

  container.innerHTML = Object.entries(TYPE_LABELS).map(([key, label]) => `
    <button type="button" class="type-chip${key === currentType ? ' active' : ''}" data-type="${key}" aria-pressed="${key === currentType}">
      <i class="fas ${TYPE_ICONS[key]}" aria-hidden="true"></i> ${h(label)}
    </button>
  `).join('');

  container.querySelectorAll('.type-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      currentType = btn.dataset.type;
      container.querySelectorAll('.type-chip').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', b === btn);
      });
      if (!isSearching && currentLat !== null) searchNearby();
    });
  });
}

function initRadiusSelector() {
  const select = $('#radiusSelect');
  if (!select) return;

  select.innerHTML = RADIUS_OPTIONS.map(opt => `
    <option value="${opt.value}"${opt.value === currentRadius ? ' selected' : ''}>${h(opt.label)}</option>
  `).join('');

  select.addEventListener('change', () => {
    currentRadius = parseInt(select.value, 10);
    if (!isSearching && currentLat !== null) searchNearby();
  });
}

function initWatchPosition() {
  if (!navigator.geolocation) return;

  // Watch for location changes (optional, for real-time updates)
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const newLat = position.coords.latitude;
      const newLon = position.coords.longitude;

      // Only update if moved significantly (> 100m)
      if (currentLat && currentLon) {
        const R = 6371000;
        const lat1 = currentLat * Math.PI / 180;
        const lat2 = newLat * Math.PI / 180;
        const dLat = (newLat - currentLat) * Math.PI / 180;
        const dLon = (newLon - currentLon) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2)**2;
        const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        if (distance > 100) {
          currentLat = newLat;
          currentLon = newLon;
          $('#currentLocation').textContent = `${currentLat.toFixed(4)}, ${currentLon.toFixed(4)}`;
          if (map) {
            map.setView([currentLat, currentLon]);
            addUserMarker(currentLat, currentLon);
          }
        }
      } else {
        currentLat = newLat;
        currentLon = newLon;
        $('#currentLocation').textContent = `${currentLat.toFixed(4)}, ${currentLon.toFixed(4)}`;
      }
    },
    (error) => console.warn('Watch position error:', error),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

export function initClinicFinder() {
  // Check if we're on the clinic finder page
  const page = $('#pageClinic');
  if (!page || page.hidden) return;

  // Initialize UI
  initTypeFilter();
  initRadiusSelector();

  // Event listeners
  $('#locateBtn')?.addEventListener('click', getCurrentLocation);
  $('#searchClinicsBtn')?.addEventListener('click', searchNearby);

  // Keyboard support for locate button
  $('#locateBtn')?.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      getCurrentLocation();
    }
  });

  // Initialize map placeholder
  $('#clinicMap').innerHTML = '<div class="map-placeholder"><i class="fas fa-map-marker-alt" aria-hidden="true"></i><p>Click "Find My Location" to start</p></div>';

  // Try to restore last known location from storage
  const stored = localStorage.getItem('mediguide_last_location');
  if (stored) {
    try {
      const { lat, lon, timestamp } = JSON.parse(stored);
      // Use if less than 1 hour old
      if (Date.now() - timestamp < 3600000) {
        currentLat = lat;
        currentLon = lon;
        $('#currentLocation').textContent = `${currentLat.toFixed(4)}, ${currentLon.toFixed(4)}`;
        createMap(currentLat, currentLon);
        addUserMarker(currentLat, currentLon);
        searchNearby();
      }
    } catch { /* ignore */ }
  }

  // Start watching position for updates
  initWatchPosition();
}

export function destroyClinicFinder() {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (map) {
    map.remove();
    map = null;
  }
  markers = [];
  userMarker = null;
  currentLat = null;
  currentLon = null;
}

// Store location on page unload
window.addEventListener('beforeunload', () => {
  if (currentLat && currentLon) {
    localStorage.setItem('mediguide_last_location', JSON.stringify({
      lat: currentLat,
      lon: currentLon,
      timestamp: Date.now()
    }));
  }
});