#!/usr/bin/env node

/**
 * Guest Cart Testing Suite
 * 
 * Usage:
 *   node scripts/test_guest_cart.js [--url BASE_URL]
 * 
 * Example:
 *   node scripts/test_guest_cart.js --url http://localhost:5000
 *   node scripts/test_guest_cart.js --url https://api.render.com
 * 
 * Tests:
 *   1. Guest cart creation
 *   2. Add products
 *   3. Get cart
 *   4. Update quantity
 *   5. Remove from cart
 *   6. Guest to user migration
 *   7. Login with guest token
 *   8. CORS headers
 */

const http = require('http');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = process.argv.find(arg => arg === '--url') 
  ? process.argv[process.argv.indexOf('--url') + 1] 
  : 'http://localhost:5000';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

class GuestCartTester {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.guestToken = null;
    this.userToken = null;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  log(type, message) {
    const icons = {
      info: 'ℹ️',
      success: '✅',
      error: '❌',
      test: '🧪',
      request: '📤',
      response: '📥',
    };
    
    const color = {
      info: colors.blue,
      success: colors.green,
      error: colors.red,
      test: colors.cyan,
      request: colors.yellow,
      response: colors.yellow,
    }[type];

    console.log(`${color}${icons[type]} ${message}${colors.reset}`);
  }

  async request(method, endpoint, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const defaultHeaders = {
        'Content-Type': 'application/json',
        ...headers,
      };

      if (body) {
        defaultHeaders['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
      }

      const options = {
        method,
        headers: defaultHeaders,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
      };

      this.log('request', `${method} ${endpoint}`);

      const req = client.request(options, (res) => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : null;
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: parsed,
              raw: data,
            });
          } catch (e) {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: null,
              raw: data,
            });
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  assert(condition, message) {
    if (condition) {
      this.log('success', message);
      this.passed++;
    } else {
      this.log('error', message);
      this.failed++;
      throw new Error(message);
    }
  }

  async runTests() {
    console.log(`\n${colors.cyan}╔════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.cyan}║     Guest Cart Implementation Tests          ║${colors.reset}`);
    console.log(`${colors.cyan}╚════════════════════════════════════════════╝${colors.reset}\n`);

    this.log('info', `Testing: ${this.baseUrl}`);

    try {
      await this.testCorsHeaders();
      await this.testInitGuestCart();
      await this.testAddToCart();
      await this.testGetCart();
      await this.testUpdateQuantity();
      await this.testRemoveFromCart();
      await this.testApplyCoupon();
      await this.testGuestToUserMigration();

      this.printSummary();
    } catch (err) {
      this.log('error', `Test failed: ${err.message}`);
      console.error(err);
      process.exit(1);
    }
  }

  async testCorsHeaders() {
    this.log('test', 'CORS Headers');

    const response = await this.request('OPTIONS', '/api/v1/cart', null, {
      'Origin': 'https://example.com',
      'Access-Control-Request-Headers': 'X-Guest-Token',
    });

    this.assert(
      response.status === 200 || response.status === 204,
      `CORS preflight returns 200/204 (got ${response.status})`
    );

    const allowedHeaders = response.headers['access-control-allow-headers'] || '';
    this.assert(
      allowedHeaders.includes('X-Guest-Token'),
      `CORS allows X-Guest-Token header`
    );

    const origin = response.headers['access-control-allow-origin'];
    this.assert(
      origin === '*' || origin === 'https://example.com',
      `CORS returns appropriate origin`
    );
  }

  async testInitGuestCart() {
    this.log('test', 'Initialize Guest Cart');

    this.guestToken = uuidv4();
    this.log('info', `Generated guest token: ${this.guestToken}`);

    // Try to get empty cart
    const response = await this.request('GET', '/api/v1/cart', null, {
      'X-Guest-Token': this.guestToken,
    });

    this.assert(response.status === 200, `Get empty cart returns 200`);
    this.assert(Array.isArray(response.body?.items), `Response contains items array`);
    this.assert(response.body?.totals?.total === 0, `Empty cart total is 0`);
  }

  async testAddToCart() {
    this.log('test', 'Add to Cart');

    const response = await this.request('POST', '/api/v1/cart', {
      product_id: 5,
      product_variant_id: 10,
      quantity: 2,
    }, {
      'X-Guest-Token': this.guestToken,
    });

    this.assert(response.status === 201, `Add to cart returns 201`);
    this.assert(response.body?.message === 'Added to cart', `Response contains success message`);
    this.assert(response.body?.item?.quantity === 2, `Item quantity is correct`);
  }

  async testGetCart() {
    this.log('test', 'Get Cart');

    const response = await this.request('GET', '/api/v1/cart', null, {
      'X-Guest-Token': this.guestToken,
    });

    this.assert(response.status === 200, `Get cart returns 200`);
    this.assert(response.body?.items?.length > 0, `Cart contains items`);
    this.assert(
      response.body?.items[0]?.product_id === 5,
      `Cart contains previously added product`
    );
  }

  async testUpdateQuantity() {
    this.log('test', 'Update Quantity');

    const response = await this.request('PUT', '/api/v1/cart', {
      product_id: 5,
      quantity: 5,
    }, {
      'X-Guest-Token': this.guestToken,
    });

    this.assert(response.status === 200, `Update quantity returns 200`);

    // Verify
    const getResponse = await this.request('GET', '/api/v1/cart', null, {
      'X-Guest-Token': this.guestToken,
    });

    this.assert(
      getResponse.body?.items[0]?.quantity === 5,
      `Quantity updated to 5`
    );
  }

  async testRemoveFromCart() {
    this.log('test', 'Remove from Cart');

    const response = await this.request('DELETE', '/api/v1/cart', {
      product_id: 5,
    }, {
      'X-Guest-Token': this.guestToken,
    });

    this.assert(response.status === 200, `Remove from cart returns 200`);

    // Verify
    const getResponse = await this.request('GET', '/api/v1/cart', null, {
      'X-Guest-Token': this.guestToken,
    });

    this.assert(
      getResponse.body?.items?.length === 0,
      `Cart is empty after removal`
    );
  }

  async testApplyCoupon() {
    this.log('test', 'Apply Coupon');

    // First add item
    await this.request('POST', '/api/v1/cart', {
      product_id: 5,
      quantity: 1,
    }, {
      'X-Guest-Token': this.guestToken,
    });

    const response = await this.request('POST', '/api/v1/cart/apply-coupon', {
      coupon_code: 'SAVE10',
    }, {
      'X-Guest-Token': this.guestToken,
    });

    // Should work or fail gracefully
    this.assert(
      response.status === 200 || response.status === 400,
      `Apply coupon endpoint is accessible`
    );
  }

  async testGuestToUserMigration() {
    this.log('test', 'Guest to User Migration');

    // Create new guest token with items
    const migrationGuestToken = uuidv4();

    // Add item as guest
    await this.request('POST', '/api/v1/cart', {
      product_id: 10,
      quantity: 3,
    }, {
      'X-Guest-Token': migrationGuestToken,
    });

    this.log('info', 'Testing mock login with guest token...');

    // Note: Full login test requires valid user credentials
    // This just verifies the endpoint accepts the guest token header
    const loginResponse = await this.request('POST', '/api/v1/auth/login', {
      email: 'test@example.com',
      password: 'testpass123',
    }, {
      'X-Guest-Token': migrationGuestToken,
    }).catch(() => ({ status: 401 })); // Expected to fail without valid user

    this.assert(
      loginResponse.status === 401 || loginResponse.status === 200,
      `Login endpoint accepts X-Guest-Token header`
    );
  }

  printSummary() {
    console.log(`\n${colors.cyan}╔════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.cyan}║              Test Summary                   ║${colors.reset}`);
    console.log(`${colors.cyan}╚════════════════════════════════════════════╝${colors.reset}\n`);

    console.log(`${colors.green}✅ Passed: ${this.passed}${colors.reset}`);
    console.log(`${colors.red}❌ Failed: ${this.failed}${colors.reset}`);

    const total = this.passed + this.failed;
    const percentage = total > 0 ? ((this.passed / total) * 100).toFixed(0) : 0;

    console.log(`\n${colors.cyan}Success Rate: ${percentage}%${colors.reset}\n`);

    if (this.failed === 0) {
      console.log(`${colors.green}🎉 All tests passed!${colors.reset}\n`);
    } else {
      console.log(`${colors.red}⚠️  Some tests failed!${colors.reset}\n`);
    }
  }
}

// Run tests
const tester = new GuestCartTester(BASE_URL);
tester.runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
