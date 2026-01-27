export const SUBSCRIPTION_PLAN_IDS = {
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  YEARLY: 'yearly',
};

export const SUBSCRIPTION_IAP_SKUS = {
  MONTHLY: 'com.mealnow.premium.monthly',
  QUARTERLY: 'com.mealnow.premium.quarterly',
  YEARLY: 'com.mealnow.premium.yearly',
};

export const PREMIUM_PLAN_SKUS = Object.values(SUBSCRIPTION_IAP_SKUS);

export const ALL_PREMIUM_PLANS = [
  ...Object.values(SUBSCRIPTION_PLAN_IDS),
  ...Object.values(SUBSCRIPTION_IAP_SKUS),
];
