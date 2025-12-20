import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { Logger } from '@nestjs/common';

// Configuration
const API_URL = 'http://localhost:3000/webhooks/app-store';
const SECRET_KEY = 'test-secret'; // Doesn't matter for jwt.decode()

async function simulateWebhook() {
  const logger = new Logger('WebhookSimulator');
  const transactionId = '1000000999999999';
  const originalTransactionId = '1000000888888888';
  
  // 1. Construct Transaction Info
  const transactionInfo = {
    transactionId,
    originalTransactionId,
    webOrderLineItemId: '1000000000000000',
    bundleId: 'com.example.app',
    productId: 'com.example.app.subscription.monthly',
    subscriptionGroupIdentifier: '20000000',
    purchaseDate: Date.now(),
    originalPurchaseDate: Date.now(),
    expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000, // +30 days
    quantity: 1,
    type: 'Auto-Renewable Subscription',
    inAppOwnershipType: 'PURCHASED',
    signedDate: Date.now(),
    environment: 'Sandbox',
    transactionReason: 'PURCHASE',
    storefront: 'USA',
    storefrontId: '143441',
    price: 999,
    currency: 'USD'
  };

  const signedTransactionInfo = jwt.sign(transactionInfo, SECRET_KEY);

  // 2. Construct Notification Payload
  const payload = {
    notificationType: 'SUBSCRIBED', // Change this to test other types: DID_RENEW, EXPIRED, REFUND, etc.
    subtype: 'INITIAL_BUY',
    notificationUUID: '00000000-0000-0000-0000-000000000000',
    data: {
      appAppleId: 123456789,
      bundleId: 'com.example.app',
      bundleVersion: '1.0.0',
      environment: 'Sandbox',
      signedTransactionInfo: signedTransactionInfo,
      signedRenewalInfo: jwt.sign({
        originalTransactionId,
        autoRenewProductId: 'com.example.app.subscription.monthly',
        productId: 'com.example.app.subscription.monthly',
        autoRenewStatus: 1
      }, SECRET_KEY)
    },
    version: '2.0',
    signedDate: Date.now()
  };

  const signedPayload = jwt.sign(payload, SECRET_KEY);

  console.log(`Sending webhook to ${API_URL}...`);
  console.log(`Type: ${payload.notificationType}, Subtype: ${payload.subtype}`);
  console.log(`OriginalTransactionId: ${originalTransactionId}`);

  try {
    const response = await axios.post(API_URL, { signedPayload });
    console.log('Response:', response.status, response.data);
  } catch (error: any) {
    console.error('Error sending webhook:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

simulateWebhook();
