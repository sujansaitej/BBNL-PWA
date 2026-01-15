// Order history API integration

function getBaseUrl() {
  if (import.meta.env.PROD) return import.meta.env.VITE_API_BASE_URL;
  return '/api/'; // Use proxy in development to avoid CORS issues
}

function getHeadersForm() {
  return {
    Authorization: import.meta.env.VITE_API_AUTH_KEY,
    username: import.meta.env.VITE_API_USERNAME,
    password: import.meta.env.VITE_API_PASSWORD,
    appkeytype: import.meta.env.VITE_API_APP_USER_TYPE,
    appversion: import.meta.env.VITE_API_APP_VERSION,
  };
}

export async function getOrderHistory({ apiopid, cid }) {
  const url = `${getBaseUrl()}apis/custpayhistory`;
  
  // Get the logged-in user to use their credentials
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const loggedInOpId = user.op_id;
  
  const headers = {
    ...getHeadersForm(),
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  
  // Use logged-in user's op_id if available, otherwise use provided apiopid
  const finalOpId = loggedInOpId || apiopid;
  
  const body = new URLSearchParams({ 
    apiopid: finalOpId, 
    cid 
  }).toString();
  
  console.log('🔵 Order History API Request:', { url, apiopid: finalOpId, cid });
  
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}
