/**
 * Deploys WypeEscrow to Quai Cyprus-1 using quais.js.
 *
 * Foundry can read from Quai (the `eth_` namespace is aliased) but it cannot
 * deploy: Quai encodes the shard in the contract address, so a deployment has to
 * grind until the resulting address lands in the right zone. `forge create`
 * doesn't do that; quais' ContractFactory does, via `grindContractAddress`.
 *
 * Compile with Foundry first, deploy with this:
 *   forge build
 *   node script/deploy-escrow.mjs
 *
 * Reads contracts/.env:
 *   QUAI_RPC_URL          bare host, e.g. https://orchard.rpc.quai.network
 *   DEPLOYER_PRIVATE_KEY  funded Cyprus-1 key
 *   ESCROW_VERIFIER       address that signs claims
 *   ESCROW_OWNER          address that can rotate the verifier (defaults to deployer)
 */

import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as quais from 'quais';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ARTIFACT = resolve(ROOT, 'out/WypeEscrow.sol/WypeEscrow.json');
const ZONE = quais.Zone.Cyprus1;

process.loadEnvFile(resolve(ROOT, '.env'));

function required(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set in contracts/.env`);
    return value;
}

/**
 * quais builds the zone path itself when `usePathing` is on, so it wants the
 * bare host. A `/cyprus1` suffix (correct for curl and cast) would be doubled
 * up and rejected as an invalid URL, so strip it.
 */
function normaliseRpcUrl(url) {
    return url.replace(/\/+$/, '').replace(/\/(cyprus|paxos|hydra)\d$/i, '');
}

function assertCyprus1(address, label) {
    const zone = quais.getZoneForAddress(address);
    if (zone !== ZONE) {
        throw new Error(`${label} ${address} is in zone ${zone}, not Cyprus-1 (${ZONE}).`);
    }
    if (!quais.isQuaiAddress(address)) {
        throw new Error(`${label} ${address} is a Qi (UTXO) address; the EVM needs a Quai address.`);
    }
}

const rpcUrl = normaliseRpcUrl(required('QUAI_RPC_URL'));
const verifier = required('ESCROW_VERIFIER');

const provider = new quais.JsonRpcProvider(rpcUrl, undefined, {usePathing: true});
const deployer = new quais.Wallet(required('DEPLOYER_PRIVATE_KEY'), provider);
const owner = process.env.ESCROW_OWNER || deployer.address;

assertCyprus1(deployer.address, 'Deployer');
assertCyprus1(verifier, 'ESCROW_VERIFIER');
assertCyprus1(owner, 'ESCROW_OWNER');

const network = await provider.getNetwork();
const balance = await provider.getBalance(deployer.address, 'latest');

console.log('\nDeploying WypeEscrow');
console.log(`  rpc:       ${rpcUrl}`);
console.log(`  chain id:  ${network.chainId}`);
console.log(`  deployer:  ${deployer.address}`);
console.log(`  balance:   ${quais.formatQuai(balance)} QUAI`);
console.log(`  owner:     ${owner}`);
console.log(`  verifier:  ${verifier}\n`);

if (balance === 0n) {
    console.error(`The deployer has no QUAI, so it cannot pay for the deployment.`);
    console.error(`Fund ${deployer.address} from the Quai testnet faucet, then run this again.\n`);
    process.exit(1);
}

const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
const bytecode = artifact.bytecode?.object;
if (!bytecode) throw new Error(`No bytecode in ${ARTIFACT}. Run \`forge build\` first.`);

// Quai records an IPFS CID of the contract's metadata on every deployment, and
// quais rejects anything that isn't a well-formed 46-character CIDv0. The chain
// does not check that it resolves, so this defaults to the canonical empty
// directory CID — a real, valid CID that says "no metadata published yet".
// Pin the build's metadata.json and set ESCROW_IPFS_HASH to its CID to make it
// meaningful.
const ipfsHash = process.env.ESCROW_IPFS_HASH || 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn';
if (ipfsHash.length !== 46) {
    throw new Error(`ESCROW_IPFS_HASH must be a 46-character CIDv0, got ${ipfsHash.length} characters`);
}

const factory = new quais.ContractFactory(artifact.abi, bytecode, deployer, ipfsHash);

console.log('Sending deployment transaction...');
const contract = await factory.deploy(owner, verifier);
const deployTx = contract.deploymentTransaction();
console.log(`  tx hash:   ${deployTx?.hash}`);
console.log('  waiting for it to be mined...');

await contract.waitForDeployment();
const address = await contract.getAddress();

console.log(`\nDeployed.`);
console.log(`  WypeEscrow: ${address}`);
console.log(`  zone:       ${quais.getZoneForAddress(address)} (Cyprus-1)\n`);

// Read the contract back so we know it is genuinely callable, not just deployed.
const deployed = new quais.Contract(address, artifact.abi, provider);
const [onChainVerifier, onChainOwner, maxDuration] = await Promise.all([
    deployed.verifier(),
    deployed.owner(),
    deployed.MAX_DURATION(),
]);

console.log('Verified on-chain state:');
console.log(`  verifier():     ${onChainVerifier}  ${onChainVerifier === verifier ? 'OK' : 'MISMATCH'}`);
console.log(`  owner():        ${onChainOwner}  ${onChainOwner === owner ? 'OK' : 'MISMATCH'}`);
console.log(`  MAX_DURATION(): ${maxDuration} seconds\n`);

console.log('─'.repeat(70));
console.log('Add to the backend .env:\n');
console.log(`QUAI_RPC_URL=${rpcUrl}`);
console.log(`WYPE_ESCROW_ADDRESS=${address}`);
console.log('─'.repeat(70) + '\n');
