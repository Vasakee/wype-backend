import * as quais from "quais";

const ZONE = quais.Zone.Cyprus1;

async function make(label) {
  const mnemonic = quais.Mnemonic.fromEntropy(quais.randomBytes(32));
  const hd = quais.QuaiHDWallet.fromMnemonic(mnemonic);
  const { address } = await hd.getNextAddress(0, ZONE);
  const privateKey = hd.getPrivateKey(address);
  if (quais.getZoneForAddress(address) !== ZONE) throw new Error(`${label}: wrong zone`);
  if (new quais.Wallet(privateKey).address !== address) throw new Error(`${label}: key mismatch`);
  return { label, address, privateKey, phrase: mnemonic.phrase };
}

const v = await make("ESCROW_VERIFIER");
console.log(`\n  address     ${v.address}`);
console.log(`  private key ${v.privateKey}`);
console.log(`  mnemonic    ${v.phrase}\n`);
console.log(`  contracts/.env  ESCROW_VERIFIER=${v.address}`);
console.log(`  backend/.env    ESCROW_VERIFIER_PK=${v.privateKey}\n`);
