const quais = require("quais");
const RegistryJson = require("../artifacts/contracts/Registry.sol/Registry.json");
const EscrowJson = require("../artifacts/contracts/Escrow.sol/Escrow.json");
require("dotenv").config();

async function deploy() {
  const rpcUrl = process.env.QUAI_RPC_URL || "https://rpc.quai.network";
  const provider = new quais.JsonRpcProvider(rpcUrl, undefined, {
    usePathing: true,
  });

  const mnemonic = process.env.QUAI_DEPLOYER_MNEMONIC;
  if (!mnemonic) {
    throw new Error("QUAI_DEPLOYER_MNEMONIC is not set in .env");
  }

  // Create HD wallet from mnemonic
  const phrase = quais.Mnemonic.fromPhrase(mnemonic);
  const wallet = quais.QuaiHDWallet.fromMnemonic(phrase);
  wallet.connect(provider);

  // Get the Cyprus-1 address
  const addrInfo = wallet.getNextAddressSync(0, quais.Zone.Cyprus1);
  console.log("Deployer address:", addrInfo.address);

  const balance = await provider.getBalance(addrInfo.address);
  console.log("Deployer balance:", quais.formatQuai(balance), "QUAI");

  // Deploy Registry
  console.log("\n--- Deploying Registry ---");
  const RegistryFactory = new quais.ContractFactory(
    RegistryJson.abi,
    RegistryJson.bytecode,
    wallet
  );
  const registry = await RegistryFactory.deploy();
  console.log("Registry tx:", registry.deploymentTransaction().hash);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("Registry deployed to:", registryAddress);

  // Deploy Escrow
  console.log("\n--- Deploying Escrow ---");
  const EscrowFactory = new quais.ContractFactory(
    EscrowJson.abi,
    EscrowJson.bytecode,
    wallet
  );
  const escrow = await EscrowFactory.deploy();
  console.log("Escrow tx:", escrow.deploymentTransaction().hash);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("Escrow deployed to:", escrowAddress);

  console.log("\n=== Deployment Summary ===");
  console.log("QUAI_REGISTRY_ADDRESS=" + registryAddress);
  console.log("QUAI_ESCROW_ADDRESS=" + escrowAddress);
  console.log("\nAdd these to your .env file.");
}

deploy().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
