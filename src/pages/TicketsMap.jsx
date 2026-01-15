import { useEffect, useState, useRef } from "react";
import { useLocation } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ✅ Fix Leaflet’s default icon
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";
import { getTickets, pickTicket } from "../services/generalApis";
import { tktTabs, formatTo12Hour } from "../services/helpers";
import { useToast } from "../components/ui/Toast";
const user   = JSON.parse(localStorage.getItem('user'));
const userImg  = user?.photo ? import.meta.env.VITE_API_BASE_URL + import.meta.env.VITE_API_APP_USER_IMG_PATH + user?.photo : import.meta.env.VITE_API_APP_DIR_PATH + import.meta.env.VITE_API_APP_DEFAULT_TECHCIAN_IMG;

const DefaultIcon = L.icon({
  iconUrl,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Different icon for user's location
const userIcon = new L.Icon({
  className: "user-location-marker",
  // iconUrl: "https://cdn-icons-png.flaticon.com/512/149/149060.png",
  // iconUrl: "https://png.pngtree.com/png-vector/20240620/ourmid/pngtree-3d-worker-half-body-png-image_12812620.png",
  iconUrl: userImg,//"img/user/technician.png",
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40],
});

const userMarkerStyle = {
  radius: 10,
  fillColor: "#007bff",
  color: "#fff",
  weight: 2,
  opacity: 1,
  fillOpacity: 0.8,
};

// ✅ Auto-center helper
const AutoCenter = ({ markers, type, position }) => {
  const map = useMap();
  useEffect(() => {
    if (markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((m) => [type === 'PENDING' ? m.lat : m.latitude, type === 'PENDING' ? m.lng : m.longitude]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
    }
    if (position) {
      map.setView(position, 12);
    }
  }, [markers, map]);
  return null;
};

const TicketsMap = () => {
  const toast = useToast();
  const location = useLocation();
  const [type, setType] = useState(location.hash ? location.hash.substring(1) : 'OPEN');
  const [markers, setMarkers] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [selectedMarkerData, setSelectedMarkerData] = useState({});
  const [loading, setLoading] = useState(true);
  const [popupLoading, setPopupLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState(false);
  const [closeinit, setCloseinit] = useState(false);
  const [closeinitcnt, setCloseinitCnt] = useState(0);
  const reasonRef = useRef();

//   const [tickets, setTickets] = useState([]);
  const userdet = JSON.parse(localStorage.getItem('user'));

  // Get user's current location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation([pos.coords.latitude, pos.coords.longitude]);
        },
        (err) => console.error("Geolocation error:", err),
        { enableHighAccuracy: true }
      );
    }
  }, []);

  // ✅ Load marker list from API
  useEffect(() => {
    getTkts(type);
  }, [actionSuccess]);

  async function getTkts(tabKey) {
      const params = { user: userdet?.username, op_id: userdet?.op_id, dept: 'Departments' };
      try {
        setLoading(true);
        markers.length = 0;
        const data = await getTickets(tabKey, params);
        const statusKey = tabKey === 'OPEN' ? 'ticketstatus' : 'status';
        const statusObj = data?.[statusKey];
        if (statusObj?.err_code === 0 && Array.isArray(data?.body)) {
          let cleanedTickets = data?.body;
          if(tabKey === "OPEN" || tabKey === "PENDING" || tabKey === "NEW CONNECTIONS" || tabKey === "DISCONNECTIONS") {
            const nameKey = tabKey === 'OPEN' ? 'customername' : tabKey === 'PENDING' ? 'custname' : 'name';
            const risedTimeKey = tabKey === 'DISCONNECTIONS' || tabKey === 'NEW CONNECTIONS' ? 'risedTime' : 'risedtime';
            cleanedTickets = data?.body.map(ticket => ({
              ...ticket,
              tid: tabKey === 'DISCONNECTIONS' || tabKey === 'NEW CONNECTIONS' ? ticket.ticketId : ticket.tid,
              customername: ticket[nameKey],
              mobile: ticket.mobile.replace(/\(\d+\)/, "").trim(),
              risedtime: ticket[risedTimeKey] ? formatTo12Hour(ticket[risedTimeKey]) : '',
              group: tabKey === 'PENDING' ? ticket.group1 : ticket.group,
              latitude: ticket.latitude ? parseFloat(ticket.latitude) : '',
              longitude: ticket.longitude ? parseFloat(ticket.longitude) : '',
            }));
          }else if(tabKey === "JOB DONE") {
            cleanedTickets = data?.body.map(ticket => ({
              ...ticket,
              cid: ticket.User_Name,
              customername: ticket.name,
              mobile: ticket.cust_mob.replace(/\(\d+\)/, "").trim(),
              resolved_time: ticket.resolved_time ? formatTo12Hour(ticket.resolved_time) : ''
            }));
          }
          setMarkers(cleanedTickets);
          setLoading(false);
          // console.log(data?.body);
        } else {
          // console.error("Failed to get tickets:", data?.status?.err_msg || "Unknown error");
          setLoading(false);
        }
      } catch (err) {
        console.error("Error in getting tickets:", err);
      }
    }

  // ✅ Load marker details on click
  const handleMarkerClick = async (marker) => {
    // console.log(marker);
    setSelectedMarkerData(marker);
  };

  // ✅ Call action API on button click
  const tktAction = async (tkt) => {
    if(type === 'PENDING'){
      setCloseinit(true);
      // if(closeinitcnt > 0){
      //   setCloseinit(false);
      // }
      const reason = reasonRef.current.value;
      if(!reason || reason.trim() === '') {
        setCloseinitCnt(closeinitcnt + 1);
        // toast.add("Please enter the reason to close.", { type: "error", duration: 3000 });
        return;
      } else {
        setCloseinit(false);
        setCloseinitCnt(0);
        tkt.action = 'close';
        tkt.reason = reason;
      }
    } 
    setActionLoading(true);
    setActionSuccess(false);
    var params = {};
    if(tkt.action === 'close')
      params = { apiopid: userdet?.username, ticketid: tkt.tid, empname: userdet?.username, empcontact: tkt.mobile, opid: userdet?.op_id, reason: tkt.reason };
    else
      params = { apiopid: userdet?.username, ticketid: tkt.tid, empname: userdet?.username, empcontact: tkt.mobile };
    // console.log(params);return;
    try {
      const data = await pickTicket(params, tkt.action);
      if (data?.status?.err_code === 0) {
        toast.add(data?.status?.err_msg, { type: "success" });
      } else {
        toast.add(data?.status?.err_msg, { type: "error", duration: 3000 });
        // console.error("Failed to pick ticket:", data?.status?.err_msg || "Unknown error");
      }
      setActionSuccess(true);
    } catch (err) {
      console.error("Error in getting tickets:", err);
    } finally {
      setActionLoading(false);
      reasonRef.current.value = '';
    }
  };

  function capitalize(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[90vh]">
        <p>Loading map markers...</p>
      </div>
    );
  }

  return (
    <div className="w-full h-[90vh]">
      <header
        className={`z-40 bg-blue-600 text-white px-4 flex items-center justify-between shadow-md`}
        style={{ height: "3rem", background: "rgb(109, 103, 255)" }}
      >
        <button
          onClick={() => window.history.back()}
          className="text-white mr-3 text-xl" style={{ fontSize: '1.5rem' }}
        >
          ←
        </button>
        <h1 className="text-lg font-semibold">{`${capitalize(type)} Jobs`}</h1>
        <div className="w-6" /> {/* spacer */}
      </header>

      <MapContainer
        center={[20.5937, 78.9629]} // India center
        zoom={5}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <AutoCenter markers={markers} type={type} />

        {/* ✅ Cluster group with custom icons */}
        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={(cluster) => {
            const count = cluster.getChildCount();
            let color = "bg-blue-600";
            if (count > 10) color = "bg-green-600";
            if (count > 50) color = "bg-red-600";
            return L.divIcon({
              html: `<div class="flex items-center justify-center ${color} text-white rounded-full w-10 h-10 text-sm font-semibold border-2 border-white shadow-md">${count}</div>`,
              className: "cluster-marker",
              iconSize: [40, 40],
            });
          }}
        >
          {markers.map((marker) => (
            <Marker
              key={marker.tid}
              position={[type === 'PENDING' ? marker.lat : marker.latitude, type === 'PENDING' ? marker.lng : marker.longitude]}
              eventHandlers={{
                click: () => handleMarkerClick(marker),
              }}
            >
              <Popup>
                {popupLoading && !selectedMarkerData[tid] ? (
                  <div className="text-gray-500">Loading details...</div>
                ) : selectedMarkerData.tid ? (
                  <div className="text-sm">
                    <div className="flex items-center text-blue-800 font-medium">
                      <ClipboardList className="w-5 h-5 text-blue-700 font-semibold mr-2" />
                      Job #{selectedMarkerData.tid}
                    </div>
                    <p>
                      <span className="font-semibold">Customer ID:</span>{" "}
                      {selectedMarkerData.customername}
                    </p>
                    <p>
                      <span className="font-semibold">Name:</span>{" "}
                      {selectedMarkerData.cid}
                    </p>
                    <p>
                      <span className="font-semibold">Mobile:</span>{" "}
                      {selectedMarkerData.mobile}
                    </p>
                    <p>
                      <span className="font-semibold">Address:</span>{" "}
                      {selectedMarkerData.address}
                    </p>
                    <p>
                      <span className="font-semibold">Raised Time:</span>{" "}
                      {selectedMarkerData.risedtime}
                    </p>

                    {/* ✅ Action button */}
                    <div className="mt-3 flex flex-col items-center">
                      {(type === 'PENDING' && closeinit) && 
                      <>
                      <textarea
                        className={`border p-2 w-full rounded ${closeinitcnt > 0 ? 'border-red-600' : 'border-gray-300'}`}
                        placeholder="Enter reason to close the job"
                        ref={reasonRef}
                      />
                      {closeinit && (
                        <p className={`text-xs mt-1 ${closeinitcnt > 0 ? 'text-red-600' : 'text-orange-500'}`}>
                          Please enter the reason to close the job.
                        </p>
                      )}
                      </>
                      }
                      <button
                        onClick={() => tktAction(selectedMarkerData)}
                        className="font-medium text-sm text-blue-700 hover:text-white hover:bg-indigo-500 border border-blue-500 hover:border-transparent px-3 py-1 mt-1 rounded"
                        disabled={actionLoading}
                      >
                        {actionLoading ? "Processing..." : type === 'OPEN' ? "Pick Ticket" : "Close Job"}
                      </button>

                      {/* {actionSuccess && (
                        <p className="text-green-600 text-xs mt-1">
                          ✅ Action completed successfully!
                        </p>
                      )} */}
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500">{marker.tid}</div>
                )}
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
        {/* User's current location marker */}
        {userLocation && (
          <>
            <Marker position={userLocation} icon={userIcon}>
              {/* <Popup>
                <strong>Your Location</strong>
                <br />
                Lat: {userLocation[0].toFixed(4)}, Lng: {userLocation[1].toFixed(4)}
              </Popup> */}
            </Marker>
            <AutoCenter markers={markers} type={type} position={userLocation} />
            {/* <AutoCenter position={userLocation} /> */}
          </>
        )}
      </MapContainer>
    </div>
  );
};

export default TicketsMap;
