/**
 * @type import('hardhat/config').HardhatUserConfig
 */
require("@nomicfoundation/hardhat-toolbox");
require("@quai/hardhat-deploy-metadata");
require("dotenv").config({ path: "./.env" });

module.exports = {
  defaultNetwork: "cyprus1",
  networks: {
    cyprus1: {
      url: process.env.QUAI_RPC_URL || "https://rpc.quai.network",
      accounts: process.env.QUAI_DEPLOYER_PRIVATE_KEY
        ? [process.env.QUAI_DEPLOYER_PRIVATE_KEY]
        : [],
      chainId: 9, // mainnet cyprus1; use 15000 for orchard testnet
    },
    // Uncomment for Orchard testnet:
    // orchard: {
    //   url: process.env.QUAI_RPC_URL || "https://orchard.rpc.quai.network/cyprus1",
    //   accounts: process.env.QUAI_DEPLOYER_PRIVATE_KEY
    //     ? [process.env.QUAI_DEPLOYER_PRIVATE_KEY]
    //     : [],
    //   chainId: 15000,
    // },
  },
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: { enabled: true, runs: 1000 },
          metadata: {
            bytecodeHash: "ipfs",
            useLiteralContent: true,
          },
          evmVersion: "london",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 20000,
  },
};
