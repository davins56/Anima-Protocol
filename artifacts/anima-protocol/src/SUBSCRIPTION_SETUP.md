# Subscription System Setup

## Components Created

### 1. **SubscriptionPlans** (`components/subscription/SubscriptionPlans.jsx`)
Main subscription pricing page showing:
- Basic (Free) - Chat only
- Premium ($19.99/month) - All features
- Feature comparison matrix
- Checkout button

### 2. **SubscriptionCard** (`components/subscription/SubscriptionCard.jsx`)
Individual plan card with:
- Plan name and price
- Feature list with included/excluded items
- Subscribe button
- Current plan badge

### 3. **Subscription Page** (`pages/Subscription.jsx`)
Full-page route for subscription management

### 4. **Backend Functions**

#### `createCheckoutSession`
Creates Stripe checkout session:
- Validates user authentication
- Prevents iframe checkout (requires published app)
- Returns Stripe checkout URL
- Logs all transactions

#### `handleStripeWebhook`
Processes Stripe webhook events:
- Validates webhook signature
- Handles: checkout.session.completed, subscription.updated, subscription.deleted
- Logs subscription changes

## Setup Steps

### 1. Add Subscription Route to App.jsx

```javascript
import Subscription from './pages/Subscription';

// In Routes section:
<Route path="/subscription" element={<Subscription />} />
```

### 2. Create Stripe Product & Price

First product is already created. Now create the price:

```bash
# In Dashboard, go to Stripe integration
# Get the product ID and create a price:
# - Amount: 1999 (cents, so $19.99)
# - Billing: Monthly
```

Then update `PREMIUM_PRICE_ID` in SubscriptionPlans.jsx with actual price ID.

### 3. Register Webhook Handler

In Dashboard > Code > Functions:
- Find `handleStripeWebhook` function
- Copy the webhook endpoint URL
- Go to Stripe Dashboard > Webhooks
- Add endpoint with these events:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

### 4. Set Webhook Secret

After registering webhook in Stripe:
- Copy the webhook signing secret
- Add as environment variable: `STRIPE_WEBHOOK_SECRET`

## Testing Payments

**Test Card**: `4242 4242 4242 4242`
- Expiry: Any future date
- CVC: Any 3 digits

## Feature Gating

To restrict features to premium users, add checks:

```javascript
const isPremium = user?.subscription_tier === "premium";
if (!isPremium) {
  return <UpgradePrompt />;
}
```

Update User entity to include:
```json
{
  "subscription_tier": {
    "type": "string",
    "enum": ["free", "premium"],
    "default": "free"
  },
  "stripe_customer_id": {
    "type": "string"
  }
}
```

## Going Live

1. **Claim Stripe Account**: Dashboard > Integrations > Claim Account
2. **Add Real Keys**: Provide your Stripe live keys in integrations settings
3. **Update Cards**: Use live card numbers for testing
4. **Monitor Transactions**: Dashboard > Billing tracks all payments

## Components to Add Feature Checks

These should check `user.subscription_tier === "premium"`:
- RelationshipEvolutionGraph
- RelationshipTimeline
- Character creation
- World building tools
- Quest tracking
- Voice synthesis

Add a simple check:
```javascript
{isPremium ? <Component /> : <LockMessage />}
``