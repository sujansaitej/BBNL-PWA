import React, { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";

const getDistanceKm = (a, b) =>
  (L.latLng(a).distanceTo(L.latLng(b)) / 1000).toFixed(2);

function Recenter({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lng) map.setView([lat, lng]);
  }, [lat, lng]);
  return null;
}

function Routing({ from, to, mode, onRouteFound, routeRef }) {
  const map = useMap();

  useEffect(() => {
    if (!from || !to) return;

    if (routeRef.current) map.removeControl(routeRef.current);

    const profile = mode === "walking" ? "foot" : "car";

    const control = L.Routing.control({
      waypoints: [L.latLng(from.lat, from.lng), L.latLng(to.lat, to.lng)],
      router: L.Routing.osrmv1({
        serviceUrl: `https://router.project-osrm.org/route/v1/${profile}`,
      }),
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: true,
      show: false,
      createMarker: () => null,
      lineOptions: {
        styles: [
          { color: mode === "walking" ? "green" : "blue", weight: 5, opacity: 0.8 },
        ],
      },
    })
      .on("routesfound", (e) => {
        const route = e.routes[0];
        onRouteFound(route);
      })
      .addTo(map);

    routeRef.current = control;
    return () => map.removeControl(control);
  }, [from, to, mode, map, onRouteFound, routeRef]);

  return null;
}

export default function SmartNavigationMap() {
  const [currentPos, setCurrentPos] = useState(null);
  const [locations, setLocations] = useState([]);
  const [routeTo, setRouteTo] = useState(null);
  const [mode, setMode] = useState(localStorage.getItem("travelMode") || "driving");
  const [selected, setSelected] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [nextTurn, setNextTurn] = useState(null);
  const routeRef = useRef(null);
  const movingMarkerRef = useRef(null);

  // Load mock API locations
  useEffect(() => {
    setLocations([
      { id: 1, name: "Cafe Aroma", lat: 12.935, lng: 77.619 },
      { id: 2, name: "BB Bakery", lat: 12.937, lng: 77.621 },
      { id: 3, name: "Green Mart", lat: 12.940, lng: 77.625 },
    ]);
  }, []);

  // Get user location + track live movement
  useEffect(() => {
    if (!("geolocation" in navigator)) return alert("Geolocation not supported");

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, speed } = pos.coords;
        const latlng = { lat: latitude, lng: longitude };
        setCurrentPos(latlng);
        setCurrentSpeed(speed ? (speed * 3.6).toFixed(1) : 0); // m/s → km/h

        // Move live marker
        if (movingMarkerRef.current)
          movingMarkerRef.current.setLatLng([latitude, longitude]);

        // Detect off-route
        if (routeData && routeTo) {
          const nearestPoint = L.GeometryUtil.closest(
            mapRef.current,
            L.polyline(routeData.coordinates),
            L.latLng(latlng)
          );
          const distToPath = L.latLng(latlng).distanceTo(nearestPoint);
          if (distToPath > 50) {
            console.log("User off route, recalculating...");
            setTimeout(() => setRouteTo({ ...routeTo }), 500); // re-trigger route
          }
        }
      },
      (err) => console.error(err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [routeData, routeTo]);

  const mapRef = useRef(null);

  const handleRouteFound = (route) => {
    const geometry = route.coordinates;
    setRouteData({ geometry, instructions: route.instructions, coordinates: geometry });

    // Add or move the animated marker
    if (!movingMarkerRef.current) {
      movingMarkerRef.current = L.marker([currentPos.lat, currentPos.lng], {
        icon: L.icon({
          iconUrl: "https://cdn-icons-png.flaticon.com/512/64/64113.png",
          iconSize: [30, 30],
        }),
      }).addTo(mapRef.current);
    }

    // Simulate next turn instruction
    const next = route.instructions?.[1];
    if (next) {
      const turnText = next.text || "Continue straight";
      setNextTurn(turnText);
      speechSynthesis.speak(new SpeechSynthesisUtterance(turnText));
    }
  };

  if (!currentPos)
    return <div className="text-center p-4">Fetching your location...</div>;

  const toggleMode = () => {
    const newMode = mode === "driving" ? "walking" : "driving";
    setMode(newMode);
    localStorage.setItem("travelMode", newMode);
  };

  const navigateInGoogleMaps = () => {
    if (!routeTo) return;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${currentPos.lat},${currentPos.lng}&destination=${routeTo.lat},${routeTo.lng}&travelmode=${mode}`;
    window.open(url, "_blank");
  };

  return (
    <div className="h-screen w-full relative">
      <MapContainer
        whenCreated={(map) => (mapRef.current = map)}
        center={[currentPos.lat, currentPos.lng]}
        zoom={14}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://osm.org">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Recenter lat={currentPos.lat} lng={currentPos.lng} />

        {locations.map((loc) => (
          <Marker
            key={loc.id}
            position={[loc.lat, loc.lng]}
            icon={L.icon({
              iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
              iconSize: [30, 30],
            })}
            eventHandlers={{
              click: () => setSelected(loc),
              dblclick: () => setRouteTo(loc),
            }}
          >
            <Popup>
              <b>{loc.name}</b>
              <br />
              {getDistanceKm(currentPos, loc)} km away
            </Popup>
          </Marker>
        ))}

        {routeTo && (
          <Routing
            from={currentPos}
            to={routeTo}
            mode={mode}
            routeRef={routeRef}
            onRouteFound={handleRouteFound}
          />
        )}
      </MapContainer>

      {/* Info UI */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex flex-col items-center space-y-3">
        {nextTurn && (
          <div className="bg-yellow-200 text-gray-800 p-2 px-4 rounded-lg shadow-md font-medium">
            👉 Next: {nextTurn}
          </div>
        )}
        <div className="bg-white shadow-lg px-4 py-2 rounded-lg flex items-center gap-3">
          <button
            onClick={toggleMode}
            className="bg-blue-600 text-white px-3 py-1 rounded-md text-sm"
          >
            {mode === "driving" ? "🚗 Driving" : "🚶 Walking"}
          </button>
          <button
            onClick={navigateInGoogleMaps}
            className="bg-purple-600 text-white px-3 py-1 rounded-md text-sm"
          >
            🗺️ Google Maps
          </button>
          <span className="text-gray-700 text-sm">
            Speed: {currentSpeed} km/h
          </span>
        </div>
      </div>
    </div>
  );
}
