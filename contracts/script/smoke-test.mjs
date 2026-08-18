/**
 * End-to-end smoke test against the deployed WypeEscrow on Quai.
 *
 * Exercises the two paths that carry the product's promises:
 *
 *   A. deposit -> claim    "send to someone who isn't on Wype yet"
 *   B. deposit -> refund   "if they don't claim in time, it comes back"
 *
 * Test B deliberately calls `refund` from an address that is neither the
 * depositor nor Wype, because that is the whole point: once an escrow expires,
 * anyone can send the money home. Wype cannot strand it.
 *
 * This spends real testnet QUAI and prints real transaction hashes.
 *
 *   node script/smoke-test.mjs
 */

import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as quais from 'quais';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ZONE = quais.Zone.Cyprus1;

process.loadEnvFile(resolve(ROOT, '.env'));

const ESCROW_ADDRESS = process.env.WYPE_ESCROW_ADDRESS || '0x0026622A9d39b81a8C20FabD10f43A8F89D6c608';
const DEPOSIT = quais.parseQuai('0.1');
const GAS_FLOAT = quais.parseQuai('1');
const SHORT_EXPIRY_SECONDS = 45;

const rpcUrl = (process.env.QUAI_RPC_URL || 'https://orchard.rpc.quai.network')
    .replace(/\/+$/, '')
    .replace(/\/(cyprus|paxos|hydra)\d$/i, '');

const provider = new quais.JsonRpcProvider(rpcUrl, undefined, {usePathing: true});
const abi = JSON.parse(readFileSync(resolve(ROOT, 'out/WypeEscrow.sol/WypeEscrow.json'), 'utf8')).abi;

/** The sender: funded, and the account that locks the money. */
const depositor = new quais.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
/** The Wype backend key that attests "this person proved they own the email". */
const verifier = new quais.Wallet(process.env.ESCROW_VERIFIER_PK, provider);

/** Generates a throwaway Cyprus-1 address to stand in for the recipient. */
function randomCyprus1() {
    for (;;) {
        const wallet = new quais.Wallet(quais.hexlify(quais.randomBytes(32)));
        if (quais.getZoneForAddress(wallet.address) === ZONE && quais.isQuaiAddress(wallet.address)) {
            return wallet;
        }
    }
}

function commitment(label) {
    return quais.keccak256(quais.toUtf8Bytes(`${label}:${Date.now()}:${quais.hexlify(quais.randomBytes(16))}`));
}

const STATE = ['None', 'Open', 'Claimed', 'Cancelled', 'Refunded'];
const q = (wei) => `${quais.formatQuai(wei)} QUAI`;

let failures = 0;
function check(label, actual, expected) {
    const ok = String(actual) === String(expected);
    if (!ok) failures++;
    console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${actual}, want ${expected})`}`);
}

/**
 * The clock the EVM actually uses for `block.timestamp`.
 *
 * Do not use `provider.getBlock()` for this. It returns a Quai work object whose
 * `woHeader.timestamp` runs hours ahead of the block's real time, which silently
 * pushes any expiry computed from it into the EVM's future — deposits then
 * refuse to refund with NotYetExpired. The flat `eth_getBlockByNumber` timestamp
 * is the one the contract sees.
 */
async function chainNow() {
    const block = await provider.send('eth_getBlockByNumber', ['latest', false], quais.Shard.Cyprus1);
    const seconds = Number(BigInt(block.timestamp));
    if (!Number.isFinite(seconds)) {
        throw new Error(`Could not read a block timestamp (got ${block?.timestamp})`);
    }
    return seconds;
}

// ---------------------------------------------------------------- preflight

console.log('\n=== PREFLIGHT ===');
const code = await provider.getCode(ESCROW_ADDRESS);
if (code === '0x') throw new Error(`No contract at ${ESCROW_ADDRESS}`);

const escrow = new quais.Contract(ESCROW_ADDRESS, abi, depositor);
console.log(`  contract:  ${ESCROW_ADDRESS} (${code.length} chars of bytecode)`);
console.log(`  chain id:  ${(await provider.getNetwork()).chainId}`);
console.log(`  depositor: ${depositor.address}  ${q(await provider.getBalance(depositor.address, 'latest'))}`);
console.log(`  verifier:  ${verifier.address}`);
check('on-chain verifier matches our signing key', await escrow.verifier(), verifier.address);

// ------------------------------------------------- A: deposit then claim

console.log('\n=== A. DEPOSIT -> CLAIM  ("Chidi signs up and claims") ===');

const chidi = randomCyprus1();
const commitmentA = commitment('claim-test');
const expiryA = (await chainNow()) + 7 * 24 * 60 * 60;

console.log(`  recipient: ${chidi.address} (fresh address, starts empty)`);
console.log(`  depositing ${q(DEPOSIT)}...`);

// Measure the contract's balance as a delta. Escrows from earlier runs may still
// be sitting here unclaimed, so an absolute figure proves nothing.
const contractBefore = await provider.getBalance(ESCROW_ADDRESS, 'latest');

const depositTxA = await escrow.deposit(commitmentA, expiryA, {value: DEPOSIT});
await depositTxA.wait();
console.log(`   tx ${depositTxA.hash}`);

const recordA = await escrow.getEscrow(commitmentA);
check('escrow state is Open', STATE[Number(recordA.state)], 'Open');
check('escrow holds the deposit', recordA.amount, DEPOSIT);
check('depositor recorded', recordA.depositor, depositor.address);
check('contract balance grew by the deposit', (await provider.getBalance(ESCROW_ADDRESS, 'latest')) - contractBefore, DEPOSIT);

// The backend signs only after it has verified the claimant owns the email.
const deadline = (await chainNow()) + 3600;
const digest = await escrow.claimDigest(commitmentA, chidi.address, deadline);
const signature = await verifier.signMessage(quais.getBytes(digest));
console.log(`  verifier signed a claim for ${chidi.address}`);

const claimTx = await escrow.claim(commitmentA, chidi.address, deadline, signature);
await claimTx.wait();
console.log(`   tx ${claimTx.hash}`);

check('recipient was paid', await provider.getBalance(chidi.address, 'latest'), DEPOSIT);
check('escrow state is Claimed', STATE[Number((await escrow.getEscrow(commitmentA)).state)], 'Claimed');
check('contract released the deposit', await provider.getBalance(ESCROW_ADDRESS, 'latest'), contractBefore);

// A second claim on the same escrow must fail.
let doubleClaimRejected = false;
try {
    await (await escrow.claim(commitmentA, chidi.address, deadline, signature)).wait();
} catch {
    doubleClaimRejected = true;
}
check('double claim rejected', doubleClaimRejected, true);

// ------------------------------------------ B: deposit then permissionless refund

console.log('\n=== B. DEPOSIT -> REFUND  ("nobody claimed, money goes home") ===');

// The refund is called by someone who is neither Wype nor the sender.
const stranger = verifier.connect(provider);
if ((await provider.getBalance(stranger.address, 'latest')) < GAS_FLOAT / 2n) {
    console.log(`  funding stranger ${stranger.address} with ${q(GAS_FLOAT)} for gas...`);
    // quais derives the zone from `from`, so a bare {to, value} is rejected.
    const fundTx = await depositor.sendTransaction({
        from: depositor.address,
        to: stranger.address,
        value: GAS_FLOAT,
    });
    await fundTx.wait();
}

const commitmentB = commitment('refund-test');
const expiryB = (await chainNow()) + SHORT_EXPIRY_SECONDS;

const contractBeforeB = await provider.getBalance(ESCROW_ADDRESS, 'latest');
console.log(`  depositing ${q(DEPOSIT)} with a ${SHORT_EXPIRY_SECONDS}s expiry...`);
const depositTxB = await escrow.deposit(commitmentB, expiryB, {value: DEPOSIT});
await depositTxB.wait();
console.log(`   tx ${depositTxB.hash}`);

// Refunding early must fail — the money is not free to move yet. Insist the
// failure is an on-chain revert, so a client-side argument error can't make this
// check pass for the wrong reason.
let earlyRefundError = 'no error — the call succeeded';
try {
    await (await escrow.connect(stranger).refund(commitmentB)).wait();
} catch (error) {
    earlyRefundError = error.shortMessage || error.message || String(error);
}
const revertedOnChain = /NotYetExpired|revert|CALL_EXCEPTION/i.test(earlyRefundError);
check(`refund before expiry reverted on-chain`, revertedOnChain, true);
if (!revertedOnChain) console.log(`         reason given: ${earlyRefundError}`);

// Ask the contract whether it considers the escrow expired, rather than
// comparing against a wall clock. The RPC is load-balanced, so `latest` jitters
// between nodes at different heights and its timestamp can run ahead of the one
// the EVM uses. `isClaimable` is evaluated by the EVM itself against the very
// `block.timestamp` that `refund` will check, so it cannot disagree.
process.stdout.write(`  waiting for the contract to consider it expired`);
const waitStarted = Date.now();
for (;;) {
    if (!(await escrow.isClaimable(commitmentB))) break;
    if (Date.now() - waitStarted > 5 * 60 * 1000) {
        throw new Error('Escrow still not expired after 5 minutes');
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 5000));
}
console.log(` expired after ${Math.round((Date.now() - waitStarted) / 1000)}s.`);

// Sample the sender's balance immediately before the refund. Measuring from
// before the deposit would net out to just the gas the sender paid to deposit,
// which says nothing about whether the refund paid out.
const senderBeforeRefund = await provider.getBalance(depositor.address, 'latest');

console.log(`  ${stranger.address} (not the sender, not Wype) calls refund...`);
const refundTx = await escrow.connect(stranger).refund(commitmentB);
await refundTx.wait();
console.log(`   tx ${refundTx.hash}`);

const senderAfterRefund = await provider.getBalance(depositor.address, 'latest');
check('escrow state is Refunded', STATE[Number((await escrow.getEscrow(commitmentB)).state)], 'Refunded');
check('contract released the deposit', await provider.getBalance(ESCROW_ADDRESS, 'latest'), contractBeforeB);
// The sender pays no gas here — the stranger did — so this is the full deposit.
check('sender got the full deposit back', senderAfterRefund - senderBeforeRefund, DEPOSIT);

// ------------------------------------------------------------------ summary

console.log('\n' + '─'.repeat(70));
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
console.log('\nTransactions (paste into the Quai explorer):');
console.log(`  deposit  ${depositTxA.hash}`);
console.log(`  claim    ${claimTx.hash}`);
console.log(`  deposit  ${depositTxB.hash}`);
console.log(`  refund   ${refundTx.hash}`);
console.log('─'.repeat(70) + '\n');

process.exit(failures === 0 ? 0 : 1);
