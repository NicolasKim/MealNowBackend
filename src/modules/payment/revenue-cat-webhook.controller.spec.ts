import { Test, TestingModule } from '@nestjs/testing';
import { RevenueCatWebhookController } from './revenue-cat-webhook.controller';
import { BillingService } from '../billing/billing.service';
import { UnauthorizedException } from '@nestjs/common';

describe('RevenueCatWebhookController', () => {
  let controller: RevenueCatWebhookController;
  let billingService: BillingService;

  const mockBillingService = {
    linkAppStoreSubscription: jest.fn(),
    updateAppStoreSubscriptionStatus: jest.fn(),
    updateAppStoreAutoRenewStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RevenueCatWebhookController],
      providers: [
        {
          provide: BillingService,
          useValue: mockBillingService,
        },
      ],
    }).compile();

    controller = module.get<RevenueCatWebhookController>(RevenueCatWebhookController);
    billingService = module.get<BillingService>(BillingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleWebhook', () => {
    const mockAuthToken = 'test-token';
    const originalEnv = process.env;

    beforeAll(() => {
      process.env = { ...originalEnv, REVENUECAT_WEBHOOK_AUTH_TOKEN: mockAuthToken };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should throw UnauthorizedException if auth header is invalid', async () => {
      await expect(
        controller.handleWebhook({}, 'invalid-token')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return error if event is missing', async () => {
      const result = await controller.handleWebhook({}, mockAuthToken);
      expect(result).toEqual({ ok: false, reason: 'Missing event' });
    });

    it('should handle INITIAL_PURCHASE event', async () => {
      const event = {
        type: 'INITIAL_PURCHASE',
        app_user_id: 'user123',
        original_transaction_id: 'trans123',
        product_id: 'prod123',
        expiration_at_ms: 1234567890,
      };

      await controller.handleWebhook({ event }, mockAuthToken);

      expect(billingService.linkAppStoreSubscription).toHaveBeenCalledWith(
        'user123',
        'trans123',
        'prod123',
        'active',
        1234567890,
        true
      );
    });

    it('should handle RENEWAL event', async () => {
      const event = {
        type: 'RENEWAL',
        original_transaction_id: 'trans123',
        product_id: 'prod123',
        expiration_at_ms: 1234567890,
        app_user_id: 'user123',
      };

      await controller.handleWebhook({ event }, mockAuthToken);

      expect(billingService.updateAppStoreSubscriptionStatus).toHaveBeenCalledWith(
        'trans123',
        'active',
        1234567890,
        'prod123'
      );
    });

    it('should handle CANCELLATION event', async () => {
      const event = {
        type: 'CANCELLATION',
        original_transaction_id: 'trans123',
        app_user_id: 'user123',
      };

      await controller.handleWebhook({ event }, mockAuthToken);

      expect(billingService.updateAppStoreAutoRenewStatus).toHaveBeenCalledWith(
        'trans123',
        false
      );
    });

    it('should handle EXPIRATION event', async () => {
      const event = {
        type: 'EXPIRATION',
        original_transaction_id: 'trans123',
        app_user_id: 'user123',
      };

      await controller.handleWebhook({ event }, mockAuthToken);

      expect(billingService.updateAppStoreSubscriptionStatus).toHaveBeenCalledWith(
        'trans123',
        'expired'
      );
    });
  });
});
