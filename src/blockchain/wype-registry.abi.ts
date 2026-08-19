export const WYPE_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'register',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'walletAddress', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'newAddress', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'clear',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'resolve',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isAvailable',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nameOf',
    inputs: [{ name: 'walletAddress', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nameCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'NameRegistered',
    inputs: [
      { name: 'name', type: 'string', indexed: false },
      { name: 'walletAddress', type: 'address', indexed: true },
      { name: 'index', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'NameTransferred',
    inputs: [
      { name: 'name', type: 'string', indexed: false },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'NameCleared',
    inputs: [
      { name: 'name', type: 'string', indexed: false },
      { name: 'previousOwner', type: 'address', indexed: true },
    ],
  },
] as const;
