import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon, MapPinIcon, TicketIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import LocationPicker from "../../components/LocationPicker";
import { Modal } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { getUser } from "../../services/safeStorage";
import { getActiveAccount } from "../../services/customer/linkAccount";
import {
  checkRequestAllowed,
  getAvailableServices,
  getNearbyOperators,
  submitRequest,
  validateRequest,
} from "../../services/customer/newConnFunnel";
import { Marker } from "react-leaflet";
import L from "leaflet";

/**
 * New Connection — ported from Android's NewConnectionFragment
 * (employee/java/.../Activity/NewConnectionFragment.java, layout
 * activity_add_location).
 *
 * The order of the flow, matching the app screen for screen:
 *   1. location permission — Android shows showGPSDisabledAlertToUser() when
 *      GPS is off; the web equivalent is the prompt below, because a browser
 *      will not surface its own permission dialog without a user gesture.
 *   2. the map, with the pin LOCKED TO THE CENTRE. Android's onCameraChange
 *      reads getCameraPosition().target, so you mark the spot by moving the map
 *      under a fixed pointer — not by dragging a marker. LocationPicker does
 *      exactly that, and it is the same component the operator Add User screen
 *      uses.
 *   3. GET NEW CONNECTION / SERVICES — both open the same SELECT SERVICE sheet.
 *   4. multi-select services (list_type:"multi" from the backend = checkboxes).
 *   5. Confirm Address — reverse-geocoded from the pin, OK / Cancel.
 *   6. submit, then the result dialog.
 *
 * Android's own submit is commented out in the source we have and its APK fails
 * with "Mobile no. not exists". That is a missing prerequisite call, not a
 * broken endpoint — submitRequest() seeds `newconn_info` first. See
 * services/customer/newConnFunnel.js.
 *
 * The green operator pins come from apis/cust/clientlatlong — see
 * getNearbyOperators. Tapping one opens the Operator Details dialog, exactly as
 * the app does.
 */

// Bengaluru — where the operator base is. Only used until geolocation answers,
// so the map is never blank while the browser is deciding.
const FALLBACK_CENTRE = [12.9716, 77.5946];

export default function NewConnection() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = getUser();
  const account = getActiveAccount();

  const [centre, setCentre] = useState(FALLBACK_CENTRE);
  const [picked, setPicked] = useState(null);          // {lat,lng} from the map centre
  const [locState, setLocState] = useState("asking");  // asking | granted | denied | unsupported
  const [services, setServices] = useState([]);
  // "loading" | "ready" | "failed" — so the picker never shows "Loading…"
  // forever after a failed fetch.
  const [servicesState, setServicesState] = useState("loading");
  const [chosen, setChosen] = useState([]);
  const [showServices, setShowServices] = useState(false);
  const [address, setAddress] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [operators, setOperators] = useState([]);
  const [operator, setOperator] = useState(null);
  // Android's searched_address_et: type an address, the map jumps to it.
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  // Android moves to a search hit at zoom 15 (delegateLatLng); a plain
  // recentre keeps whatever zoom the user has.
  const [viewZoom, setViewZoom] = useState(undefined);
  // Android's address_tv + progressBar2: the reverse-geocoded address of the
  // pin, updated as the map settles, shown under the map.
  const [liveAddress, setLiveAddress] = useState("");
  const [addressLoading, setAddressLoading] = useState(false);
  // Android's `requestStatus`: null until noofconnection answers.
  const [eligibility, setEligibility] = useState(null);

  const profile = {
    fname: account?.name?.split(" ")[0] || user?.firstname || "",
    lname: account?.name?.split(" ").slice(1).join(" ") || user?.lastname || "",
    mobile: account?.mobileno || user?.mobileno || "",
    email: account?.emailid || user?.emailid || "",
    address: "",
    pincode: "",
    username: account?.userid || user?.username || "",
    password: "",
  };

  const locate = useCallback(() => {
    if (!navigator.geolocation) { setLocState("unsupported"); return; }
    setLocState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = [pos.coords.latitude, pos.coords.longitude];
        setCentre(c);
        setPicked({ lat: c[0], lng: c[1] });
        setLocState("granted");
      },
      // Denied or unavailable. The map still works — the customer can pan to
      // their address by hand, which is the whole point of a centre pin.
      () => setLocState("denied"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => { locate(); }, [locate]);

  // Live address under the map, like Android's address_tv. Debounced on the
  // same settle as the operator pins; Nominatim asks for ≤1 req/s.
  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    setAddressLoading(true);
    const t = setTimeout(async () => {
      const text = await reverseGeocode(picked);
      if (cancelled) return;
      setLiveAddress(text);
      setAddressLoading(false);
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [picked?.lat, picked?.lng]);

  // Android's searched_address_et → Geocoder.getFromLocationName → camera
  // moves to the hit at zoom 15. Nominatim's forward search is the web
  // equivalent; biased to India, first hit wins, as the app does.
  async function searchAddress(e) {
    e?.preventDefault?.();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`,
        { headers: { Accept: "application/json" } }
      );
      const hits = await r.json();
      const hit = Array.isArray(hits) ? hits[0] : null;
      if (!hit) { toast.add("No place found for that address.", { type: "warning" }); return; }
      const c = [Number(hit.lat), Number(hit.lon)];
      setViewZoom(15);
      setCentre(c);
      setPicked({ lat: c[0], lng: c[1] });
    } catch (_) {
      toast.add("Could not search that address right now.", { type: "error" });
    } finally {
      setSearching(false);
    }
  }

  // Refresh the pins as the map settles on a new spot — the backend does the
  // distance maths, so this is just "what is near HERE". Debounced, because
  // LocationPicker fires onChange on every `moveend` and a customer hunting for
  // their street produces a burst of them.
  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    const t = setTimeout(() => {
      getNearbyOperators(picked)
        .then(({ operators: list }) => { if (!cancelled) setOperators(list); })
        .catch(() => { /* pins are additive; losing them must not break the flow */ });
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [picked?.lat, picked?.lng]);

  // The eligibility gate, exactly where Android calls it (`getConnReqCount` on
  // entry, and again after a successful submit).
  const refreshEligibility = useCallback(() => {
    const mobile = account?.mobileno || user?.mobileno || "";
    if (!mobile) return;
    checkRequestAllowed(mobile)
      .then(setEligibility)
      // A failed check must not lock a legitimate customer out — the backend
      // rejects a duplicate on its own anyway.
      .catch(() => setEligibility(null));
  }, [account?.mobileno, user?.mobileno]);

  useEffect(() => { refreshEligibility(); }, [refreshEligibility]);

  const loadServices = useCallback(() => {
    setServicesState("loading");
    getAvailableServices()
      .then(({ ok, services: list, message }) => {
        if (ok) { setServices(list); setServicesState("ready"); }
        else { setServicesState("failed"); toast.add(message || "Could not load services.", { type: "error" }); }
      })
      .catch((e) => { setServicesState("failed"); toast.add(e?.message || "Could not load services.", { type: "error" }); });
  }, []);

  useEffect(() => { loadServices(); }, [loadServices]);

  // Reverse-geocode for the Confirm Address dialog, mirroring Android's
  // ReverseGeocodingTask. Nominatim is the same source the map tiles come from;
  // a failure is not fatal — the coordinates are what the backend stores.
  async function reverseGeocode({ lat, lng }) {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
        { headers: { Accept: "application/json" } }
      );
      const d = await r.json();
      return d?.display_name || "";
    } catch (_) {
      return "";
    }
  }

  function openServices() {
    // Android disables the button outright; a toast says WHY, which the app
    // never does.
    if (eligibility && !eligibility.allowed) {
      toast.add(eligibility.reason || "You already have a pending request.", { type: "warning" });
      return;
    }
    if (!picked) { toast.add("Mark your location on the map first.", { type: "warning" }); return; }
    setShowServices(true);
  }

  async function confirmServices() {
    if (!chosen.length) { toast.add("Select at least one service.", { type: "warning" }); return; }
    setShowServices(false);
    // Open immediately — a dialog that appears a second after the tap reads
    // as "nothing happened". The address is normally already known from the
    // live strip; when it is not, it lands into the open dialog.
    setAddress(liveAddress);
    setConfirming(true);
    if (!liveAddress) {
      const text = await reverseGeocode(picked);
      setAddress((cur) => cur || text);
    }
  }

  async function confirmAddress() {
    setConfirming(false);
    const errs = validateRequest({ mobile: profile.mobile, services: chosen, lat: picked?.lat, lng: picked?.lng });
    const first = Object.values(errs)[0];
    if (first) { toast.add(first, { type: "error" }); return; }

    setSubmitting(true);
    try {
      const { ok, message } = await submitRequest({
        profile: { ...profile, address, pincode: extractPincode(address) },
        services: chosen,
        lat: picked.lat,
        lng: picked.lng,
      });
      setResult({ ok, message: message || (ok ? "Request submitted." : "Could not submit the request.") });
      if (ok) { setChosen([]); refreshEligibility(); }
    } catch (err) {
      setResult({ ok: false, message: err?.message || "Could not submit the request." });
    } finally {
      setSubmitting(false);
    }
  }

  const toggle = (id) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    // h-dvh, not min-h-dvh: a percentage height only resolves against a
    // DEFINITE ancestor height, and `min-height` does not make one. With
    // min-h-dvh the map's `height: 100%` computed to 0px on the phone (QA
    // screenshots 1 Sep and 5 Sep: dark void, pointer over the title). The
    // map area below also absolutely fills its box for the same reason.
    <div className="h-dvh flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      <header
        className="flex items-center gap-3 px-4 pb-3 bg-gradient-to-r from-indigo-600 to-blue-600 text-white"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}
      >
        <button onClick={() => navigate(-1)} className="p-1" aria-label="Go back">
          <ChevronLeftIcon className="h-6 w-6" />
        </button>
        <h1 className="flex-1 text-lg font-medium">New Connection</h1>
        {/* Android puts the ticket-status shortcut in the toolbar. */}
        <button
          onClick={() => navigate("/cust/new-connection/status")}
          className="p-1"
          aria-label="Ticket status"
        >
          <TicketIcon className="h-6 w-6" />
        </button>
      </header>

      {locState === "denied" || locState === "unsupported" ? (
        // Android's showGPSDisabledAlertToUser(). A browser cannot re-open its
        // permission prompt on its own, so this has to be a real screen with a
        // button — and it still offers the map, because panning by hand works
        // perfectly well without permission.
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <MapPinIcon className="h-14 w-14 text-indigo-500" />
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            Turn on location
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 max-w-xs">
            We use your location to mark where the new connection is needed and to find
            operators near you.
          </p>
          <button onClick={locate} className="px-5 py-3 rounded-xl font-semibold text-white bg-indigo-600">
            Enable location
          </button>
          <button onClick={() => setLocState("granted")} className="text-sm text-gray-500 dark:text-gray-400 underline">
            Choose on the map instead
          </button>
        </div>
      ) : (
        <>
          {/* relative + absolute-fill: an absolutely positioned child sizes
              against the flex item's USED height, which is always definite
              after layout — unlike a percentage, which needs a definite
              specified height and silently gets 0 otherwise. */}
          <div className="relative isolate z-0 flex-1 min-h-0">
            <div className="absolute inset-0">
              <LocationPicker
                center={centre}
                viewZoom={viewZoom}
                onChange={(ll) => { setViewZoom(undefined); setPicked({ lat: ll.lat, lng: ll.lng }); }}
                height="100%"
              >
                {operators.map((o) => (
                  <Marker
                    key={o.id}
                    position={[o.lat, o.lng]}
                    icon={OPERATOR_ICON}
                    eventHandlers={{ click: () => setOperator(o) }}
                  />
                ))}
              </LocationPicker>
            </div>

            {/* Android's searched_address_et, floated over the top of the map. */}
            <form
              onSubmit={searchAddress}
              className="absolute left-3 right-3 top-3 z-[600] flex items-center gap-2 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 px-3"
            >
              <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-gray-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search address or area"
                enterKeyHint="search"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 outline-none"
                aria-label="Search address"
              />
              <button
                type="submit"
                disabled={searching || !query.trim()}
                className="shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-400 disabled:opacity-40"
              >
                {searching ? "…" : "Go"}
              </button>
            </form>

            {/* Google Maps' my-location control (setMyLocationEnabled(true)). */}
            <button
              type="button"
              onClick={() => { setViewZoom(undefined); locate(); }}
              disabled={locState === "asking"}
              aria-label="Go to my location"
              title="My location"
              className="absolute right-3 bottom-3 z-[600] h-11 w-11 rounded-full bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-indigo-600 dark:text-indigo-400 disabled:opacity-60"
            >
              <MapPinIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Android's address_tv + progressBar2 under the map. */}
          <div className="px-4 py-2 text-xs bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">Marked location</p>
            <p className="mt-0.5 text-gray-800 dark:text-gray-100 line-clamp-2">
              {addressLoading
                ? "Locating address…"
                : liveAddress || (picked ? `${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}` : "Move the map to mark your location")}
            </p>
          </div>

          {eligibility && !eligibility.allowed && (
            <p className="px-4 py-2 text-center text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border-t border-amber-200 dark:border-amber-800">
              {eligibility.reason}
            </p>
          )}

          <div className="flex gap-3 p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 pb-safe">
            {/* Android shows both buttons and BOTH open the same picker. */}
            <button
              onClick={openServices}
              disabled={submitting || (eligibility ? !eligibility.allowed : false)}
              className="flex-1 py-3 rounded-full font-semibold text-white bg-indigo-700 disabled:opacity-60"
            >
              {submitting ? "Sending…" : "GET NEW CONNECTION"}
            </button>
            <button
              onClick={openServices}
              disabled={submitting || (eligibility ? !eligibility.allowed : false)}
              className="px-6 py-3 rounded-full font-semibold text-white bg-indigo-500 disabled:opacity-60"
            >
              SERVICES
            </button>
          </div>
        </>
      )}

      {/* SELECT SERVICE — checkboxes, because the backend says list_type:"multi". */}
      <Modal isOpen={showServices} onClose={() => setShowServices(false)} title="Select Service">
        <ul className="max-h-72 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
          {services.map((s) => (
            <li key={s.id}>
              <label className="flex items-center justify-between gap-3 py-3 cursor-pointer">
                <span className="text-sm text-gray-800 dark:text-gray-100">{s.title}</span>
                <input
                  type="checkbox"
                  checked={chosen.includes(s.id)}
                  onChange={() => toggle(s.id)}
                  className="h-5 w-5 accent-indigo-600"
                />
              </label>
            </li>
          ))}
          {!services.length && (
            <li className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {servicesState === "loading" ? "Loading services…"
                : servicesState === "failed" ? (
                  <button onClick={loadServices} className="font-semibold text-indigo-600 dark:text-indigo-400 underline">
                    Could not load services. Tap to retry
                  </button>
                ) : "No services are available right now."}
            </li>
          )}
        </ul>
        <button
          onClick={confirmServices}
          disabled={!chosen.length}
          className="mt-4 w-full py-3 rounded-xl font-semibold text-white bg-indigo-600 disabled:opacity-50"
        >
          {chosen.length ? `CONFIRM (${chosen.length})` : "CONFIRM"}
        </button>
      </Modal>

      {/* Confirm Address — Android's showAddressConfirmationDialog(). */}
      <Modal isOpen={confirming} onClose={() => setConfirming(false)} title="Confirm Address">
        {/* EDITABLE: dialog_address is an EditText pre-filled by the
            reverse-geocode, so the customer can correct a wrong house number
            before confirming. */}
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={3}
          placeholder={address ? "" : `Locating address… (pin ${picked?.lat?.toFixed(5)}, ${picked?.lng?.toFixed(5)})`}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-3 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-400"
        />
        <div className="mt-4 flex gap-3">
          <button
            onClick={confirmAddress}
            disabled={submitting}
            className="flex-1 py-3 rounded-xl font-semibold text-white bg-orange-500 disabled:opacity-60"
          >
            {submitting ? "Sending…" : "Ok"}
          </button>
          <button onClick={() => setConfirming(false)} className="flex-1 py-3 rounded-xl font-semibold text-white bg-gray-500">
            Cancel
          </button>
        </div>
      </Modal>

      {/* Operator Details — Android's dialog_operator_details_enhanced. */}
      <Modal isOpen={!!operator} onClose={() => setOperator(null)} title="Operator Details">
        <dl className="space-y-3 text-sm">
          <Detail label="Name" value={operator?.name} />
          <Detail label="Phone" value={operator?.phone} />
          <Detail label="Address" value={operator?.address} />
          {Number.isFinite(operator?.distance) && (
            <Detail label="Distance" value={`${operator.distance.toFixed(2)} km`} />
          )}
        </dl>
      </Modal>

      <Modal isOpen={!!result} onClose={() => setResult(null)} title="New connection">
        <p className="text-sm text-gray-700 dark:text-gray-200">{result?.message}</p>
        <button
          onClick={() => { const ok = result?.ok; setResult(null); if (ok) navigate("/cust/new-connection/status"); }}
          className="mt-4 w-full py-3 rounded-xl font-semibold text-white bg-indigo-600"
        >
          Ok
        </button>
      </Modal>
    </div>
  );
}

function Detail({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0 break-words text-gray-800 dark:text-gray-100">{value}</dd>
    </div>
  );
}

// A plain divIcon: Leaflet's default marker image needs bundler wiring that
// this app has never set up, and a CSS pin has no asset to 404 on.
const OPERATOR_ICON = L.divIcon({
  className: "",
  html: '<div style="width:22px;height:22px;border-radius:50%;background:#84cc16;border:3px solid #365314;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/** Best-effort 6-digit pincode out of a reverse-geocoded address string. */
function extractPincode(addr) {
  const m = String(addr || "").match(/\b(\d{6})\b/);
  return m ? m[1] : "";
}
