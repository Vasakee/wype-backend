const quais = require("quais");
const crypto = require("crypto");

/**
 * Generate a fresh Quai HD wallet for deployment / hot-wallet usage.
 * Run with: node scripts/generate-wallet.js
 */
function generate() {
  const entropy = crypto.randomBytes(32);
  const mnemonic = quais.Mnemonic.fromEntropy(entropy);
  const wallet = quais.QuaiHDWallet.fromMnemonic(mnemonic);

  // Derive a Cyprus-1 address (the currently active zone)
  const addrInfo = wallet.getNextAddressSync(0, quais.Zone.Cyprus1);

  console.log("=== New Quai HD Wallet ===");
  console.log("Address (Cyprus-1):", addrInfo.address);
  console.log("Mnemonic:          ", mnemonic.phrase);
  console.log(
    "\nFund this address with QUAI from the Orchard faucet:"
  );
  console.log("  https://orchard.faucet.quai.network");
  console.log("\n⚠️  Save the mnemonic securely — it is the ONLY way to recover this wallet.");
  console.log(
    "⚠️  Add it to .env as QUAI_DEPLOYER_MNEMONIC. Do NOT commit it to git."
  );
}

generate();
