# CRM PWA - PRD Implementation Task List

## Phase 1: Project Setup & Mock Data
- [ ] Create mock data structure for all services
  - [ ] FoFi Smart Box plans (FTA-only, FTA + DPO)
  - [ ] Voice plans
  - [ ] Internet plans
  - [ ] IPTV packages (FTA base packs, add-ons, a-la-carte channels)
  - [ ] Customer service subscriptions
  - [ ] Device information (Unicast/Multicast IDs, MAC addresses)

## Phase 2: Navigation & Routing
- [ ] Update routing structure
  - [ ] Add `/customer/:customerId/services` route
  - [ ] Add service-specific routes (FoFi, Voice, Internet, IPTV)
  - [ ] Add device validation routes
  - [ ] Add payment and success/activation routes
- [ ] Modify customer list to navigate to services page on selection

## Phase 3: Services Page (Main Hub)
- [ ] Create `Services.jsx` page component
- [ ] Implement service cards layout
  - [ ] Keep first 4 existing services as-is
  - [ ] Remove: Games, Multiservice, IP Camera
  - [ ] Rename: Cable TV → IPTV
- [ ] Add navigation to individual service pages
- [ ] Match existing CRM UI styling exactly

## Phase 4: FoFi Smart Box Service
- [ ] Create `FoFiSmartBox.jsx` component
- [ ] Implement existing user flow
  - [ ] Display all packages (FTA-only, FTA + DPO)
  - [ ] Show current plan status
  - [ ] Display device information section (Unicast/Multicast IDs - read-only)
  - [ ] Add "Renew / Change Plan" button
  - [ ] Integrate with payment flow
  - [ ] Create renewal success screen
- [ ] Implement new user flow
  - [ ] Plan selection screen (FTA-only OR FTA + DPO)
  - [ ] Device validation screen
    - [ ] QR scan option (UI only, backend pending)
    - [ ] Manual entry option (serial number → MAC fetch)
  - [ ] Validation logic (disable payment until validated)
  - [ ] Payment integration
  - [ ] Activation/Pending activation screen

## Phase 5: Voice Service
- [ ] Create `Voice.jsx` component
- [ ] Display single active voice plan (read-only)
- [ ] Show plan details
- [ ] Add "Backend integration pending" note
- [ ] Structure for future expansion (no UI changes)

## Phase 6: Internet Service
- [ ] Create `Internet.jsx` component
- [ ] Display current subscribed plan (read-only)
- [ ] Show static message: "For internet plan upgrades, must use NetMon app."
- [ ] Match existing CRM Internet overview UI from screenshots

## Phase 7: IPTV Service (Cable TV Renamed)
- [ ] Create `IPTV.jsx` component
- [ ] Implement FTA base pack selection (mandatory first step)
- [ ] Create add-on packages selection screen
- [ ] Create a-la-carte channels selection screen
- [ ] Allow combination of add-ons + a-la-carte
- [ ] Implement device validation flow (same as FoFi Smart Box)
- [ ] Integrate payment flow
- [ ] Create success screen

## Phase 8: Existing CRM Features (DO NOT CHANGE)
- [ ] Verify existing features remain unchanged
  - [ ] Reset PPPoE
  - [ ] Reset MAC ID
  - [ ] Reset Password
  - [ ] Data Usage
  - [ ] Order History

## Phase 9: Payment Flow
- [ ] Create unified payment component
- [ ] Show payment summary
- [ ] Payment method selection (mock)
- [ ] Success/failure handling
- [ ] Backend integration markers

## Phase 10: Device Validation Components
- [ ] Create `QRScanner.jsx` component (UI only)
- [ ] Create `ManualDeviceEntry.jsx` component
- [ ] Implement validation state management
- [ ] Add backend integration notes

## Phase 11: Testing & Verification
- [ ] Test complete navigation flow
- [ ] Verify all PRD requirements met
- [ ] Ensure no UI deviations from PRD
- [ ] Test with mock data
- [ ] Verify existing features unchanged
- [ ] Browser testing for all flows
