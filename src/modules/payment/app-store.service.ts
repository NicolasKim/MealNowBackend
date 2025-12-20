import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';
import { SignedDataVerifier, Environment, VerificationException } from '@apple/app-store-server-library';

@Injectable()
export class AppStoreService {
  private readonly logger = new Logger(AppStoreService.name);
  private readonly issuerId = process.env.APP_STORE_ISSUER_ID;
  private readonly keyId = process.env.APP_STORE_KEY_ID;
  private readonly privateKey: string | undefined;
  private readonly appId = process.env.APP_STORE_APP_ID;

  private token: string | null = null;
  private tokenExpiresAt: number = 0;

  private rootCertificates: Buffer[] = [];
  private verifier: SignedDataVerifier | null = null;

  constructor() {
    this.loadRootCertificates();
    const envKey = process.env.APP_STORE_PRIVATE_KEY;
    // ... (rest of constructor)

    // 1. Try to load from env var (content or path)
    if (envKey) {
      if (envKey.includes('-----BEGIN PRIVATE KEY-----')) {
        this.privateKey = envKey.replace(/\\n/g, '\n');
      } else {
        // Assume it is a path
        const keyPath = path.isAbsolute(envKey) ? envKey : path.resolve(process.cwd(), envKey);
        if (fs.existsSync(keyPath)) {
          try {
            this.privateKey = fs.readFileSync(keyPath, 'utf8');
            this.logger.log(`Loaded App Store Connect private key from env path: ${keyPath}`);
          } catch (e: any) {
            this.logger.error(`Failed to read key file from env path ${keyPath}: ${e.message}`);
          }
        } else {
          this.logger.warn(`APP_STORE_PRIVATE_KEY points to non-existent file: ${keyPath}`);
        }
      }
    } 
    
    // 2. If not found yet, try to load from default file locations based on Key ID
    if (!this.privateKey && this.keyId) {
      const filename = `AuthKey_${this.keyId}.p8`;
      const possiblePaths = [
        path.join(process.cwd(), 'resources', filename),
        path.join(process.cwd(), 'apps/api/resources', filename),
        path.resolve(__dirname, '../../../../resources', filename) // Relative to this file
      ];

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          try {
            this.privateKey = fs.readFileSync(p, 'utf8');
            this.logger.log(`Loaded App Store Connect private key from ${p}`);
            break;
          } catch (e: any) {
            this.logger.warn(`Found key file at ${p} but failed to read it: ${e.message}`);
          }
        }
      }
    }

    if (!this.privateKey) {
      this.logger.warn('App Store Connect private key not found in env or resources folder');
    }
  }

  private loadRootCertificates() {
    try {
      const certDir = path.join(process.cwd(), 'src/certs');
      const files = [
        'AppleIncRootCertificate.pem',
        'AppleComputerRootCertificate.pem',
        'AppleRootCA-G2.pem',
        'AppleRootCA-G3.pem'
      ];

      this.rootCertificates = files.map(file => fs.readFileSync(path.join(certDir, file)));
      this.logger.log(`Loaded ${this.rootCertificates.length} Apple Root CA certificates for verification.`);
    } catch (e) {
      this.logger.error('Failed to load Apple Root CA certificates', e);
    }
  }

  public getVerifier(): SignedDataVerifier {
    if (this.verifier) {
      return this.verifier;
    }

    const bundleId = process.env.BUNDLE_ID || 'com.dreamtracer.todaysmeal';
    const environment = (process.env.NODE_ENV === 'production') ? Environment.PRODUCTION : Environment.SANDBOX;

    this.verifier = new SignedDataVerifier(
      this.rootCertificates,
      true, // enableOnlineChecks
      environment,
      bundleId
    );
    return this.verifier;
  }

  async verifyJWS(token: string) {
    const verifier = this.getVerifier();
    try {
      const transactionInfo = await verifier.verifyAndDecodeTransaction(token);
      return transactionInfo;
    } catch (e: any) {
      this.logger.error(`JWS Verification failed: ${e.message}`);
      throw e;
    }
  }

  private getJwtToken(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && now < this.tokenExpiresAt - 60) {
      return this.token;
    }

    if (!this.issuerId || !this.keyId || !this.privateKey) {
      this.logger.warn('App Store Connect API credentials not configured');
      return '';
    }

    const payload = {
      iss: this.issuerId,
      exp: now + 20 * 60, // 20 minutes
      aud: 'appstoreconnect-v1'
    };

    try {
      this.token = jwt.sign(payload, this.privateKey, {
        algorithm: 'ES256',
        header: {
          alg: 'ES256',
          kid: this.keyId,
          typ: 'JWT'
        }
      });
      this.tokenExpiresAt = now + 20 * 60;
      return this.token;
    } catch (error) {
      this.logger.error('Failed to sign JWT for App Store Connect', error);
      return '';
    }
  }

  async getIapPrices(iapSkus: string[], territory: string = 'CHN') {
    const token = this.getJwtToken();
    if (!token) {
      return null;
    }

    try {
      // 1. Get the App ID (if not provided)
      let appId = this.appId;
      if (!appId) {
        // Fetch apps to find the first one or specific bundle ID
        const appsUrl = 'https://api.appstoreconnect.apple.com/v1/apps';
        const appsResponse = await axios.get(appsUrl, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (appsResponse.data.data && appsResponse.data.data.length > 0) {
          appId = appsResponse.data.data[0].id;
          this.logger.log(`Found App ID: ${appId}`);
        }
      }

      if (!appId) {
        this.logger.error('App ID not found and not provided in env');
        return null;
      }

      // 2. List In-App Purchases (V2) for the App
      // This gets us the list of IAPs associated with the app (Consumable, Non-Consumable, Non-Renewing Subscription)
      const iapsUrl = `https://api.appstoreconnect.apple.com/v1/apps/${appId}/inAppPurchasesV2`;
      const iapsPromise = axios.get(iapsUrl, {
        headers: { Authorization: `Bearer ${token}` }
      }).catch(err => {
        this.logger.error('Failed to fetch IAPs', err.message);
        return { data: { data: [] } };
      });

      // 3. List Auto-Renewable Subscriptions via Subscription Groups
      // Note: Subscriptions are organized in Subscription Groups. We must fetch groups first.
      const groupsUrl = `https://api.appstoreconnect.apple.com/v1/apps/${appId}/subscriptionGroups`;
      let allSubs: any[] = [];
      
      try {
        const groupsResponse = await axios.get(groupsUrl, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const groups = groupsResponse.data.data || [];
        
        // Fetch subscriptions for each group in parallel
        const subsPromises = groups.map((group: any) => {
          const groupSubsUrl = `https://api.appstoreconnect.apple.com/v1/subscriptionGroups/${group.id}/subscriptions`;
          return axios.get(groupSubsUrl, {
             headers: { Authorization: `Bearer ${token}` }
          }).then(res => res.data.data || []).catch(err => {
             this.logger.error(`Failed to fetch subscriptions for group ${group.id}`, err.message);
             return [];
          });
        });

        const subsResults = await Promise.all(subsPromises);
        allSubs = subsResults.flat();
      } catch (err: any) {
        this.logger.error('Failed to fetch Subscription Groups', err.message);
      }

      const [iapsResponse] = await Promise.all([iapsPromise]);
      
      const iaps = iapsResponse.data.data || [];
      const allProducts = [...iaps, ...allSubs];

      // Filter products to match the requested SKUs
      // Note: The 'attributes.productId' field holds the SKU (e.g., com.mealnow.premium.monthly)
      const matchingProducts = allProducts.filter((p: any) => iapSkus.includes(p.attributes.productId));

      const results = [];

      // 4. Get Price Points for each matching Product
      // We need to fetch the price points to get the actual price value and currency
      for (const product of matchingProducts) {
        let priceUrl = '';
        const isSubscription = product.type === 'subscriptions';
        
        if (isSubscription) {
            // For Subscriptions, we need the 'prices' resource which represents the scheduled/active prices
            priceUrl = `https://api.appstoreconnect.apple.com/v1/subscriptions/${product.id}/prices`;
        } else {
            // For IAPs (Consumable, etc.)
             // We must use iapPriceSchedule to get the configured prices, not pricePoints directly (which lists all possibilities).
             // However, the relationship name on the IAP resource is 'iapPriceSchedule'.
             // The endpoint to fetch manual prices is: v1/inAppPurchasePriceSchedules/{iapId}/manualPrices
             // Wait, the resource linked from IAP is 'iapPriceSchedule'.
             // Let's try to access the manual prices directly via the IAP relationship link pattern if possible,
             // or construct the URL: https://api.appstoreconnect.apple.com/v1/inAppPurchasePriceSchedules/{iapId}/manualPrices
             // Actually, the docs say: GET /v1/inAppPurchasePriceSchedules/{id}/manualPrices
             priceUrl = `https://api.appstoreconnect.apple.com/v1/inAppPurchasePriceSchedules/${product.id}/manualPrices`;
         }
         
         try {
            const params: any = { limit: 5 };
            if (territory) {
              params['filter[territory]'] = territory;
            }
 
            if (isSubscription) {
                params.include = 'subscriptionPricePoint,territory';
            } else {
                params.include = 'inAppPurchasePricePoint,territory';
            }
  
            const priceResponse = await axios.get(priceUrl, {
              headers: { Authorization: `Bearer ${token}` },
              params
            });
 
           if (isSubscription) {
               // Handle Subscription Price
               const prices = priceResponse.data.data || [];
               const included = priceResponse.data.included || [];
               
               if (prices.length > 0) {
                   const price = prices[0];
                   const pointId = price.relationships?.subscriptionPricePoint?.data?.id;
                   const territoryId = price.relationships?.territory?.data?.id;
                   
                   const point = included.find((p: any) => p.type === 'subscriptionPricePoints' && p.id === pointId);
                   const territoryObj = included.find((p: any) => p.type === 'territories' && p.id === territoryId);
                   
                   if (point) {
                       const currency = territoryObj?.attributes?.currency || 'USD';
                       results.push({
                           sku: product.attributes.productId,
                           price: point.attributes.customerPrice,
                           currency: currency,
                           priceFormatted: `${currency} ${point.attributes.customerPrice}`
                       });
                   }
               }
           } else {
                // Handle IAP Price (Manual Prices from Schedule)
                const prices = priceResponse.data.data || [];
                const included = priceResponse.data.included || [];
 
                if (prices.length > 0) {
                    const price = prices[0];
                    const pointId = price.relationships?.inAppPurchasePricePoint?.data?.id;
                    const territoryId = price.relationships?.territory?.data?.id;
                    
                    const point = included.find((p: any) => p.type === 'inAppPurchasePricePoints' && p.id === pointId);
                    const territoryObj = included.find((p: any) => p.type === 'territories' && p.id === territoryId);
                    
                    if (point) {
                         const currency = territoryObj?.attributes?.currency || 'USD';
    
                         results.push({
                             sku: product.attributes.productId,
                             price: point.attributes.customerPrice, // e.g. "9.99"
                             currency: currency,
                             priceFormatted: `${currency} ${point.attributes.customerPrice}`
                         });
                    }
                }
            }
        } catch (priceErr) {
            this.logger.error(`Failed to fetch price for Product ${product.id} (SKU: ${product.attributes.productId})`, priceErr);
        }
      }
      this.logger.log('Fetched prices from App Store Connect:', results);
      return results;
    } catch (error: any) {
      this.logger.error('Error fetching data from App Store Connect', error?.response?.data || error.message);
      return null;
    }
  }

  async verifyReceipt(receiptData: string): Promise<any> {
    const RECIPE_VERIFY_URL_PROD = 'https://buy.itunes.apple.com/verifyReceipt';
    const RECIPE_VERIFY_URL_SANDBOX = 'https://sandbox.itunes.apple.com/verifyReceipt';

    const verify = async (url: string, useSecret: boolean = true) => {
      const secret = process.env.APP_STORE_SHARED_SECRET;
      // Debug log for shared secret
      if (url === RECIPE_VERIFY_URL_PROD && useSecret) { // Only log once
        this.logger.log(`Verifying receipt. Secret length: ${secret?.length}, Starts with: ${secret?.substring(0, 4)}`);
      }
      
      const payload: any = {
        'receipt-data': receiptData,
        'exclude-old-transactions': true
      };
      if (useSecret && secret) {
        payload['password'] = secret;
      }

      try {
        const response = await axios.post(url, payload);
        return response.data;
      } catch (error: any) {
        this.logger.error(`Receipt verification failed at ${url}: ${error.message}`);
        throw error;
      }
    };

    let isSandbox = false;
    let data = await verify(RECIPE_VERIFY_URL_PROD, true);

    // 21007 = This receipt is from the test environment, but it was sent to the production environment for verification.
    if (data.status === 21007) {
      this.logger.log('Receipt is from sandbox, retrying verification with sandbox URL');
      isSandbox = true;
      data = await verify(RECIPE_VERIFY_URL_SANDBOX, true);
    }

    // 21004 = The shared secret you provided does not match the shared secret on file for your account.
    if (data.status === 21004) {
      this.logger.warn('Receipt verification failed with 21004 (Secret Mismatch). Retrying without secret...');
      const url = isSandbox ? RECIPE_VERIFY_URL_SANDBOX : RECIPE_VERIFY_URL_PROD;
      data = await verify(url, false);
    }

    return data;
  }
}
