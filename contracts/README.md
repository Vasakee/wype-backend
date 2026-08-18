# Wype Contracts

Solidity contracts for [Wype](../README.md), built with [Foundry](https://book.getfoundry.sh/).

## Why this exists

Wype lets you send money to an **email address**. When the recipient already has
a Wype account there is a wallet to pay and the transfer settles directly. When
they don't, there is no address to send to — so the money is locked in
`WypeEscrow` until they sign up and claim it, or until it expires and goes back
to the sender.

Before this, "held in escrow" meant a row in MongoDB with a fake
`0xmock-escrow-…` hash. The money never moved. This contract makes the landing
page's claim — *"the money sits safely on-chain for 7 days"* — actually true.

## `WypeEscrow.sol`

| Function | Who can call it | What happens |
| --- | --- | --- |
| `deposit(commitment, expiry)` | anyone (in practice, Wype) | Locks the sent QUAI against an opaque handle |
| `claim(commitment, to, deadline, sig)` | anyone holding a valid signature | Releases the funds to `to` |
| `cancel(commitment)` | the depositor, before expiry | Pulls the money back early |
| `refund(commitment)` | **anyone**, after expiry | Returns the money to the depositor |

Three decisions worth knowing about:

**Escrows are keyed by an opaque commitment, not by an email.** The hash of any
given email is trivially precomputed, so keying escrows on identity would make
this contract a public list of who is owed money — anyone could hash an address
and read the balance. The backend instead computes
`commitment = keccak256(identityHash, salt)` with a fresh random salt per
deposit, and puts the salt in the claim link.

**Claims need the backend's signature.** Wype already proves email ownership via
magic links; the `verifier` signature carries that proof on-chain. It is bound to
one recipient address, one deadline, this contract, and this chain id — so it
can't be redirected, replayed on another deposit, or reused across networks.

**`refund` is permissionless, and that is the point.** After expiry *anyone* can
send an escrow home to its depositor. Wype cannot strand funds by going offline,
losing its verifier key, or refusing to act. The 7-day promise is enforced by
this contract rather than by Wype's uptime — which is the difference between a
policy and a guarantee.

Not in this version: pegging a deposit to a fiat amount so the recipient is
insulated from QUAI's price moving between send and claim. That needs a signed
price attestation and belongs in a follow-up.

## Setup

Dependencies are not committed. After cloning:

```bash
cd contracts
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
```

## Usage

```bash
forge build          # compile
forge test           # run the suite (30 tests)
forge test -vvv      # with traces
forge fmt            # format
forge coverage       # coverage report
```

To exercise the **deployed** contract on a live chain — deposit, claim, then
deposit and refund after expiry — run:

```bash
node script/smoke-test.mjs
```

It spends a little testnet QUAI and prints real transaction hashes. The refund
leg deliberately calls `refund` from an address that is neither the depositor nor
Wype, because that is the property worth demonstrating.

## Deployed

| Network | Address |
| --- | --- |
| Orchard testnet, Cyprus-1 (chainId 15000) | `0x0026622A9d39b81a8C20FabD10f43A8F89D6c608` |

## Deploying

**Compile with Foundry, deploy with quais.** `forge create` cannot deploy to
Quai: the shard is encoded in the contract address, so a deployment has to grind
until the address lands in the target zone. Foundry doesn't do that; quais'
`ContractFactory.grindContractAddress` does. `script/DeployWypeEscrow.s.sol` is
kept for local `anvil` runs only.

```bash
# 1. Generate three Cyprus-1 keypairs (a random key lands in a random zone)
node script/quai-keygen.mjs

# 2. Paste them into .env — NOT .env.example, which is committed
cp .env.example .env

# 3. Fund the deployer from the Quai testnet faucet, then
forge build
node script/deploy-escrow.mjs
```

Use a **different key** for `ESCROW_OWNER` than for `ESCROW_VERIFIER`. The
verifier signs claims and lives in the backend; the owner can rotate the verifier
via `setVerifier`. Keeping them separate means a backend compromise is
recoverable instead of terminal.

### The IPFS hash

Quai records an IPFS CID of contract metadata on every deployment, and quais
rejects anything that isn't a well-formed 46-character CIDv0. The deploy script
defaults to the canonical empty-directory CID — valid, and honest about there
being no published metadata. Pin the build's `metadata.json` and set
`ESCROW_IPFS_HASH` to its CID to make it meaningful.

## Quai notes

- **`evm_version = "paris"`** in `foundry.toml`. Quai's EVM is not guaranteed to
  support the Shanghai `PUSH0` opcode, and a contract that deploys but reverts on
  every call is the worst failure mode available. Bump to `shanghai`/`cancun`
  only after confirming against a live node.
- **Address zones.** Quai addresses encode a shard — `Zone.Cyprus1` is the `0x00`
  prefix — and this applies to EOAs as well as contracts. A key from
  `cast wallet new`, MetaMask, or any Ethereum tool lands in a random zone and
  will be rejected, which is why `script/quai-keygen.mjs` exists. Contract
  addresses have to be ground into the zone at deploy time, which is why
  deployment goes through quais rather than Foundry.
- **RPC URLs differ by tool.** `curl`, `cast` and `forge` need the zone path
  (`https://orchard.rpc.quai.network/cyprus1`); the bare host 404s. quais with
  `usePathing: true` wants the **bare host** and appends the zone itself. The
  deploy script strips a trailing zone path so either form works in `.env`.
- **Stay in one zone.** Cross-zone transfers on Quai are asynchronous (ETXs) and
  settle more slowly, which would undercut the "fast finality" claim. Keep the
  contract and all user wallets in Cyprus-1.
- **Do not trust `provider.getBlock()` for time.** It returns a Quai work object
  whose `woHeader.timestamp` was observed running ~11.7 hours ahead of the
  block's real time. An expiry computed from it lands in the EVM's future and
  refunds fail with `NotYetExpired`. The flat `eth_getBlockByNumber` timestamp is
  the value the EVM uses.
- **Even that clock jitters**, because the public RPC is load balanced across
  nodes at different heights. Anywhere the answer must agree with the EVM, ask
  the contract instead — the smoke test polls `isClaimable()` rather than
  comparing timestamps, so it is evaluated against the same `block.timestamp`
  that `refund` will check.
- **`sendTransaction` needs an explicit `from`.** quais derives the zone from it,
  and a bare `{to, value}` is rejected with "unsupported addressable value".

## Wiring it into the backend

Not done yet. [`src/blockchain/blockchain.service.ts`](../src/blockchain/blockchain.service.ts)
is still the mock. Replacing its internals with `quais.js` calls to this
contract — keeping the same method names and return shapes — is the next step,
and nothing above it (`TransferService`, `EscrowService`, controllers, frontend)
needs to change.
