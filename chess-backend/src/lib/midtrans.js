const midtransClient = require('midtrans-client');
const { v4: uuidv4 } = require('uuid');

// Midtrans client instances
const snap = new midtransClient.Snap({
  isProduction: process.env.NODE_ENV === 'production',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.NODE_ENV === 'production',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const PLATFORM_FEE_PCT = 0.04;  // 4% commission on winnings

/**
 * Create a Midtrans Snap payment token (covers all payment methods)
 * Returns snapToken for frontend, orderId for tracking
 */
async function createDepositTransaction({ userId, username, email, amount }) {
  const orderId = `DEP-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;

  const params = {
    transaction_details: {
      order_id: orderId,
      gross_amount: amount,
    },
    customer_details: {
      first_name: username,
      email: email,
    },
    item_details: [{
      id: 'DEPOSIT',
      price: amount,
      quantity: 1,
      name: 'Deposit Saldo Chess Arena',
      category: 'Digital Goods',
    }],
    enabled_payments: [
      'gopay', 'shopeepay', 'other_qris',
      'bca_va', 'bni_va', 'bri_va', 'mandiri_bill', 'permata_va',
      'credit_card', 'akulaku', 'kredivo',
    ],
    callbacks: {
      finish: `${process.env.FRONTEND_URL}/wallet?status=success`,
      error: `${process.env.FRONTEND_URL}/wallet?status=error`,
      pending: `${process.env.FRONTEND_URL}/wallet?status=pending`,
    },
    custom_expiry: {
      expiry_duration: 24,
      unit: 'hour',
    },
    metadata: {
      user_id: userId,
      type: 'deposit',
    },
  };

  const transaction = await snap.createTransaction(params);
  return { snapToken: transaction.token, snapUrl: transaction.redirect_url, orderId };
}

/**
 * Create a payout / disbursement request (Midtrans Iris)
 * For real disbursement: use Midtrans Iris API
 * For now: create withdraw transaction record, mark as processing
 */
async function createWithdrawRequest({ userId, username, bankCode, accountNumber, accountName, amount }) {
  const orderId = `WIT-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;

  // In production with Midtrans Iris:
  // const iris = new midtransClient.Iris({ ... });
  // await iris.createBeneficiaries({ ... });
  // await iris.createPayouts({ ... });

  // For now — return orderId, mark pending, admin approves manually
  // This is how many platforms work (manual review for first withdrawal, automated after KYC)
  return {
    orderId,
    status: 'pending',
    estimatedTime: '1-3 business days',
  };
}

/**
 * Verify Midtrans webhook notification
 */
async function verifyNotification(notificationBody) {
  const statusResponse = await coreApi.transaction.notification(notificationBody);
  return statusResponse;
}

/**
 * Get transaction status from Midtrans
 */
async function getTransactionStatus(orderId) {
  const status = await coreApi.transaction.status(orderId);
  return status;
}

/**
 * Calculate platform fee
 */
function calculateFee(amount) {
  return Math.round(amount * PLATFORM_FEE_PCT);
}

/**
 * Calculate net winnings after fee
 */
function netWinnings(stakes) {
  const fee = calculateFee(stakes);
  return { gross: stakes, fee, net: stakes - fee };
}

module.exports = {
  snap,
  coreApi,
  createDepositTransaction,
  createWithdrawRequest,
  verifyNotification,
  getTransactionStatus,
  calculateFee,
  netWinnings,
  PLATFORM_FEE_PCT,
};
