/**
 * Deploys WypeRegistry to Quai Cyprus-1 using quais.js.
 *
 * Compile with Foundry first, deploy with this:
 *   forge build
 *   node script/deploy-registry.mjs
 *
 * Reads contracts/.env:
 *   QUAI_RPC_URL          bare host, e.g. https://orchard.rpc.quai.network
 *   DEPLOYER_PRIVATE_KEY  funded Cyprus-1 key
 *   REGISTRY_OWNER        address that can register/clear names (defaults to deployer)
 */

import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as quais from 'quais';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ARTIFACT = resolve(ROOT, 'out/WypeRegistry.sol/WypeRegistry.json');
const ZONE = quais.Zone.Cyprus1;

process.loadEnvFile(resolve(ROOT, '.env'));

function required(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set in contracts/.env`);
    return value;
}

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

const provider = new quais.JsonRpcProvider(rpcUrl, undefined, {usePathing: true});
const deployer = new quais.Wallet(required('DEPLOYER_PRIVATE_KEY'), provider);
const owner = process.env.REGISTRY_OWNER || deployer.address;

assertCyprus1(deployer.address, 'Deployer');
assertCyprus1(owner, 'REGISTRY_OWNER');

const network = await provider.getNetwork();
const balance = await provider.getBalance(deployer.address, 'latest');

console.log('\nDeploying WypeRegistry');
console.log(`  rpc:       ${rpcUrl}`);
console.log(`  chain id:  ${network.chainId}`);
console.log(`  deployer:  ${deployer.address}`);
console.log(`  balance:   ${quais.formatQuai(balance)} QUAI`);
console.log(`  owner:     ${owner}\n`);

if (balance === 0n) {
    console.error(`The deployer has no QUAI, so it cannot pay for the deployment.`);
    console.error(`Fund ${deployer.address} from the Quai testnet faucet, then run this again.\n`);
    process.exit(1);
}

const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
const bytecode = artifact.bytecode?.object;
if (!bytecode) throw new Error(`No bytecode in ${ARTIFACT}. Run \`forge build\` first.`);

const ipfsHash = process.env.REGISTRY_IPFS_HASH || 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn';
if (ipfsHash.length !== 46) {
    throw new Error(`REGISTRY_IPFS_HASH must be a 46-character CIDv0, got ${ipfsHash.length} characters`);
}

const factory = new quais.ContractFactory(artifact.abi, bytecode, deployer, ipfsHash);

console.log('Sending deployment transaction...');
const contract = await factory.deploy(owner);
const deployTx = contract.deploymentTransaction();
console.log(`  tx hash:   ${deployTx?.hash}`);
console.log('  waiting for it to be mined...');

await contract.waitForDeployment();
const address = await contract.getAddress();

console.log(`\nDeployed.`);
console.log(`  WypeRegistry: ${address}`);
console.log(`  zone:         ${quais.getZoneForAddress(address)} (Cyprus-1)\n`);

const deployed = new quais.Contract(address, artifact.abi, provider);
const [onChainOwner, nameCount] = await Promise.all([
    deployed.owner(),
    deployed.nameCount(),
]);

console.log('Verified on-chain state:');
console.log(`  owner():     ${onChainOwner}  ${onChainOwner === owner ? 'OK' : 'MISMATCH'}`);
console.log(`  nameCount(): ${nameCount}\n`);

console.log('─'.repeat(70));
console.log('Add to the backend .env:\n');
console.log(`WYPE_REGISTRY_ADDRESS=${address}`);
console.log('─'.repeat(70) + '\n');
