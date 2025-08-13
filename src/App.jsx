// src/App.jsx
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import omnivore from 'leaflet-omnivore';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';
import 'leaflet-routing-machine';
import './styles.css';
import points from './data/point'; // pastikan file ini ada dan memiliki lat,lng

export default function App() {
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const routingControlRef = useRef(null);
  const routingListenersRef = useRef([]);
  const drivingStepsRef = useRef([]); // normalized steps for voice guidance
  const nextStepIndexRef = useRef(0);

  const [menuOpen, setMenuOpen] = useState(false);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [routeTarget, setRouteTarget] = useState(null);
  const [routeSummary, setRouteSummary] = useState(null);
  const [routeSteps, setRouteSteps] = useState([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  const kebuns = [...new Set(points.map(pt => pt.kebun))];

  // ---- Helpers: TTS + step parsing ----
  function speakText(text, opts = {}) {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = opts.lang || 'id-ID';
      u.rate = opts.rate ?? 1;
      u.pitch = opts.pitch ?? 1;
      u.volume = opts.volume ?? 1;
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.warn('TTS error', e);
    }
  }

  function getStepLatLng(step) {
    // OSRM: step.maneuver.location -> [lon, lat]
    if (step?.maneuver?.location && Array.isArray(step.maneuver.location) && step.maneuver.location.length >= 2) {
      const [lon, lat] = step.maneuver.location;
      return L.latLng(lat, lon);
    }
    // alternative shapes
    if (step?.location && Array.isArray(step.location) && step.location.length >= 2) {
      const [lon, lat] = step.location;
      return L.latLng(lat, lon);
    }
    if (step?.lat && step?.lon) return L.latLng(step.lat, step.lon);
    if (step?.lat && step?.lng) return L.latLng(step.lat, step.lng);

    // fallback: try first coordinate of geometry if present and an array (not encoded)
    if (step?.geometry && Array.isArray(step.geometry) && step.geometry.length) {
      const c = step.geometry[0];
      if (Array.isArray(c) && c.length >= 2) {
        const [lon, lat] = c;
        return L.latLng(lat, lon);
      }
    }
    return null;
  }

  function normalizeStepsFromRoute(route) {
    // Try several structures and produce array of { text, distance, latlng, triggered }
    let rawSteps = [];

    if (route?.legs && Array.isArray(route.legs)) {
      route.legs.forEach(leg => {
        (leg.steps || []).forEach(s => rawSteps.push(s));
      });
    } else if (Array.isArray(route.instructions) && route.instructions.length) {
      route.instructions.forEach(inst => rawSteps.push(inst));
    } else if (route?.segments && Array.isArray(route.segments)) {
      route.segments.forEach(seg => {
        (seg.steps || []).forEach(s => rawSteps.push(s));
      });
    }

    if (!rawSteps.length) {
      // fallback: single generic step
      rawSteps = [{ text: 'Lanjut sampai tujuan', distance: route?.summary?.distance ?? null }];
    }

    const normalized = rawSteps.map((s, idx) => {
      const latlng = getStepLatLng(s);
      const text = s.text || s.instruction || (s.maneuver && (s.maneuver.instruction || s.maneuver.type)) || s.name || 'Lanjut';
      const distance = s.distance ?? s.dist ?? s.length ?? null;
      return { idx, text, distance, latlng, triggered: { far: false, near: false, passed: false } };
    });

    return normalized;
  }

  // ---- Create map + markers + geolocation ----
  useEffect(() => {
    if (mapRef.current) return;

    const map = L.map('map', { zoomControl: false }).setView([3.1868, 99.1202], 12);
    mapRef.current = map;

    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    // optional KML group (if files exist in public/)
    const colors = ['#f47068','#ffb3ae','#280659','#1697a6','#0e606b','#ffc24b'];
    const kmlFiles = [
      { file: '1KGR_AFD01.kml', label: 'AFD 01' },
      { file: '1KGR_AFD02.kml', label: 'AFD 02' },
      { file: '1KGR_AFD03.kml', label: 'AFD 03' },
      { file: '1KGR_AFD04.kml', label: 'AFD 04' },
      { file: '1KGR_AFD05.kml', label: 'AFD 05' },
      { file: '1KGR_AFD06.kml', label: 'AFD 06' }
    ];
    const kebunGroup = L.layerGroup().addTo(map);
    kmlFiles.forEach(({ file, label }, idx) => {
      const color = colors[idx % colors.length];
      omnivore.kml(`/${file}`).on('ready', function () {
        const layerGroup = this;
        layerGroup.eachLayer(layer => {
          if (layer.setStyle) layer.setStyle({ color, weight: 2, fillColor: color, fillOpacity: 0.35 });
        });
        const bounds = layerGroup.getBounds();
        if (bounds.isValid()) {
          const center = bounds.getCenter();
          const labelIcon = L.divIcon({ className: 'afd-label', html: `<strong>${label}</strong>`, iconSize: [100,20], iconAnchor: [50,10] });
          kebunGroup.addLayer(L.marker(center, { icon: labelIcon }));
        }
        layerGroup.eachLayer(layer => kebunGroup.addLayer(layer));
      });
    });
    L.control.layers(null, { "Kebun Group": kebunGroup }, { position: 'topright', collapsed: false }).addTo(map);

    // custom marker icon
    const customIcon = L.icon({
      iconUrl: '/point.svg',
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -28]
    });

    // add markers from points
    points.forEach(pt => {
      if (typeof pt.lat !== 'number' || typeof pt.lng !== 'number') {
        console.warn('Skipping invalid point', pt);
        return;
      }
      const marker = L.marker([pt.lat, pt.lng], { icon: customIcon }).addTo(map);
      const gmaps = `https://www.google.com/maps/search/?api=1&query=${pt.lat},${pt.lng}`;
      const popupHtml = `
        <div class="popup-content">
          <h4>${pt.id}</h4>
          <p><strong>UTM:</strong> X=${pt.utm.x}, Y=${pt.utm.y}</p>
          <p><strong>Koord:</strong> ${pt.geo}</p>
          <p><strong>Tinggi:</strong> ${pt.ellipsoidHeight}</p>
          <p>${pt.desc}</p>
          <p><a href="${gmaps}" target="_blank" rel="noreferrer">Lihat di Google Maps</a></p>
          <button id="route-${pt.id}" class="btn-route">Rute ke sini</button>
        </div>
      `;
      marker.bindPopup(popupHtml, { minWidth: 240 });

      marker.on('popupopen', () => {
        setTimeout(() => {
          const btn = document.getElementById(`route-${pt.id}`);
          btn?.addEventListener('click', () => startRoutingTo(pt));
        }, 120);
      });
    });

    // geolocate user
    map.locate({ watch: true, enableHighAccuracy: true });
    map.on('locationfound', e => {
      // update user marker
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng(e.latlng);
      } else {
        userMarkerRef.current = L.circleMarker(e.latlng, {
          radius: 8, color: 'blue', fillColor: '#30f', fillOpacity: 0.6
        }).addTo(map).bindPopup('Lokasi Anda');
      }

      // handle voice guidance on location update
      handleLocationUpdateForVoice(e.latlng);
    });
    map.on('locationerror', () => console.warn('Izin lokasi ditolak atau tidak tersedia.'));

    // cleanup on unmount
    return () => {
      try {
        map.stopLocate && map.stopLocate();
        // detach any routing controls & listeners
        if (routingControlRef.current) {
          try {
            routingListenersRef.current.forEach(({ obj, ev, fn }) => {
              try { obj.off && obj.off(ev, fn); } catch(e) {}
            });
            routingListenersRef.current = [];
            map.removeControl(routingControlRef.current);
          } catch (e) {}
        }
        map.remove();
      } catch (e) {
        console.warn('Error cleaning up map', e);
      }
      mapRef.current = null;
    };
  }, []); // run once

  // ---- Start routing to a point ----
  function startRoutingTo(pt) {
    const map = mapRef.current;
    if (!map) return;
    if (!userMarkerRef.current) {
      alert('Menunggu lokasi Anda ditemukan…');
      return;
    }
    const userLatLng = userMarkerRef.current.getLatLng();

    // remove previous routing control safely
    if (routingControlRef.current) {
      try {
        routingListenersRef.current.forEach(({ obj, ev, fn }) => {
          try { obj.off && obj.off(ev, fn); } catch(e) {}
        });
        routingListenersRef.current = [];
        map.removeControl(routingControlRef.current);
      } catch (e) {
        console.warn('Failed to remove previous routing control', e);
      }
      routingControlRef.current = null;
    }

    setRoutingLoading(true);
    setRouteModalOpen(true);
    setRouteTarget({ id: pt.id, lat: pt.lat, lng: pt.lng, label: pt.kebun });
    setRouteSteps([]);
    setRouteSummary(null);
    drivingStepsRef.current = [];
    nextStepIndexRef.current = 0;

    const routing = L.Routing.control({
      waypoints: [userLatLng, L.latLng(pt.lat, pt.lng)],
      routeWhileDragging: true,
      draggableWaypoints: true,
      addWaypoints: true,
      lineOptions: { addWaypoints: false },
      fitSelectedRoutes: true,
      show: false, // hide LRM UI container (we render our own)
      collapsible: false,
      createMarker: function(i, wp) {
        return L.marker(wp.latLng, {
          draggable: true,
          icon: L.icon({ iconUrl: '/point.svg', iconSize: [28,28], iconAnchor: [14,28] })
        });
      }
      // optional: set router with serviceUrl if you have alternate provider
      // router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' })
    }).addTo(map);

    routingControlRef.current = routing;

    // routesfound handler: extract summary & steps; also prepare drivingStepsRef for voice
    const onRoutesFound = (e) => {
      try {
        const route = (e?.routes && e.routes[0]) || null;
        if (!route) {
          setRouteSteps([{ text: 'Rute tidak tersedia.' }]);
          setRouteSummary(null);
          setRoutingLoading(false);
          return;
        }

        // summary: try several keys safely
        const summaryObj = route.summary || {};
        const totalDistance = summaryObj.distance ?? summaryObj.totalDistance ?? summaryObj.total_distance ?? route.summary?.distance ?? route.summary?.totalDistance ?? null;
        const totalTime = summaryObj.time ?? summaryObj.totalTime ?? summaryObj.total_time ?? route.summary?.time ?? route.summary?.totalTime ?? null;
        setRouteSummary({ distance: totalDistance, time: totalTime });

        // build steps array to display in modal
        let displaySteps = [];
        // try route.instructions (LRM)
        if (Array.isArray(route.instructions) && route.instructions.length) {
          displaySteps = route.instructions.map((inst) => ({
            text: inst.text || inst.instruction || inst.name || '',
            distance: inst.distance ?? inst.dist ?? null
          }));
        } else if (route.legs && Array.isArray(route.legs)) {
          displaySteps = route.legs.flatMap(leg => (leg.steps || []).map(s => ({
            text: s.instruction || s.name || (s.maneuver && s.maneuver.type) || '',
            distance: s.distance ?? null
          })));
        } else if (route.segments && Array.isArray(route.segments)) {
          displaySteps = route.segments.flatMap(seg => (seg.steps || []).map(s => ({
            text: s.instruction || s.name || '',
            distance: s.distance ?? null
          })));
        } else {
          displaySteps = [{ text: 'Instruksi rute tidak tersedia.' }];
        }

        setRouteSteps(displaySteps);

        // prepare driving steps for voice guidance (with latlng where possible)
        const normalized = normalizeStepsFromRoute(route);
        drivingStepsRef.current = normalized;
        nextStepIndexRef.current = 0;

        setRoutingLoading(false);
      } catch (err) {
        console.error('Error processing routesfound', err);
        setRouteSteps([{ text: 'Terjadi kesalahan saat memproses rute.' }]);
        setRoutingLoading(false);
      }
    };

    const onRoutingError = (err) => {
      console.error('Routing error', err);
      setRoutingLoading(false);
      setRouteSteps([{ text: 'Gagal menghitung rute. Coba lagi atau buka di Google Maps.' }]);
    };

    routing.on('routesfound', onRoutesFound);
    routing.on('routingerror', onRoutingError);

    routingListenersRef.current.push({ obj: routing, ev: 'routesfound', fn: onRoutesFound });
    routingListenersRef.current.push({ obj: routing, ev: 'routingerror', fn: onRoutingError });

    // attach plan waypoint change -> set loading indicator (routesfound will update)
    const plan = routing.getPlan && routing.getPlan();
    if (plan) {
      const onWaypointsChanged = () => {
        setRoutingLoading(true);
      };
      plan.on('waypointschanged', onWaypointsChanged);
      routingListenersRef.current.push({ obj: plan, ev: 'waypointschanged', fn: onWaypointsChanged });
    }
  }

  // ---- Keep routing active when modal closed. Voice guidance reacts to location updates ----
  function handleLocationUpdateForVoice(userLatLng) {
    if (!voiceEnabled) return;
    const steps = drivingStepsRef.current;
    if (!steps || !steps.length) return;

    let i = nextStepIndexRef.current;
    // skip steps already passed
    while (i < steps.length && steps[i].triggered?.passed) i++;
    nextStepIndexRef.current = i;

    if (i >= steps.length) {
      return; // finished
    }

    const step = steps[i];
    // if step has latlng, compute distance
    if (step.latlng) {
      const map = mapRef.current;
      if (!map) return;
      const dist = map.distance(userLatLng, step.latlng); // in meters

      // thresholds (meters) - tweak as needed; we can make adaptive later
      const far = 500;
      const near = 150;
      const now = 30;

      // announce far
      if (dist <= far && !step.triggered.far) {
        step.triggered.far = true;
        const msg = `Dalam ${Math.round(dist)} meter, ${step.text}`;
        speakText(msg);
      }

      // announce near
      if (dist <= near && !step.triggered.near) {
        step.triggered.near = true;
        const msg = `Siap-siap, ${step.text}`;
        speakText(msg);
      }

      // announce now / mark passed
      if (dist <= now && !step.triggered.passed) {
        step.triggered.passed = true;
        const msg = `${step.text}`;
        speakText(msg);
        nextStepIndexRef.current = i + 1;
      }
    } else {
      // fallback when no precise latlng for step: use remaining distance of step (if available)
      // if step.distance exists we could estimate; but skip to avoid false alarms
    }
  }

  // ---- Remove routing completely (dock disappears) ----
  function removeRouting() {
    const map = mapRef.current;
    if (!map || !routingControlRef.current) return;
    try {
      routingListenersRef.current.forEach(({ obj, ev, fn }) => {
        try { obj.off && obj.off(ev, fn); } catch(e) {}
      });
      routingListenersRef.current = [];
      map.removeControl(routingControlRef.current);
    } catch (e) {
      console.warn('Failed to remove routing control', e);
    }
    routingControlRef.current = null;
    drivingStepsRef.current = [];
    nextStepIndexRef.current = 0;
    setRouteModalOpen(false);
    setRouteSteps([]);
    setRouteSummary(null);
    setRouteTarget(null);
  }

  // ---- UI helpers ----
  const fmtDist = (m) => {
    if (m == null) return '';
    if (m >= 1000) return `${(m/1000).toFixed(1)} km`;
    return `${Math.round(m)} m`;
  };
  const fmtTime = (s) => {
    if (s == null) return '';
    const mins = Math.round(s / 60);
    if (mins >= 60) return `${Math.floor(mins/60)}h ${mins%60}m`;
    return `${mins}m`;
  };

  const centerUser = () => {
    if (userMarkerRef.current && mapRef.current) {
      mapRef.current.setView(userMarkerRef.current.getLatLng(), 15);
    } else alert('Lokasi pengguna belum tersedia.');
  };

  // ---- Render ----
  return (
    <>
      <button className="burger" style={{ top: 10, left: 10 }} onClick={() => setMenuOpen(o => !o)}>☰ TBM</button>
      <button className="burger" style={{ top: 50, left: 10 }} onClick={centerUser}>🎯</button>

      <div className={`menu ${menuOpen ? 'open' : ''}`}>
        {kebuns.map(k => (
          <div key={k} className="menu-section">
            <h4>{k}</h4>
            <ul>
              {points.filter(pt => pt.kebun === k).map(pt => (
                <li key={pt.id} onClick={() => { mapRef.current && mapRef.current.setView([pt.lat, pt.lng], 15); setMenuOpen(false); }}>
                  {pt.id}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div id="map" style={{ height: '100vh', width: '100%' }} />

      {/* small control for voice priming */}
      <div style={{ position: 'fixed', top: 10, right: 10, zIndex: 3000 }}>
        <button
          className="btn-small"
          onClick={() => {
            setVoiceEnabled(o => !o);
            // prime speech (user gesture)
            speakText(`Suara navigasi ${voiceEnabled ? 'dimatikan' : 'diaktifkan'}`, { lang: 'id-ID' });
          }}
        >
          {voiceEnabled ? 'Suara: ON' : 'Suara: OFF'}
        </button>
      </div>

      {/* Route Modal */}
      {routeModalOpen && (
        <div className="modal-overlay" onClick={() => setRouteModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Rute ke {routeTarget?.id} — {routeTarget?.label}</h3>
              <button className="close-btn" onClick={() => setRouteModalOpen(false)}>✕</button>
            </div>

            <div className="modal-body">
              {routingLoading && <div className="routing-placeholder">Sedang menyiapkan rute…</div>}

              {!routingLoading && routeSummary && (
                <div style={{ marginBottom: 10 }}>
                  <strong>Ringkasan:</strong>
                  <div>{fmtDist(routeSummary.distance)} • {fmtTime(routeSummary.time)}</div>
                </div>
              )}

              {!routingLoading && routeSteps && routeSteps.length > 0 && (
                <ol className="route-steps">
                  {routeSteps.map((s, i) => (
                    <li key={i} className="route-step">
                      <div className="step-text">{s.text}</div>
                      {s.distance != null && <div className="step-meta">{fmtDist(s.distance)}</div>}
                    </li>
                  ))}
                </ol>
              )}

              {!routingLoading && (!routeSteps || routeSteps.length === 0) && (
                <div className="routing-placeholder">Tidak ada instruksi rute. Gunakan tombol "Buka di Google Maps".</div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={() => {
                if (routeTarget && userMarkerRef.current) {
                  const u = userMarkerRef.current.getLatLng();
                  const url = `https://www.google.com/maps/dir/?api=1&origin=${u.lat},${u.lng}&destination=${routeTarget.lat},${routeTarget.lng}&travelmode=driving`;
                  window.open(url, '_blank');
                } else alert('Lokasi pengguna/target tidak tersedia');
              }}>Buka di Google Maps</button>

              <button className="btn btn-secondary" onClick={() => setRouteModalOpen(false)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {/* Dock panel visible if routing exists */}
      {routingControlRef.current && (
        <div className="routing-dock">
          <div className="dock-summary">
            <div><strong>{routeTarget?.id}</strong> {routeTarget?.label}</div>
            <div className="dock-meta">
              {routeSummary ? `${fmtDist(routeSummary.distance)} • ${fmtTime(routeSummary.time)}` : 'Menunggu rute...'}
            </div>
          </div>

          <div className="dock-actions">
            <button className="btn-small" onClick={() => setRouteModalOpen(true)}>Open</button>
            <button className="btn-small" onClick={() => {
              // set origin to user location
              if (userMarkerRef.current && routingControlRef.current) {
                try {
                  const plan = routingControlRef.current.getPlan();
                  const waypoints = plan.getWaypoints().map(wp => (wp.latLng ? wp.latLng : L.latLng(wp.lat, wp.lng)));
                  waypoints[0] = userMarkerRef.current.getLatLng();
                  plan.setWaypoints(waypoints);
                } catch (e) { console.warn('Failed to set origin', e); }
              } else alert('Lokasi pengguna atau rute belum tersedia.');
            }}>Use my loc</button>
            <button className="btn-small btn-danger" onClick={removeRouting}>Remove</button>
          </div>

          <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
            Drag waypoint di peta untuk ubah rute. Tutup modal untuk menyembunyikan instruksi — rute tetap aktif.
          </div>
        </div>
      )}
    </>
  );
}