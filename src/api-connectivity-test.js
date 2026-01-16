// Quick API connectivity test for Vite dev environment
// Commented out to avoid console warnings - uncomment if you need to test API connectivity
/*
const formData = new FormData();
formData.append('username', import.meta.env.VITE_API_USERNAME);
formData.append('password', import.meta.env.VITE_API_PASSWORD);

fetch('/api/ServiceApis/custlogin', {
  method: 'POST',
  headers: {
    'Authorization': import.meta.env.VITE_API_AUTH_KEY,
    'username': import.meta.env.VITE_API_USERNAME,
    'password': import.meta.env.VITE_API_PASSWORD,
    'appkeytype': import.meta.env.VITE_API_APP_USER_TYPE,
    'appversion': import.meta.env.VITE_API_APP_VERSION
  },
  body: formData
})
  .then(res => res.json())
  .then(data => {
    console.log('API connectivity test result:', data);
    if (data.status && data.status.err_code === 0) {
      console.log('✅ API connectivity test passed successfully!');
    } else {
      console.warn('⚠️ API connectivity test returned error:', data);
      alert('API connectivity test result: ' + JSON.stringify(data));
    }
  })
  .catch(err => {
    console.error('API connectivity test error:', err);
    alert('API connectivity test error: ' + err);
  });
*/

