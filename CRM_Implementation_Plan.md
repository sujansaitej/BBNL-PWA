# CRM PWA - PRD Implementation Plan

## Overview

This plan implements a PRD-compliant operator-facing CRM PWA with strict adherence to specified UI flows, service structures, and navigation patterns. The implementation uses **mock data only** as backend APIs are not provided.

## User Review Required

> [!IMPORTANT]
> **PRD Compliance**: This implementation will follow the PRD **exactly** with zero UI deviations. All screens, flows, and CTAs will match the specifications provided.

> [!WARNING]
> **Backend Integration**: All API-dependent actions will be clearly marked as "Backend integration pending" and will use mock data for demonstration purposes only.

> [!IMPORTANT]
> **Existing CRM Features**: Features marked as "same as existing CRM" (Reset PPPoE, Reset MAC ID, Reset Password, Data Usage, Order History) will be preserved **exactly as-is** with no modifications to layout, styling, or behavior.

---

## Proposed Changes

### Core Navigation & Data Layer

#### [NEW] [mockData.js](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/mockData.js)

Complete mock data structure containing:
- **FoFi Smart Box Plans**: FTA-only and FTA + DPO packages with pricing, validity, features
- **Voice Plans**: Single active plan structure (expandable for future)
- **Internet Plans**: Current subscribed plan details
- **IPTV Packages**: 
  - FTA base packs (mandatory selection)
  - Add-on packages
  - A-la-carte channels
- **Customer Service Subscriptions**: Mock customer data with active services
- **Device Information**: Unicast/Multicast Device IDs, MAC addresses, serial numbers
- **Payment Records**: Transaction history for mock demonstrations

#### [MODIFY] [Routes.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/routes/Routes.jsx)

Add new routes:
```javascript
// Customer services hub
/customer/:customerId/services

// Service-specific routes
/customer/:customerId/service/fofi-smart-box
/customer/:customerId/service/voice
/customer/:customerId/service/internet
/customer/:customerId/service/iptv

// Device validation
/customer/:customerId/device-validation

// Payment flows
/customer/:customerId/payment
/customer/:customerId/payment/success
/customer/:customerId/activation
```

#### [MODIFY] [Customerlist.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/pages/Customerlist.jsx)

Update customer selection handler:
- On customer click → navigate to `/customer/:customerId/services`
- Pass customer data via route state
- Maintain existing UI/styling exactly

---

### Services Hub

#### [NEW] [Services.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/pages/Services.jsx)

Main services landing page after customer selection.

**UI Requirements (PRD-locked)**:
- Search bar at top (matches existing CRM pattern)
- Service cards grid layout
- **Keep first 4 services as-is** (from existing CRM)
- **Remove**: Games, Multiservice, IP Camera
- **Rename**: Cable TV → IPTV
- Each service card shows:
  - Service icon
  - Service name
  - "SPECIAL OFFER" badge (if applicable)
  - Price (if applicable)
  - Right arrow for navigation

**Services to display**:
1. Internet
2. Voice
3. FoFi Smart Box
4. IPTV (renamed from Cable TV)
5. [First 4 existing services preserved]

---

### Service: FoFi Smart Box

#### [NEW] [FoFiSmartBox.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/pages/services/FoFiSmartBox.jsx)

**Existing User Flow**:
1. **Plan Display Section**
   - Show all available packages (FTA-only, FTA + DPO)
   - Display current plan status with expiry date
   - Show plan details (service name, plan name, expiry)

2. **Device Information Section** (BEFORE payment)
   - Unicast Device ID (read-only text field)
   - Multicast Device ID (read-only text field)
   - Display format matches screenshot #3

3. **Action Buttons**
   - "Renew / Change Plan" button
   - Navigate to payment on click

4. **Payment Flow**
   - Redirect to unified payment page
   - Show plan details, amount, payment methods

5. **Success Screen**
   - Renewal confirmation
   - Updated expiry date
   - "Backend integration pending" note

**New User Flow**:
1. **Plan Selection**
   - Radio buttons for FTA-only OR FTA + DPO
   - Display plan features, pricing, validity
   - "Continue" button (disabled until selection)

2. **Device Validation** (MANDATORY before payment)
   - **Option A: QR Scan**
     - "Scan QR Code" button
     - Instructions: "QR code is displayed on your TV screen"
     - Camera interface (UI only, mock validation)
   - **Option B: Manual Entry**
     - Input field: "Enter Inventory Serial Number"
     - "Fetch MAC Address" button
     - Display fetched MAC (mock data)
   - Validation status indicator
   - "Continue to Payment" button (disabled until validated)

3. **Payment Page**
   - Same as existing user flow

4. **Activation Screen**
   - "Activation Successful" OR "Pending Activation"
   - Device details summary
   - Plan details
   - "Backend integration pending" note

#### [NEW] [DeviceValidation.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/components/services/DeviceValidation.jsx)

Reusable component for device validation (used by FoFi Smart Box and IPTV).

---

### Service: Voice

#### [NEW] [Voice.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/pages/services/Voice.jsx)

**UI Requirements (PRD-locked)**:
- Display **ONE** active voice plan only
- Read-only view (no edit/change options)
- Show plan details:
  - Service name: "Voice"
  - Plan name (e.g., "UNLIMITED CALLING")
  - Price
  - Validity/Expiry
- Match screenshot #2 layout exactly
- "SPECIAL OFFER" badge if applicable
- **No plan change UI** (structure allows future expansion)
- "Backend integration pending" note at bottom

---

### Service: Internet

#### [NEW] [Internet.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/pages/services/Internet.jsx)

**UI Requirements (PRD-locked)**:
- Display current subscribed internet plan (read-only)
- Show plan details:
  - Service name: "Internet"
  - Plan name (e.g., "300MB_Tripleplay")
  - Expiry date with time
- Match screenshot #1 layout exactly
- "PAY BILL" button (navigate to payment)
- "Link FoFi Box" button (navigate to FoFi service)
- **Static message** (displayed prominently):
  > "For internet plan upgrades, must use NetMon app."
- Filter badge showing "Internet"
- "Backend integration pending" note

---

### Service: IPTV (Cable TV Renamed)

#### [NEW] [IPTV.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/pages/services/IPTV.jsx)

**Existing User Flow**:
- Similar to FoFi Smart Box existing user
- Display current IPTV subscription
- Show FoFi Box ID (read-only)
- Plan details (service name, plan name, expiry)
- "SELECT PACKAGES" and "SELECT CHANNELS" buttons
- Navigate to package/channel selection

**New User Flow** (PRD-locked steps):

1. **FTA Base Pack Selection** (MANDATORY FIRST STEP)
   - Display all available FTA base packs
   - Radio button selection
   - Plan details (name, price, channels included)
   - "Continue" button (disabled until selection)

2. **Add-ons & A-la-carte Selection**
   - Two tabs: "Add-on Packages" | "A-la-carte Channels"
   - **Add-on Packages Tab**:
     - Checkbox list of add-on packages
     - Each shows: name, price, details
     - Multi-select allowed
   - **A-la-carte Channels Tab**:
     - Checkbox list of individual channels
     - Each shows: channel name, price
     - Multi-select allowed
   - Allow **combination** of both add-ons AND a-la-carte
   - Running total display at bottom
   - "Continue" button

3. **Device Validation**
   - Same flow as FoFi Smart Box (QR scan OR manual entry)
   - Reuse `DeviceValidation.jsx` component

4. **Payment**
   - Show selected FTA base pack
   - Show selected add-ons (if any)
   - Show selected a-la-carte channels (if any)
   - Total amount
   - Payment method selection

5. **Success Screen**
   - Activation confirmation
   - Package summary
   - Device details

#### [NEW] [IPTVPackageSelection.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/components/services/IPTVPackageSelection.jsx)

Component for FTA base pack selection.

#### [NEW] [IPTVAddonsChannels.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/components/services/IPTVAddonsChannels.jsx)

Component for add-ons and a-la-carte channel selection with tabs.

---

### Shared Components

#### [NEW] [ServiceCard.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/components/services/ServiceCard.jsx)

Reusable service card component for Services page.

#### [NEW] [PaymentPage.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/pages/PaymentPage.jsx)

Unified payment page for all services:
- Service/plan summary
- Amount breakdown
- Payment method selection (mock)
- "Pay Now" button
- Success/failure handling
- "Backend integration pending" note

#### [NEW] [SuccessScreen.jsx](file:///d:/bbnl-crm-pwa/crm-pwa-master/src/components/SuccessScreen.jsx)

Reusable success/activation screen component.

---

### Existing CRM Features (DO NOT MODIFY)

The following features **MUST remain unchanged**:

- **Reset PPPoE**: Existing UI, layout, behavior preserved
- **Reset MAC ID**: Match screenshot #5 exactly (already exists)
- **Reset Password**: Existing implementation
- **Data Usage**: Existing implementation
- **Order History**: Existing implementation

These will be verified to ensure no modifications during implementation.

---

## Mock Data Structure

### Example: FoFi Smart Box Plans
```javascript
{
  fofiPlans: [
    {
      id: 'fta-only-1',
      name: 'FTA Basic',
      type: 'FTA-only',
      price: 99,
      validity: '30 days',
      features: ['100+ Free channels', 'HD Quality', 'No subscription']
    },
    {
      id: 'fta-dpo-1',
      name: 'FTA + DPO Premium',
      type: 'FTA + DPO',
      price: 299,
      validity: '30 days',
      features: ['100+ Free channels', '200+ Premium channels', 'HD Quality']
    }
  ]
}
```

### Example: Customer Service Subscription
```javascript
{
  customerId: 'testus1',
  services: {
    internet: {
      active: true,
      planName: '300MB_Tripleplay',
      expiryDate: '2026-03-14T11:59:59',
      internetId: 'testus1'
    },
    voice: {
      active: true,
      planName: 'UNLIMITED CALLING',
      price: 100,
      expiryDate: '2026-02-28T23:59:59'
    },
    fofi: {
      active: true,
      planName: 'FTA+SUPER SAVER PACK',
      expiryDate: '2026-01-16T11:59:59',
      deviceInfo: {
        unicastId: 'UC123456789',
        multicastId: 'MC987654321',
        fofiBoxId: 'A43EA0A01F4A'
      }
    },
    iptv: {
      active: true,
      planName: 'FTA+SUPER SAVER PACK',
      expiryDate: '2026-01-16T11:59:59',
      fofiBoxId: 'A43EA0A01F4A'
    }
  }
}
```

---

## State Management

Use React Context or local state management:
- **CustomerContext**: Store selected customer data
- **ServiceContext**: Store service-specific state (plan selections, device validation status)
- **PaymentContext**: Store payment flow data

---

## Verification Plan

### Automated Tests

**Component Tests** (to be created):
```bash
# Run component tests
npm test
```

Tests to create:
- `Services.test.jsx`: Verify service cards render correctly, removed services not shown
- `FoFiSmartBox.test.jsx`: Test existing/new user flow branching
- `DeviceValidation.test.jsx`: Test QR/manual validation UI states
- `IPTV.test.jsx`: Test mandatory FTA selection, add-on/channel combinations
- `PaymentPage.test.jsx`: Test payment summary calculations

### Browser Testing

**Flow 1: Existing FoFi User Renewal**
1. Start dev server: `npm run dev`
2. Login with operator credentials
3. Navigate: Dashboard → All Users → Select customer "testus1"
4. Click "FoFi Smart Box" service
5. Verify:
   - Current plan displayed with expiry
   - Device information section shows Unicast/Multicast IDs (read-only)
   - "Renew / Change Plan" button present
6. Click "Renew / Change Plan"
7. Verify payment page shows correct plan and amount
8. Complete mock payment
9. Verify renewal success screen

**Flow 2: New FoFi User Activation**
1. Select customer without FoFi service
2. Click "FoFi Smart Box" service
3. Verify plan selection screen (FTA-only vs FTA + DPO)
4. Select a plan → Click "Continue"
5. Verify device validation screen appears
6. Test QR scan option (UI only)
7. Test manual entry option:
   - Enter serial number
   - Click "Fetch MAC Address"
   - Verify MAC displayed
8. Verify "Continue to Payment" enabled after validation
9. Complete payment flow
10. Verify activation screen

**Flow 3: IPTV New Subscription**
1. Select customer without IPTV
2. Click "IPTV" service
3. Verify FTA base pack selection (mandatory)
4. Select FTA pack → Continue
5. Verify add-ons & channels screen with tabs
6. Select multiple add-ons
7. Switch to a-la-carte tab, select channels
8. Verify running total updates
9. Continue to device validation
10. Complete validation and payment
11. Verify success screen shows all selections

**Flow 4: Services Page Navigation**
1. From customer selection, navigate to Services page
2. Verify:
   - Search bar present
   - First 4 existing services present
   - Games, Multiservice, IP Camera NOT shown
   - "Cable TV" renamed to "IPTV"
   - Voice service shows "SPECIAL OFFER" badge
3. Click each service, verify navigation

**Flow 5: Read-only Services**
1. Navigate to Voice service
2. Verify:
   - Single plan displayed
   - No edit/change buttons
   - Read-only view
3. Navigate to Internet service
4. Verify:
   - Current plan displayed
   - Message: "For internet plan upgrades, must use NetMon app."
   - "PAY BILL" and "Link FoFi Box" buttons present

**Flow 6: Existing CRM Features**
1. Verify Reset MAC ID screen matches screenshot #5 exactly
2. Verify other existing features (PPPoE, Password, Data Usage, Order History) unchanged

### Manual Verification Checklist

- [ ] All PRD flows implemented exactly as specified
- [ ] No UI deviations from PRD
- [ ] All "Backend integration pending" notes present
- [ ] Mock data populates all screens correctly
- [ ] Device validation mandatory before payment (FoFi, IPTV)
- [ ] IPTV requires FTA base pack selection first
- [ ] Voice service is read-only
- [ ] Internet service shows NetMon upgrade message
- [ ] Existing CRM features unchanged
- [ ] Navigation flow matches PRD: Login → All Users → Customer List → Services → Individual Service

---

## Backend Integration Notes

All components will include clear comments:

```javascript
// TODO: Backend integration pending
// Replace mock data with API call to: /api/services/fofi/plans
```

API-dependent actions will show user-facing messages:
> "Backend integration pending - using mock data for demonstration"

---

## Timeline Estimate

- **Phase 1-2** (Setup & Routing): 2-3 hours
- **Phase 3** (Services Page): 1-2 hours
- **Phase 4** (FoFi Smart Box): 3-4 hours
- **Phase 5-6** (Voice & Internet): 1-2 hours
- **Phase 7** (IPTV): 3-4 hours
- **Phase 8-10** (Payment, Device Validation, Verification): 2-3 hours

**Total**: ~15-20 hours

---

## Notes

- All wording, labels, and messages follow PRD exactly
- No new CTAs or steps added beyond PRD
- UI matches existing CRM where specified
- Clear separation between mock data and backend integration points
- Component structure allows future backend integration without major refactoring
