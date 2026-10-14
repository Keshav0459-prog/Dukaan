
async function runTests() {
  const baseUrl = 'http://localhost:5000';
  console.log('--- Testing Dukaan API Security Layers ---');

  // 1. Health check & Security Headers
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    const headers = Object.fromEntries(res.headers.entries());
    console.log('1. Health check status:', res.status);
    console.log('   X-Powered-By header present?:', Boolean(headers['x-powered-by']));
    console.log('   X-Content-Type-Options:', headers['x-content-type-options']);
    console.log('   X-Frame-Options:', headers['x-frame-options']);
    console.log('   RateLimit Headers:', headers['ratelimit-limit'], 'Remaining:', headers['ratelimit-remaining']);
  } catch (err) {
    console.error('Failed to connect to server:', err.message);
    process.exit(1);
  }

  // 2. NoSQL Injection Test on Login
  try {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: { $gt: '' }, password: { $gt: '' } })
    });
    const data = await res.json();
    console.log('2. NoSQL Injection login attempt status:', res.status, '- message:', data.message);
  } catch (err) {
    console.error('NoSQL injection test error:', err.message);
  }

  // 3. Validation on Register (Short password, bad email)
  try {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A', email: 'invalid-email', password: '123' })
    });
    const data = await res.json();
    console.log('3. Input validation test status:', res.status, '- message:', data.message);
  } catch (err) {
    console.error('Validation test error:', err.message);
  }

  // 4. Invalid ObjectId parameter protection (should return 404 or 400, NOT 500 CastError)
  try {
    const res = await fetch(`${baseUrl}/api/products/invalid-id-here`);
    const data = await res.json();
    console.log('4. Invalid ObjectId parameter test status:', res.status, '- message:', data.message);
  } catch (err) {
    console.error('Invalid ID test error:', err.message);
  }

  // 5. Test Auth Rate Limiter
  console.log('5. Testing Auth Rate Limiting (triggering successive attempts)...');
  let hitRateLimit = false;
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `test${i}@dukaan.test`, password: 'password123' })
    });
    if (res.status === 429) {
      const data = await res.json();
      console.log(`   Attempt ${i + 1} got 429 Too Many Requests:`, data.message);
      hitRateLimit = true;
      break;
    }
  }
  console.log('   Auth Rate Limiter working as expected?:', hitRateLimit);

  console.log('--- All Security Checks Completed ---');
}

runTests();
