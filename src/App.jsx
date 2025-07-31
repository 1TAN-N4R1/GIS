import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import omnivore from 'leaflet-omnivore';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';
import 'leaflet-routing-machine';
import './styles.css';
import points from './data/point';

export default function App() {
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const routingControlRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const kebuns = [...new Set(points.map(pt => pt.kebun))];

  useEffect(() => {
    if (mapRef.current) return;

    const map = L.map('map', { zoomControl: false }).setView([3.1868, 99.1202], 12);
    mapRef.current = map;

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    // Warna untuk tiap AFD
    const colors = [
      '#f47068', // bittersweet
      '#ffb3ae', // melon
      '#280659', // seashell
      '#1697a6', // blue-munsell
      '#0e606b', // caribbean-current
      '#ffc24b'  // xanthous
    ];

    // File dan label AFD
    const kmlFiles = [
      { file: '1KGR_AFD01.kml', label: 'AFD 01' },
      { file: '1KGR_AFD02.kml', label: 'AFD 02' },
      { file: '1KGR_AFD03.kml', label: 'AFD 03' },
      { file: '1KGR_AFD04.kml', label: 'AFD 04' },
      { file: '1KGR_AFD05.kml', label: 'AFD 05' },
      { file: '1KGR_AFD06.kml', label: 'AFD 06' }
    ];

    // Group untuk kebun
    const kebunGunungParaGroup = L.layerGroup().addTo(map);

    // Loop dan load KML
    kmlFiles.forEach(({ file, label }, idx) => {
      const color = colors[idx % colors.length];

      omnivore.kml(`/${file}`)
        .on('ready', function () {
          const layerGroup = this;

          layerGroup.eachLayer(layer => {
            if (layer.setStyle) {
              layer.setStyle({
                color: color,
                weight: 2,
                fillColor: color,
                fillOpacity: 0.5
              });
            }
          });

          const bounds = layerGroup.getBounds();
          if (bounds.isValid()) {
            const center = bounds.getCenter();
            const labelIcon = L.divIcon({
              className: 'afd-label',
              html: `<strong>${label}</strong>`,
              iconSize: [100, 20],
              iconAnchor: [50, 10]
            });
            const labelMarker = L.marker(center, { icon: labelIcon });
            kebunGunungParaGroup.addLayer(labelMarker);
          }

          layerGroup.eachLayer(layer => kebunGunungParaGroup.addLayer(layer));
        });
    });

    // Kontrol layer untuk grup
    L.control.layers(null, {
      "Kebun Gunung Para": kebunGunungParaGroup
    }, { position: 'topright', collapsed: false }).addTo(map);
    
    // Custom icon
    const customIcon = L.icon({
    iconUrl: '/point.svg',
    iconSize: [30, 30],       // ukuran ikon (ubah sesuai kebutuhan)
    iconAnchor: [15, 30],     // posisi "titik" ikon (biasanya di bawah tengah)
    popupAnchor: [0, -30]     // posisi popup relatif terhadap ikon
    });

    // Marker TBM
    points.forEach(pt => {
      const marker = L.marker([pt.lat, pt.lng], { icon: customIcon }).addTo(map);
      const gmaps = `https://www.google.com/maps/search/?api=1&query=${pt.lat},${pt.lng}`;
      const popupHtml = `
        <h4>${pt.id}</h4>
        <p>UTM: X = ${pt.utm.x}, Y = ${pt.utm.y}</p>
        <p>Koordinat Geografis:<br> ${pt.geo}</p>
        <p>Tinggi Ellipsoid: ${pt.ellipsoidHeight}</p>
        <p>${pt.desc}</p>
        <p><a href="${gmaps}" target="_blank">Lihat di Google Maps</a></p>
        <button id="route-${pt.id}" style="margin-top:8px;">Rute ke sini</button>
      `;
      marker.bindPopup(popupHtml);
      marker.on('popupopen', () => {
        document.getElementById(`route-${pt.id}`)?.addEventListener('click', () => {
          if (!userMarkerRef.current) {
            alert('Menunggu lokasi Anda ditemukan…');
            return;
          }
          const userLatLng = userMarkerRef.current.getLatLng();
          if (routingControlRef.current) {
            map.removeControl(routingControlRef.current);
          }
          routingControlRef.current = L.Routing.control({
            waypoints: [userLatLng, L.latLng(pt.lat, pt.lng)],
            lineOptions: { addWaypoints: false },
            fitSelectedRoutes: true,
            show: false
          }).addTo(map);
        });
      });
    });

    // Lokasi pengguna
    map.locate({ watch: true, enableHighAccuracy: true });
    map.on('locationfound', e => {
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng(e.latlng);
      } else {
        userMarkerRef.current = L.circleMarker(e.latlng, {
          radius: 8,
          color: 'blue',
          fillColor: '#30f',
          fillOpacity: 0.5
        })
          .addTo(map)
          .bindPopup('Lokasi Anda');
      }
    });

    map.on('locationerror', () => {
      console.warn('Izin lokasi ditolak atau tidak tersedia.');
    });
  }, []);

  const handleView = (lat, lng) => {
    mapRef.current.setView([lat, lng], 15);
    setMenuOpen(false);
  };

  const centerUser = () => {
    if (userMarkerRef.current) {
      mapRef.current.setView(userMarkerRef.current.getLatLng(), 15);
    }
  };

  return (
    <>
      <button className="burger" style={{ top: 10, left: 10 }} onClick={() => setMenuOpen(o => !o)}>
        ☰ TBM
      </button>

      <button className="burger" style={{ top: 50, left: 10 }} onClick={centerUser}>
        🎯
      </button>

      <div className={`menu ${menuOpen ? 'open' : ''}`}>
        {kebuns.map(k => (
          <div key={k} className="menu-section">
            <h4>{k}</h4>
            <ul>
              {points.filter(pt => pt.kebun === k).map(pt => (
                <li key={pt.id} onClick={() => handleView(pt.lat, pt.lng)}>
                  {pt.id}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div id="map" style={{ height: '100vh', width: '100%' }} />
    </>
  );
}