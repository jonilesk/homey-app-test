#!/usr/bin/env node
'use strict';

/**
 * Standalone test script for Xiaomi Cloud login.
 * Replicates the Python Tasshack implementation exactly.
 * Usage: node test-login.js <username> <password>
 */

const crypto = require('crypto');

const LOGIN_URL = 'https://account.xiaomi.com/pass/serviceLogin';
const LOGIN_AUTH_URL = 'https://account.xiaomi.com/pass/serviceLoginAuth2';

function generateClientId() {
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  }
  return id;
}

function userAgent(clientId) {
  return `Android-7.1.1-1.0.0-ONEPLUS A3010-136-${clientId} APP/xiaomi.smarthome APPV/62830`;
}

function parseLoginResponse(text) {
  const cleaned = text.replace('&&&START&&&', '');
  return JSON.parse(cleaned);
}

async function testLogin(username, password) {
  const clientId = generateClientId();
  console.log('Client ID:', clientId);
  console.log('User-Agent:', userAgent(clientId));
  console.log('');

  // ─── Step 1 ───
  console.log('=== STEP 1: serviceLogin ===');
  const step1Url = `${LOGIN_URL}?sid=xiaomiio&_json=true`;
  console.log('GET', step1Url);
  const step1Cookie = `sdkVersion=3.8.6; deviceId=${clientId}`;
  console.log('Cookie:', step1Cookie);

  const step1Resp = await fetch(step1Url, {
    method: 'GET',
    headers: {
      'User-Agent': userAgent(clientId),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': step1Cookie,
    },
  });

  const step1Text = await step1Resp.text();
  console.log('Status:', step1Resp.status);

  // Capture Set-Cookie headers
  const setCookies = step1Resp.headers.getSetCookie?.() || [];
  console.log('Set-Cookie count:', setCookies.length);
  
  // Collect valid cookies
  const cookieMap = new Map();
  for (const cookie of setCookies) {
    const match = cookie.match(/^([^=]+)=([^;]*)/);
    if (match) {
      const name = match[1].trim();
      const value = match[2].trim();
      if (value !== 'EXPIRED' && value !== '' && !cookie.toLowerCase().includes('max-age=0')) {
        cookieMap.set(name, value);
        console.log(`  Cookie kept: ${name}=${value.substring(0, 30)}...`);
      } else {
        console.log(`  Cookie skipped: ${name}=${value}`);
      }
    }
  }

  const step1Data = parseLoginResponse(step1Text);
  console.log('Response code:', step1Data.code);
  console.log('_sign:', step1Data._sign);
  console.log('location:', step1Data.location ? step1Data.location.substring(0, 80) + '...' : '(empty)');
  console.log('');

  // ─── Step 2 ───
  console.log('=== STEP 2: serviceLoginAuth2 ===');
  const hash = crypto.createHash('md5').update(password).digest('hex').toUpperCase();
  console.log('Password MD5 hash:', hash);

  const body = new URLSearchParams({
    user: username,
    hash,
    callback: 'https://sts.api.io.mi.com/sts',
    sid: 'xiaomiio',
    qs: '%3Fsid%3Dxiaomiio%26_json%3Dtrue',
  });
  if (step1Data._sign) {
    body.append('_sign', step1Data._sign);
  }

  console.log('POST body:', body.toString());

  // Build Step 2 cookies
  let step2Cookie = `sdkVersion=3.8.6; deviceId=${clientId}`;
  for (const [name, value] of cookieMap) {
    step2Cookie += `; ${name}=${value}`;
  }
  console.log('Cookie:', step2Cookie);

  const step2Url = `${LOGIN_AUTH_URL}?_json=true`;
  console.log('POST', step2Url);

  const step2Resp = await fetch(step2Url, {
    method: 'POST',
    headers: {
      'User-Agent': userAgent(clientId),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': step2Cookie,
    },
    body: body.toString(),
  });

  const step2Text = await step2Resp.text();
  console.log('Status:', step2Resp.status);
  const step2Data = parseLoginResponse(step2Text);
  console.log('Response code:', step2Data.code);
  console.log('description:', step2Data.description);
  console.log('location:', step2Data.location || '(empty)');
  console.log('notificationUrl:', step2Data.notificationUrl || '(none)');
  console.log('captchaUrl:', step2Data.captchaUrl || '(none)');
  console.log('pwd:', step2Data.pwd);
  console.log('Full response:', JSON.stringify(step2Data, null, 2));

  if (step2Data.location) {
    console.log('');
    console.log('=== STEP 3: Get service token ===');
    console.log('GET', step2Data.location.substring(0, 80) + '...');
    
    const step3Resp = await fetch(step2Data.location, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent(clientId),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'manual',
    });
    console.log('Status:', step3Resp.status);
    const step3Cookies = step3Resp.headers.getSetCookie?.() || [];
    for (const c of step3Cookies) {
      if (c.startsWith('serviceToken=')) {
        console.log('SERVICE TOKEN FOUND!', c.substring(0, 50) + '...');
      }
    }
  }
}

// Get credentials from command line
const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error('Usage: node test-login.js <username> <password>');
  process.exit(1);
}

testLogin(username, password).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
